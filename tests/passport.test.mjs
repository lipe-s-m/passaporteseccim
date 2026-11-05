import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/passport/handler.mjs';
import { issueQrToken } from '../supabase/functions/passport/qr-token.mjs';

const editorial={name:'Palestra',category:'Dados',description:'Descrição',short_description:'',speaker_name:'Ana',speaker_bio:'',
  speaker_photo_url:null,event_date:'2026-11-04',starts_at:null,ends_at:null,slides_url:null,speaker_socials:{}};

const time = 1800000000;
const claims = { aud: 'seccim-test', iss: 'https://securetoken.google.com/seccim-test', sub: 'user-a',
  iat: time - 20, auth_time: time - 20, exp: time + 3600 };
const token = (changes = {}, header = {}) => [
  Buffer.from(JSON.stringify({ alg: 'RS256', ...header })).toString('base64url'),
  Buffer.from(JSON.stringify({ ...claims, ...changes })).toString('base64url'), 'signature'
].join('.');
const account = { localId: 'user-a', email: 'Pessoa@Example.com', emailVerified: true, displayName: 'Pessoa teste', validSince: String(time - 100) };
function app({ user = account, googleStatus = 200, dbStatus = 200, projectId = 'seccim-test', ranking, raffle, attendance, rpcs = {}, qrSecret = '' } = {}) {
  const calls = [];
  const handler = createHandler({ projectId, apiKey: 'AIza_test_key', supabaseUrl: 'https://db.supabase.co', serviceKey: 'ADMIN_SECRET', qrSecret,
    now: () => time * 1000, fetcher: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('identitytoolkit')) return Response.json({ users: user ? [user] : [] }, { status: googleStatus });
      if (url.endsWith('/get_badge_ranking')) return Response.json(ranking, {status:dbStatus});
      if (url.endsWith('/get_daily_raffle')) return Response.json(raffle, {status:dbStatus});
      if (url.endsWith('/admin_attendance')) return Response.json(attendance, {status:dbStatus});
      const rpc = Object.keys(rpcs).find(name => url.endsWith('/' + name));
      if (rpc) return Response.json(rpcs[rpc], {status:dbStatus});
      return Response.json({ participant: { id: 'uuid-a', full_name: 'Pessoa teste', email: 'privado@example.com' },
        earnedBadges: ['mesa-redonda'], secret: 'ADMIN_SECRET' }, { status: dbStatus });
    } });
  return { calls, send: (jwt = token(), url = 'https://edge.test/passport', method = 'GET', body) => handler(new Request(url, {
    method, headers: jwt ? { Authorization: `Bearer ${jwt}` } : {}, ...(body ? { body: JSON.stringify(body) } : {})
  })) };
}
test('sem token, token malformado e método de escrita não acessam o banco', async () => {
  const a = app();
  assert.equal((await a.send('')).status, 401);
  assert.equal((await a.send('not-a-jwt')).status, 401);
  assert.equal((await a.send(token(), undefined, 'POST')).status, 405);
  assert.equal(a.calls.length, 0);
});

test('editor verifica Firebase e autorização, ignora UID e papel enviados no corpo',async()=>{
  const url='https://edge.test/passport/admin/activity-content';
  const denied=app({dbStatus:403,rpcs:{admin_activity_content:{code:'42501'}}});
  assert.equal((await denied.send('',url)).status,401);
  assert.equal((await denied.send(token(),url,'DELETE')).status,405);
  const body={activity:'mesa',content:editorial,revision:0,p_uid:'admin-falso',role:'service_role'};
  assert.equal((await denied.send(token({admin:true}),url,'POST',body)).status,403);
  assert.equal(JSON.parse(denied.calls.at(-1).options.body).p_uid,'user-a');
  assert.equal((await app({user:{...account,emailVerified:false}}).send(token(),url,'POST',body)).status,403);
});

test('editor lê/salva somente campos permitidos, recusa formato ruim e sinaliza conflito',async()=>{
  const url='https://edge.test/passport/admin/activity-content';
  const a=app({rpcs:{admin_activity_content:{activity:{id:'mesa',...editorial,content_revision:1,private_field:'segredo'}}}});
  assert.equal((await a.send(token(),url+'?activity=mesa')).status,200);
  const r=await a.send(token(),url,'POST',{activity:'mesa',content:editorial,revision:0});
  assert.equal(r.status,200);assert.equal((await r.json()).activity.private_field,undefined);
  assert.equal((await a.send(token(),url,'POST',{activity:'mesa',content:{...editorial,active:false},revision:0})).status,400);
  const conflict=app({dbStatus:409,rpcs:{admin_activity_content:{code:'40001'}}});
  const result=await conflict.send(token(),url,'POST',{activity:'mesa',content:editorial,revision:0});
  assert.equal(result.status,409);assert.equal((await result.json()).code,'CONTENT_CONFLICT');
});

test('sorteio exige conta confirmada e permissão no banco, ignora papel e UID do cliente',async()=>{
  const url='https://edge.test/passport/admin/raffle?date=2026-11-03&p_uid=admin&role=admin';
  const denied=app({dbStatus:403,raffle:{code:'42501',message:'Informação privada'}});
  assert.equal((await denied.send('',url)).status,401);
  assert.equal((await denied.send(token(),url,'POST')).status,405);
  const result=await denied.send(token({admin:true,role:'service_role'}),url);
  assert.equal(result.status,403); assert.deepEqual(await result.json(),{code:'ADMIN_REQUIRED'});
  assert.deepEqual(JSON.parse(denied.calls.at(-1).options.body),{p_uid:'user-a',p_date:'2026-11-03',p_offset:0});
  const unverified=app({user:{...account,emailVerified:false}});
  assert.equal((await unverified.send(token(),url)).status,403); assert.equal(unverified.calls.length,1);
});

test('sorteio valida data e paginação, sem aceitar dias inexistentes',async()=>{
  const a=app();
  for(const query of ['', 'date=2026-02-30','date=2026-13-01','date=2026-2-03','date=2026-11-03&offset=-1',
    'date=2026-11-03&offset=1.5','date=2026-11-03&offset=10000001','date=2026-11-03&offset=abc']) {
    assert.equal((await a.send(token(),'https://edge.test/passport/admin/raffle?'+query)).status,400);
  }
  assert(!a.calls.some(c=>c.url.includes('/get_daily_raffle')));
});

test('sorteio mantém nomes repetidos, pagina resultados e só devolve campos permitidos',async()=>{
  const entry={ticketId:'ticket',participantId:'p',name:'Pessoa',activityId:'palestra',activityName:'Palestra',email:'privado',firebase_uid:'segredo'};
  const raffle={entries:[entry,{...entry,ticketId:'ticket-2',activityId:'palestra-2'}],
    totalEntries:1001,uniqueParticipants:500,hasMore:true,pendingAttendances:0,
    unconfiguredActivities:[{id:'sem-data',name:'Sem data',secret:'segredo'}]};
  const a=app({raffle});
  const r=await a.send(token(),'https://edge.test/passport/admin/raffle?date=2026-11-03&offset=0');
  assert.equal(r.status,200); assert.equal(r.headers.get('Cache-Control'),'no-store');
  const data=await r.json(); assert.equal(data.entries.length,2);
  assert.equal(data.entries[0].name,data.entries[1].name);
  assert.equal(data.nextOffset,1000); assert.equal(data.uniqueParticipants,500);
  assert(!JSON.stringify(data).includes('privado')); assert(!JSON.stringify(data).includes('segredo'));
  assert.equal((await app({raffle:{entries:[]}}).send(token(),'https://edge.test/passport/admin/raffle?date=2026-11-03')).status,503);
});

const attendanceUrl = 'https://edge.test/passport/admin/attendance';
const participantId = '11111111-1111-4111-8111-111111111111';

test('presença exige conta confirmada e permissão no banco, ignora UID e papel do cliente',async()=>{
  const denied=app({dbStatus:403,attendance:{code:'42501',message:'Informação privada'}});
  assert.equal((await denied.send('',attendanceUrl+'?action=overview')).status,401);
  assert.equal((await denied.send(token(),attendanceUrl+'?action=overview','PATCH')).status,405);
  const result=await denied.send(token({role:'service_role',admin:true}),attendanceUrl+'?action=overview&p_uid=admin');
  assert.equal(result.status,403); assert.deepEqual(await result.json(),{code:'ADMIN_REQUIRED'});
  assert.deepEqual(JSON.parse(denied.calls.at(-1).options.body),{p_uid:'user-a',p_action:'overview',p_activity:null,p_participant:null,p_query:null});
  const unverified=app({user:{...account,emailVerified:false}});
  assert.equal((await unverified.send(token(),attendanceUrl+'?action=overview')).status,403); assert.equal(unverified.calls.length,1);
});

test('presença valida ação, atividade, busca e participante antes do banco',async()=>{
  const a=app();
  for(const query of ['', 'action=add&activity=mesa', 'action=search&activity=mesa&q=a', 'action=list',
    'action=list&activity=Mesa', 'action=search&activity=mesa&q='+'x'.repeat(121)]) {
    assert.equal((await a.send(token(),attendanceUrl+'?'+query)).status,400);
  }
  for(const body of [{activity:'mesa'},{activity:'mesa',participant:'invalido'},{activity:'../x',participant:participantId}]) {
    assert.equal((await a.send(token(),attendanceUrl,'POST',body)).status,400);
  }
  assert(!a.calls.some(c=>c.url.includes('/admin_attendance')));
});

test('presença registra com o UID verificado e filtra campos privados',async()=>{
  const a=app({attendance:{changed:true,firebase_uid:'segredo'}});
  const r=await a.send(token(),attendanceUrl,'POST',{activity:'mesa',participant:participantId,p_uid:'outro'});
  assert.equal(r.status,200); assert.deepEqual(await r.json(),{changed:true});
  assert.deepEqual(JSON.parse(a.calls.at(-1).options.body),{p_uid:'user-a',p_action:'add',p_activity:'mesa',p_participant:participantId,p_query:null});
  await a.send(token(),attendanceUrl,'DELETE',{activity:'mesa',participant:participantId});
  assert.equal(JSON.parse(a.calls.at(-1).options.body).p_action,'remove');
  const search=app({attendance:{participants:[{id:participantId,name:'Pessoa',email:'p@example.com',present:true,firebase_uid:'segredo'}]}});
  const found=await search.send(token(),attendanceUrl+'?action=search&activity=mesa&q=%20pes%20');
  assert.deepEqual(await found.json(),{participants:[{id:participantId,name:'Pessoa',email:'p@example.com',present:true}]});
  assert.equal(JSON.parse(search.calls.at(-1).options.body).p_query,'pes');
  assert.equal((await app({attendance:{participants:null}}).send(token(),attendanceUrl+'?action=search&activity=mesa&q=pes')).status,503);
  const list=await app({attendance:{total:1,attendees:[{id:participantId,name:'Pessoa',email:'p@example.com',recordedAt:'2026-11-03T12:00:00Z',recorded_by:'segredo'}]}})
    .send(token(),attendanceUrl+'?action=list&activity=mesa');
  assert(!JSON.stringify(await list.json()).includes('segredo'));
});

const walkinUrl = 'https://edge.test/passport/admin/participants';
const drawsUrl = 'https://edge.test/passport/admin/draws';

test('cadastro pela organização valida dados, normaliza e-mail e usa o UID verificado',async()=>{
  const registered={created:true,changed:true,participant:{id:participantId,name:'Nova',email:'nova@example.com',linked:false,firebase_uid:'segredo'}};
  const a=app({rpcs:{admin_register_participant:registered}});
  assert.equal((await a.send(token(),walkinUrl,'GET')).status,405);
  assert.equal((await a.send('',walkinUrl,'POST',{activity:'mesa',name:'Nova',email:'nova@example.com'})).status,401);
  for(const body of [{activity:'mesa',name:' ',email:'nova@example.com'},{activity:'mesa',name:'Nova',email:'sem-arroba'},
    {activity:'mesa',name:'x'.repeat(121),email:'nova@example.com'},{activity:'Mesa',name:'Nova',email:'nova@example.com'},{activity:'mesa',name:'Nova'}]) {
    assert.equal((await a.send(token(),walkinUrl,'POST',body)).status,400);
  }
  assert(!a.calls.some(c=>c.url.includes('/admin_register_participant')));
  const r=await a.send(token(),walkinUrl,'POST',{activity:'mesa',name:'  Nova ',email:' Nova@Example.com ',p_uid:'outro'});
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{created:true,changed:true,participant:{id:participantId,name:'Nova',email:'nova@example.com',linked:false}});
  assert.deepEqual(JSON.parse(a.calls.at(-1).options.body),{p_uid:'user-a',p_activity:'mesa',p_name:'Nova',p_email:'nova@example.com'});
  const denied=app({dbStatus:403,rpcs:{admin_register_participant:{code:'42501'}}});
  assert.equal((await denied.send(token(),walkinUrl,'POST',{activity:'mesa',name:'Nova',email:'nova@example.com'})).status,403);
});

test('sorteio no painel lista, sorteia e marca ausente sem expor e-mail ou UID',async()=>{
  const state={drawnId:participantId,reel:['Ana','Bruno',7],remainingParticipants:3,totalEntries:9,
    draws:[{id:participantId,name:'Ana',prize:'Caneca',absent:false,drawnAt:'2026-11-03T20:00:00Z',chances:3,email:'privado',participant_id:'segredo'}]};
  const a=app({rpcs:{admin_raffle_draw:state}});
  assert.equal((await a.send(token(),drawsUrl+'?date=2026-11-03','PUT')).status,405);
  for(const [method,url,body] of [['GET',drawsUrl+'?date=2026-02-30'],['GET',drawsUrl],['POST',drawsUrl,{date:'2026-11-03',prize:'x'.repeat(121)}],
    ['PATCH',drawsUrl,{date:'2026-11-03',id:'invalido'}]]) {
    assert.equal((await a.send(token(),url,method,body)).status,400);
  }
  const drawn=await a.send(token(),drawsUrl,'POST',{date:'2026-11-03',prize:' Caneca '});
  assert.equal(drawn.status,200);
  const data=await drawn.json();
  assert.deepEqual(data.reel,['Ana','Bruno']); assert.equal(data.drawnId,participantId); assert.equal(data.draws[0].chances,3);
  assert(!JSON.stringify(data).includes('privado')); assert(!JSON.stringify(data).includes('segredo'));
  assert.deepEqual(JSON.parse(a.calls.at(-1).options.body),{p_uid:'user-a',p_action:'draw',p_date:'2026-11-03',p_prize:'Caneca',p_draw:null,p_sponsor:null});
  await a.send(token(),drawsUrl,'PATCH',{date:'2026-11-03',id:participantId});
  assert.equal(JSON.parse(a.calls.at(-1).options.body).p_action,'absent');
  assert.equal((await a.send(token(),drawsUrl,'DELETE',{date:'2026-11-03',id:'invalido'})).status,400);
  await a.send(token(),drawsUrl,'DELETE',{date:'2026-11-03',id:participantId});
  assert.deepEqual(JSON.parse(a.calls.at(-1).options.body),{p_uid:'user-a',p_action:'delete',p_date:'2026-11-03',p_prize:'',p_draw:participantId,p_sponsor:null});
  await a.send(token(),drawsUrl+'?date=2026-11-03&p_uid=outro');
  assert.deepEqual(JSON.parse(a.calls.at(-1).options.body),{p_uid:'user-a',p_action:'list',p_date:'2026-11-03',p_prize:'',p_draw:null,p_sponsor:null});
  const denied=app({dbStatus:403,rpcs:{admin_raffle_draw:{code:'42501'}}});
  assert.equal((await denied.send(token(),drawsUrl,'POST',{date:'2026-11-03'})).status,403);
  assert.equal((await app({rpcs:{admin_raffle_draw:{draws:null}}}).send(token(),drawsUrl+'?date=2026-11-03')).status,503);
});

const personUrl = 'https://edge.test/passport/admin/person';

test('presenças em lote validam atividades, removem duplicatas e usam o UID verificado',async()=>{
  const result={added:2,removed:1,participant:{id:participantId,name:'Pessoa',email:'p@example.com',firebase_uid:'segredo'},activities:['mesa','kafka']};
  const a=app({rpcs:{admin_person_attendances:result}});
  assert.equal((await a.send(token(),personUrl,'DELETE')).status,405);
  assert.equal((await a.send('',personUrl+'?participant='+participantId)).status,401);
  for(const [method,url,body] of [['GET',personUrl+'?participant=invalido'],['POST',personUrl,{participant:participantId}],
    ['POST',personUrl,{participant:participantId,add:['Mesa']}],['POST',personUrl,{participant:participantId,add:'mesa'}],
    ['POST',personUrl,{participant:participantId,add:Array.from({length:51},(_, i)=>'p'+i)}]]) {
    assert.equal((await a.send(token(),url,method,body)).status,400);
  }
  assert(!a.calls.some(c=>c.url.includes('/admin_person_attendances')));
  const read=await a.send(token(),personUrl+'?participant='+participantId+'&p_uid=outro');
  assert.equal(read.status,200);
  assert.deepEqual(JSON.parse(a.calls.at(-1).options.body),{p_uid:'user-a',p_participant:participantId,p_add:[],p_remove:[]});
  const r=await a.send(token(),personUrl,'POST',{participant:participantId,add:['mesa','kafka','mesa'],remove:['aws'],p_uid:'outro'});
  assert.deepEqual(await r.json(),{added:2,removed:1,participant:{id:participantId,name:'Pessoa',email:'p@example.com'},activities:['mesa','kafka']});
  assert.deepEqual(JSON.parse(a.calls.at(-1).options.body),{p_uid:'user-a',p_participant:participantId,p_add:['mesa','kafka'],p_remove:['aws']});
  const denied=app({dbStatus:403,rpcs:{admin_person_attendances:{code:'42501'}}});
  assert.equal((await denied.send(token(),personUrl,'POST',{participant:participantId,add:['mesa']})).status,403);
});

const sponsorsUrl = 'https://edge.test/passport/admin/sponsors';
const sponsorContent = {name:' Empresa ',tagline:'Frase',about:'Sobre',contributions:[' Coffee break '],logo_url:'/fotos/patrocinadores/empresa.png',
  photos:[{url:'/fotos/patrocinadores/empresa-1.webp',caption:'Estande'}],links:{site:'https://empresa.example',vagas:'https://empresa.example/vagas'},published:false};

test('patrocinadores: lista e salva pela organização, validando conteúdo antes do banco',async()=>{
  const row={id:'empresa',...sponsorContent,name:'Empresa',content_revision:1,updated_at:'agora',segredo:'x'};
  const a=app({rpcs:{admin_sponsors:{sponsor:row,sponsors:[row]}}});
  assert.equal((await a.send('',sponsorsUrl)).status,401);
  assert.equal((await a.send(token(),sponsorsUrl,'DELETE')).status,405);
  for(const changes of [{logo_url:'https://evil.test/logo.png'},{logo_url:'/fotos/patrocinadores/a.svg'},{links:{site:'javascript:alert(1)'}},
    {links:{twitter:'https://x.com/a'}},{photos:[{url:'/fotos/a.webp'}]},{contributions:['  ']},{name:''},{published:'sim'},{extra:1}]) {
    assert.equal((await a.send(token(),sponsorsUrl,'POST',{id:'empresa',content:{...sponsorContent,...changes},revision:null})).status,400,JSON.stringify(changes));
  }
  assert.equal((await a.send(token(),sponsorsUrl,'POST',{id:'Empresa X',content:sponsorContent,revision:null})).status,400);
  assert(!a.calls.some(c=>c.url.includes('/admin_sponsors')));
  const list=await a.send(token(),sponsorsUrl);
  assert.equal(list.status,200);
  const listed=await list.json(); assert(!JSON.stringify(listed).includes('segredo'));
  assert.deepEqual(JSON.parse(a.calls.at(-1).options.body),{p_uid:'user-a'});
  await a.send(token(),sponsorsUrl,'POST',{id:'empresa',content:sponsorContent,revision:3,p_uid:'outro'});
  const sent=JSON.parse(a.calls.at(-1).options.body);
  assert.equal(sent.p_uid,'user-a');assert.equal(sent.p_id,'empresa');assert.equal(sent.p_revision,3);
  assert.equal(sent.p_content.name,'Empresa');assert.deepEqual(sent.p_content.contributions,['Coffee break']);
  const conflict=app({dbStatus:409,rpcs:{admin_sponsors:{code:'40001'}}});
  assert.equal((await conflict.send(token(),sponsorsUrl,'POST',{id:'empresa',content:sponsorContent,revision:1})).status,409);
  const denied=app({dbStatus:403,rpcs:{admin_sponsors:{code:'42501'}}});
  assert.equal((await denied.send(token(),sponsorsUrl)).status,403);
});

test('sorteio envia o patrocinador do brinde e recusa identificador inválido',async()=>{
  const state={drawnId:participantId,reel:['Ana'],remainingParticipants:1,totalEntries:2,
    draws:[{id:participantId,name:'Ana',prize:'Caneca',sponsor:'Empresa',absent:false,drawnAt:'2026-11-05T20:00:00Z',chances:2}]};
  const a=app({rpcs:{admin_raffle_draw:state}});
  assert.equal((await a.send(token(),drawsUrl,'POST',{date:'2026-11-05',prize:'Caneca',sponsor:'Empresa X'})).status,400);
  const r=await a.send(token(),drawsUrl,'POST',{date:'2026-11-05',prize:'Caneca',sponsor:'empresa'});
  assert.equal((await r.json()).draws[0].sponsor,'Empresa');
  assert.equal(JSON.parse(a.calls.at(-1).options.body).p_sponsor,'empresa');
});

const qrSecret = 'segredo-de-teste-com-mais-de-32-caracteres';
const qrUrl = 'https://edge.test/passport/qr';
const qrScanUrl = 'https://edge.test/passport/admin/attendance/qr';

test('meu QR: exige conta confirmada e chave configurada, e identifica pelo cadastro verificado', async () => {
  assert.equal((await app().send(token(), qrUrl)).status, 503);
  const a = app({ qrSecret, rpcs: { get_firebase_passport: { participant: { id: participantId, full_name: 'Ana', email: 'privado' }, earnedBadges: [] } } });
  assert.equal((await a.send('', qrUrl)).status, 401);
  assert.equal((await a.send(token(), qrUrl, 'POST')).status, 405);
  assert.equal((await app({ qrSecret, user: { ...account, emailVerified: false } }).send(token(), qrUrl)).status, 403);
  const r = await a.send(token(), qrUrl + '?participant=outro');
  assert.equal(r.status, 200); assert.equal(r.headers.get('Cache-Control'), 'no-store');
  const data = await r.json();
  assert(data.token.startsWith(`S1.${participantId}.`)); assert.equal(data.name, 'Ana'); assert.equal(data.periodSeconds, 30);
  assert(!JSON.stringify(data).includes('privado'));
  assert.equal(JSON.parse(a.calls.at(-1).options.body).p_uid, 'user-a');
});

test('leitor de QR: registra pela organização, informa repetição e recusa QR forjado ou vencido', async () => {
  const { token: qr } = await issueQrToken(qrSecret, participantId, time * 1000);
  const ok = { added: 1, removed: 0, participant: { id: participantId, name: 'Ana', email: 'privado@example.com' }, activities: ['mesa'] };
  const a = app({ qrSecret, rpcs: { admin_person_attendances: ok } });
  assert.equal((await a.send(token(), qrScanUrl, 'GET')).status, 405);
  assert.equal((await app().send(token(), qrScanUrl, 'POST', { activity: 'mesa', token: qr })).status, 503);
  const r = await a.send(token(), qrScanUrl, 'POST', { activity: 'mesa', token: qr, participant: 'outro' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { result: 'registered', person: { id: participantId, name: 'Ana', nickname: null, photoUrl: null } });
  assert.deepEqual(JSON.parse(a.calls.find(c => c.url.endsWith('/admin_person_attendances')).options.body), { p_uid: 'user-a', p_participant: participantId, p_add: ['mesa'], p_remove: [] });
  const again = app({ qrSecret, rpcs: { admin_person_attendances: { ...ok, added: 0 } } });
  assert.equal((await (await again.send(token(), qrScanUrl, 'POST', { activity: 'mesa', token: qr })).json()).result, 'already');
  const old = (await issueQrToken(qrSecret, participantId, (time - 120) * 1000)).token;
  const expired = await a.send(token(), qrScanUrl, 'POST', { activity: 'mesa', token: old });
  assert.equal(expired.status, 410); assert.equal((await expired.json()).code, 'QR_EXPIRED');
  const callsBefore = a.calls.length;
  for (const body of [{ activity: 'mesa', token: qr.replace(participantId, '22222222-2222-4222-8222-222222222222') },
    { activity: 'Mesa', token: qr }, { activity: 'mesa' }, { activity: 'mesa', token: 'https://evil.test' }])
    assert.equal((await a.send(token(), qrScanUrl, 'POST', body)).status, 400, JSON.stringify(body));
  assert(!a.calls.slice(callsBefore).some(c => c.url.includes('/admin_person_attendances')));
  const denied = app({ qrSecret, dbStatus: 403, rpcs: { admin_person_attendances: { code: '42501' } } });
  assert.equal((await denied.send(token(), qrScanUrl, 'POST', { activity: 'mesa', token: qr })).status, 403);
});

test('ranking usa identidade validada, filtra campos privados e bloqueia escrita',async()=>{
  const ranking={entries:[{position:1,name:'Pessoa',badgeCount:2,isMe:true,email:'privado',id:'uuid'}],mine:{position:1,badgeCount:2,email:'privado'}};
  const a=app({ranking}); const url='https://edge.test/passport/ranking?p_uid=outro';
  assert.equal((await a.send('',url)).status,401);
  assert.equal((await a.send(token(),url,'POST')).status,405);
  const response=await a.send(token(),url);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{entries:[{position:1,name:'Pessoa',badgeCount:2,isMe:true,photoUrl:null}],mine:{position:1,badgeCount:2}});
  assert.deepEqual(JSON.parse(a.calls.at(-1).options.body),{p_uid:'user-a'});
  assert.equal((await app({user:{...account,emailVerified:false},ranking}).send(token(),url)).status,403);
  assert.equal((await app({ranking:{entries:[],mine:{position:null,badgeCount:0}}}).send(token(),url)).status,200);
  assert.equal((await app({ranking:{entries:[{}]}}).send(token(),url)).status,503);
});
test('preflight CORS não devolve dados privados', async () => {
  const a = app(); assert.equal((await a.send('', undefined, 'OPTIONS')).status, 204); assert.equal(a.calls.length, 0);
});
test('projeto não configurado falha fechado', async () => {
  const a = app({ projectId: '' }); assert.equal((await a.send()).status, 503); assert.equal(a.calls.length, 0);
});
test('projeto errado, token expirado e algoritmo inesperado são recusados', async () => {
  const a = app();
  for (const jwt of [token({ aud: 'outro' }), token({ iss: 'https://evil.test' }), token({ exp: time - 1 }), token({}, { alg: 'none' })]) {
    assert.equal((await a.send(jwt)).status, 401);
  }
  assert.equal(a.calls.length, 0);
});
test('claims decodificados não bastam: rejeição pelo Google bloqueia o acesso', async () => {
  const a = app({ googleStatus: 400 }); assert.equal((await a.send()).status, 401); assert.equal(a.calls.length, 1);
});
test('e-mail não confirmado não chama o banco', async () => {
  const a = app({ user: { ...account, emailVerified: false } }); const r = await a.send();
  assert.equal(r.status, 403); assert.equal((await r.json()).code, 'EMAIL_NOT_VERIFIED'); assert.equal(a.calls.length, 1);
});
test('conta desabilitada, token revogado e identidade divergente são recusados', async () => {
  for (const user of [{ ...account, disabled: true }, { ...account, validSince: String(time) }, { ...account, localId: 'outro' }, null]) {
    const a = app({ user }); assert.equal((await a.send()).status, 401); assert.equal(a.calls.length, 1);
  }
});
test('identidade vem do Google; query e claims de papel não autorizam outra pessoa', async () => {
  const a = app(); const r = await a.send(token({ role: 'service_role', email: 'atacante@example.com' }), 'https://edge.test/passport?id=outro');
  assert.equal(r.status, 200); assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await r.json(), { participant: { id: 'uuid-a', full_name: 'Pessoa teste' }, earnedBadges: ['mesa-redonda'] });
  assert.deepEqual(JSON.parse(a.calls[1].options.body), { p_uid: 'user-a', p_email: 'pessoa@example.com', p_name: 'Pessoa teste' });
  assert.equal(a.calls[1].options.headers.Authorization, 'Bearer ADMIN_SECRET');
});
test('falhas externas não expõem resposta interna nem chave administrativa', async () => {
  for (const options of [{ googleStatus: 429 }, { dbStatus: 500 }, { dbStatus: 409 }]) {
    const a = app(options); const r = await a.send();
    assert.equal(r.status, options.dbStatus === 409 ? 409 : 503);
    assert(!JSON.stringify(await r.json()).includes('ADMIN_SECRET'));
  }
});

test('FAQ valida escrita, ignora UID forjado e oculta autor anônimo', async () => {
  const calls = [];
  const handler = createHandler({projectId:'seccim-test',apiKey:'AIza_test_key',supabaseUrl:'https://db.supabase.co',serviceKey:'SECRET',now:()=>time*1000,
    fetcher:async (url, options) => {
      calls.push({url,options});
      if (url.includes('identitytoolkit')) return Response.json({users:[account]});
      return Response.json({questions:[{id:'q',body:'Dúvida',anonymous:true,mine:false,author:'Nome privado',participant_id:'privado',email:'privado'}],hasMore:false,id:'q'});
    }});
  const send = (method,body,auth=token()) => handler(new Request('https://edge.test/passport/questions?activity=mesa',{
    method,headers:{Authorization:`Bearer ${auth}`},...(body ? {body:JSON.stringify(body)} : {})}));
  assert.equal((await send('POST',{activity:'mesa',body:'  ',anonymous:true})).status,400);
  assert.equal((await send('POST',{activity:'mesa',body:'x'.repeat(2001),anonymous:true})).status,400);
  assert.equal((await send('DELETE',{activity:'mesa',id:'invalido'})).status,400);
  assert.equal((await send('POST',{activity:'mesa',body:'Pergunta',anonymous:true,p_uid:'outro'})).status,200);
  const params = JSON.parse(calls.at(-1).options.body);
  assert.equal(params.p_uid,'user-a'); assert.equal(params.p_action,'create');
  const result = await (await send('GET')).json();
  assert.equal(result.questions[0].author,'Anônimo');
  assert(!JSON.stringify(result).includes('privado'));
  assert.equal((await send('GET',undefined,token({aud:'outro'}))).status,401);
});

// Perfil: Storage simulado para conferir envio, assinatura e exclusão de fotos.
function profileApp({ rpc = {}, rpcStatus = {}, signFails = false } = {}) {
  const calls = [];
  const handler = createHandler({ projectId:'seccim-test', apiKey:'AIza_test_key', supabaseUrl:'https://db.supabase.co', serviceKey:'ADMIN_SECRET',
    now:() => time * 1000, fetcher: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('identitytoolkit')) return Response.json({ users:[account] });
      if (url.includes('/storage/v1/object/sign/avatars')) {
        if (signFails) return new Response('x', { status:500 });
        return Response.json(JSON.parse(options.body).paths.map(path => ({ path, signedURL:`/object/sign/avatars/${path}?token=t`, error:null })));
      }
      if (url.includes('/storage/v1/')) return Response.json({ Key:'ok' });
      const name = url.split('/rpc/')[1];
      return Response.json(rpc[name] ?? { participant:{ id:participantId, full_name:'Ana Oficial' }, earnedBadges:[] }, { status:rpcStatus[name] ?? 200 });
    } });
  const send = (method, path, body, contentType = 'application/json') => handler(new Request('https://edge.test/passport' + path, { method,
    headers:{ Authorization:`Bearer ${token()}`, 'Content-Type':contentType }, ...(body ? { body: contentType === 'application/json' ? JSON.stringify(body) : body } : {}) }));
  return { calls, send };
}
const profileInput = { nickname:' Ana.Dev ', showNickname:true, headline:' Estagiária de dados · Empresa X ', bio:'Oi', course:'Ciência da Computação', period:'5',
  links:{ linkedin:'https://br.linkedin.com/in/ana', github:'https://github.com/ana' } };
const savedProfile = { name:'Ana Oficial', profile:{ nickname:'ana.dev', showNickname:true, headline:'Estagiária', bio:'Oi', course:'CC', period:'5',
  links:{}, photoPath:`${participantId}/0123456789abcdef.webp` } };

test('perfil: valida antes do banco, normaliza apelido e devolve foto por link assinado', async () => {
  const a = profileApp({ rpc:{ manage_profile:savedProfile } });
  for (const changes of [{ nickname:'a' }, { nickname:'com espaço' }, { period:'11' }, { bio:'x'.repeat(161) }, { headline:'x'.repeat(121) },
    { links:{ linkedin:'https://evil.test/in/ana' } }, { links:{ twitter:'https://x.com/a' } }, { links:{ github:'http://github.com/a' } },
    { showNickname:'sim' }, { extra:1 }]) {
    assert.equal((await a.send('POST', '/profile', { ...profileInput, ...changes })).status, 400, JSON.stringify(changes));
  }
  assert(!a.calls.some(c => c.url.includes('/manage_profile')));
  const saved = await a.send('POST', '/profile', { ...profileInput, p_uid:'outro' }.p_uid ? profileInput : profileInput);
  assert.equal(saved.status, 200);
  const body = JSON.parse(a.calls.find(c => c.url.includes('/manage_profile')).options.body);
  assert.equal(body.p_uid, 'user-a'); assert.equal(body.p_profile.nickname, 'ana.dev'); assert.equal(body.p_profile.headline, 'Estagiária de dados · Empresa X');
  const data = await saved.json();
  assert.equal(data.profile.photoUrl, `https://db.supabase.co/storage/v1/object/sign/avatars/${participantId}/0123456789abcdef.webp?token=t`);
  assert(!JSON.stringify(data).includes('photoPath'));
  const read = await a.send('GET', '/profile'); assert.equal(JSON.parse(a.calls.at(-2).options.body).p_profile, null); assert.equal(read.status, 200);
  const taken = profileApp({ rpc:{ manage_profile:{ code:'23505' } }, rpcStatus:{ manage_profile:409 } });
  const conflict = await taken.send('POST', '/profile', profileInput);
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, 'NICKNAME_TAKEN');
  assert.equal((await profileApp({ signFails:true, rpc:{ manage_profile:savedProfile } }).send('GET', '/profile')).status, 200, 'sem assinatura, perfil continua sem foto');
});

test('foto de perfil: aceita só imagem de verdade, sobe com nome aleatório e apaga a anterior', async () => {
  const webp = new Uint8Array([...Buffer.from('RIFF'), 1, 0, 0, 0, ...Buffer.from('WEBPVP8 '), ...new Array(200).fill(7)]);
  const previous = `${participantId}/aaaaaaaaaaaaaaaa.png`;
  const a = profileApp({ rpc:{ set_profile_photo:{ previous } } });
  assert.equal((await a.send('PUT', '/profile/photo', new Uint8Array([60, 115, 118, 103, ...new Array(200).fill(32)]), 'image/webp')).status, 400, 'SVG/HTML recusado');
  assert.equal((await a.send('PUT', '/profile/photo', new Uint8Array(301 * 1024).fill(0xff), 'image/jpeg')).status, 413);
  assert(!a.calls.some(c => c.url.includes('/storage/v1/object/avatars/')));
  const r = await a.send('PUT', '/profile/photo', webp, 'image/png');
  assert.equal(r.status, 200);
  const upload = a.calls.find(c => c.url.includes('/storage/v1/object/avatars/'));
  assert.match(upload.url, new RegExp(`/object/avatars/${participantId}/[0-9a-f]{16}\\.webp$`));
  assert.equal(upload.options.headers['Content-Type'], 'image/webp', 'tipo pelo conteúdo, não pelo cabeçalho enviado');
  assert.equal(upload.options.headers.Authorization, 'Bearer ADMIN_SECRET');
  const removed = a.calls.find(c => c.options.method === 'DELETE' && c.url.endsWith('/object/avatars'));
  assert.deepEqual(JSON.parse(removed.options.body), { prefixes:[previous] });
  assert.match((await r.json()).photoUrl, /^https:\/\/db\.supabase\.co\/storage\/v1\/object\/sign\/avatars\//);
  assert.equal((await a.send('GET', '/profile/photo')).status, 405);
  const del = await a.send('DELETE', '/profile/photo');
  assert.equal(del.status, 200); assert.equal(JSON.parse(a.calls.filter(c => c.url.includes('/set_profile_photo')).at(-1).options.body).p_path, null);
});

test('moderação de perfis: busca e remove pela organização, apagando a foto do Storage', async () => {
  const path = `${participantId}/0123456789abcdef.jpg`;
  const a = profileApp({ rpc:{ admin_profiles:{ profiles:[{ participantId, name:'Ana', nickname:'ana', headline:'', photoPath:path, email:'privado' }], removedPhoto:path } } });
  assert.equal((await a.send('GET', '/admin/profiles?q=a')).status, 400);
  const list = await (await a.send('GET', '/admin/profiles?q=ana')).json();
  assert.equal(list.profiles[0].nickname, 'ana'); assert.match(list.profiles[0].photoUrl, /sign\/avatars/); assert(!JSON.stringify(list).includes('privado'));
  assert.equal((await a.send('POST', '/admin/profiles', { participant:participantId, action:'apagar_tudo' })).status, 400);
  assert.equal((await a.send('POST', '/admin/profiles', { participant:participantId, action:'remove_photo' })).status, 200);
  assert.deepEqual(JSON.parse(a.calls.find(c => c.options.method === 'DELETE').options.body), { prefixes:[path] });
  const denied = profileApp({ rpc:{ admin_profiles:{ code:'42501' } }, rpcStatus:{ admin_profiles:403 } });
  assert.equal((await denied.send('GET', '/admin/profiles?q=ana')).status, 403);
});
