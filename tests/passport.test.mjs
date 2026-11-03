import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/passport/handler.mjs';

const time = 1800000000;
const claims = { aud: 'seccim-test', iss: 'https://securetoken.google.com/seccim-test', sub: 'user-a',
  iat: time - 20, auth_time: time - 20, exp: time + 3600 };
const token = (changes = {}, header = {}) => [
  Buffer.from(JSON.stringify({ alg: 'RS256', ...header })).toString('base64url'),
  Buffer.from(JSON.stringify({ ...claims, ...changes })).toString('base64url'), 'signature'
].join('.');
const account = { localId: 'user-a', email: 'Pessoa@Example.com', emailVerified: true, displayName: 'Pessoa teste', validSince: String(time - 100) };
function app({ user = account, googleStatus = 200, dbStatus = 200, projectId = 'seccim-test', ranking, raffle, attendance } = {}) {
  const calls = [];
  const handler = createHandler({ projectId, apiKey: 'AIza_test_key', supabaseUrl: 'https://db.supabase.co', serviceKey: 'ADMIN_SECRET',
    now: () => time * 1000, fetcher: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('identitytoolkit')) return Response.json({ users: user ? [user] : [] }, { status: googleStatus });
      if (url.endsWith('/get_badge_ranking')) return Response.json(ranking, {status:dbStatus});
      if (url.endsWith('/get_daily_raffle')) return Response.json(raffle, {status:dbStatus});
      if (url.endsWith('/admin_attendance')) return Response.json(attendance, {status:dbStatus});
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

test('ranking usa identidade validada, filtra campos privados e bloqueia escrita',async()=>{
  const ranking={entries:[{position:1,name:'Pessoa',badgeCount:2,isMe:true,email:'privado',id:'uuid'}],mine:{position:1,badgeCount:2,email:'privado'}};
  const a=app({ranking}); const url='https://edge.test/passport/ranking?p_uid=outro';
  assert.equal((await a.send('',url)).status,401);
  assert.equal((await a.send(token(),url,'POST')).status,405);
  const response=await a.send(token(),url);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{entries:[{position:1,name:'Pessoa',badgeCount:2,isMe:true}],mine:{position:1,badgeCount:2}});
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
