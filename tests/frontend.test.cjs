const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/const SUPABASE_URL = "[^"]*";/, 'const SUPABASE_URL = "";')
  .replace(/const SUPABASE_PUBLISHABLE_KEY = "[^"]*";/, 'const SUPABASE_PUBLISHABLE_KEY = "";')
  .replace(/const FIREBASE_PROJECT_ID = "[^"]*";/, 'const FIREBASE_PROJECT_ID = "";')
  .replace(/const FIREBASE_API_KEY = "[^"]*";/, 'const FIREBASE_API_KEY = "";')
  .replace(/clearPassport\(\);\s*loadPublicContent\(\);\s*loadSponsorStrip\(\);\s*$/, '');

function app({ configured = true, authConfigured = true, handle, storage = new Map() } = {}) {
  const nodes = new Map();
  const calls = [];
  let document;
  function element() {
    const classes = new Set();
    return {
      textContent: '', value: '', hidden: false, disabled: false, isConnected: true,
      style: {}, dataset: {}, children: [], attributes: {}, listeners: {},
      classList: { add: x => classes.add(x), remove: x => classes.delete(x),
        contains: x => classes.has(x), toggle: (x, yes) => yes ? classes.add(x) : classes.delete(x) },
      setAttribute(k, v) { this.attributes[k] = v; },
      addEventListener(k, fn) { this.listeners[k] = fn; },
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      focus() { document.activeElement = this; }, reportValidity() { return true; },
      click() { (document.clicked ??= []).push(this); }, remove() {}
    };
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  document = { body: element(), activeElement: null, title: '', listeners: {},
    getElementById: get, createElement: element, createElementNS: (ns, tag) => element(), querySelectorAll: () => [],
    addEventListener(k, fn) { this.listeners[k] = fn; } };
  const publicData = path => path.includes('/site_content') ? [{ key: 'page_title', value: 'Evento teste' }]
    : path.includes('/activities') ? [{ id: 'mesa', name: '<img src=x onerror=alert(1)>', description: 'Descrição', category: 'Categoria' }] : [];
  const blobs = [];
  class BrowserURL extends URL {
    static createObjectURL(blob){blobs.push(blob);return 'blob:'+blobs.length;}
    static revokeObjectURL(){}
  }
  const context = vm.createContext({ document, AbortController, Date, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval,
    location:{hostname:'localhost'},
    sessionStorage: {getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    confirm: () => true, Blob, atob, matchMedia: () => ({ matches: true }),
    URL: BrowserURL,
    fetch: async (url, options) => {
      const path = new URL(url).pathname + new URL(url).search;
      calls.push({ path, url, options });
      const result = handle ? await handle(path, options, publicData) : publicData(path);
      if (result?.status) return { ok: false, status: result.status, json: async () => ({ message: 'Detalhe interno privado', code: result.code }) };
      return { ok: true, status: 200, json: async () => result };
    }
  });
  const configuredSource = configured ? source
    .replace('const SUPABASE_URL = "";', 'const SUPABASE_URL = "https://example.supabase.co";')
    .replace('const SUPABASE_PUBLISHABLE_KEY = "";', 'const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";') : source;
  const readySource = authConfigured ? configuredSource
    .replace('const FIREBASE_PROJECT_ID = "";', 'const FIREBASE_PROJECT_ID = "seccim-test";')
    .replace('const FIREBASE_API_KEY = "";', 'const FIREBASE_API_KEY = "AIza_test_key";') : configuredSource;
  vm.runInContext(readySource, context);
  const run = value => vm.runInContext(value, context);
  return { get, calls, run, document, blobs,
    submit: id => get(id).listeners.submit({ preventDefault() {} }),
    click: id => get(id).listeners.click(),
    start: async () => { run('clearPassport()'); await run('loadPublicContent()'); }
  };
}

const session = { idToken: 'jwt', refreshToken: 'refresh', expiresIn: '3600' };
const passport = { participant: { id: 'uuid', full_name: 'Pessoa teste' }, earnedBadges: ['mesa'] };

const editorialActivity={id:'mesa',name:'Palestra',category:'Dados',description:'Texto',short_description:'Resumo',
  speaker_name:'Ana',speaker_bio:'Mini bio',speaker_photo_url:null,event_date:'2026-11-04',
  starts_at:'2026-11-04T17:00:00Z',ends_at:'2026-11-04T18:00:00Z',speaker_socials:{},slides_url:null,content_revision:0};

test('editor carrega, pré-visualiza e envia dados com revisão e horário de Brasília',async()=>{
  const storage=new Map();
  const a=app({storage,handle:(path,options,pub)=>{
    if(path.includes('/admin/activity-content'))return {activity:{...editorialActivity,...(options.method==='POST'?JSON.parse(options.body).content:{}),content_revision:options.method==='POST'?1:0}};
    if(path.includes('/admin/attendance'))return {activities:[{id:'mesa',name:'Palestra'}],participants:1};
    return pub(path);
  }});
  await a.start();a.run('saveSession({idToken:"jwt",refreshToken:"refresh",expiresIn:"3600"});faqState.ready=true');
  a.get('editorActivity').value='mesa';await a.run('loadEditor()');
  assert.equal(a.get('editorStart').value,'14:00');assert.equal(a.get('editorSave').disabled,false);
  a.get('editorName').value='Nome editado';a.get('editorPhoto').value='https://res.cloudinary.com/demo/image/upload/ana.jpg';
  a.click('editorPreview');
  const preview=JSON.parse(storage.get('seccim.content.preview'));
  assert.equal(preview.name,'Nome editado');assert.equal(preview.starts_at,'2026-11-04T14:00:00-03:00');
  assert.equal(a.get('editorPreviewFrame').hidden,false);
  await a.submit('editorForm');
  const write=a.calls.find(c=>c.path.includes('/admin/activity-content')&&c.options.method==='POST');
  assert.equal(JSON.parse(write.options.body).revision,0);assert.equal(JSON.parse(write.options.body).content.name,'Nome editado');
  assert.equal(a.run('editorState.revision'),1);a.click('logoutButton');
  assert.equal(a.get('editorForm').hidden,true);assert.equal(storage.get('seccim.content.preview'),undefined);
});

test('editor do sobre mim: bio com contador, redes completam https e erro aponta o campo',async()=>{
  const a=app({handle:(path,options,pub)=>{
    if(path.includes('/admin/activity-content'))return {activity:{...editorialActivity,...(options.method==='POST'?JSON.parse(options.body).content:{}),content_revision:options.method==='POST'?1:0}};
    if(path.includes('/admin/attendance'))return {activities:[{id:'mesa',name:'Palestra'}],participants:1};
    return pub(path);
  }});
  await a.start();a.run('saveSession({idToken:"jwt",refreshToken:"refresh",expiresIn:"3600"});faqState.ready=true');
  a.get('editorActivity').value='mesa';await a.run('loadEditor()');
  assert.equal(a.get('editorBio').value,'Mini bio');assert.equal(a.get('editorBioCount').textContent,'8 / 4000 caracteres');
  a.get('editorBio').value='Linha 1\nLinha 2';a.get('editorBio').listeners.input();
  assert.equal(a.get('editorBioCount').textContent,'15 / 4000 caracteres');
  a.get('editorLinkedin').value='https://linkedin.com.evil.test/in/ana';
  await a.submit('editorForm');
  assert.match(a.get('editorMessage').textContent,/link do LinkedIn precisa ser um endereço https do linkedin\.com/);
  assert(!a.calls.some(c=>c.path.includes('/admin/activity-content')&&c.options.method==='POST'));
  a.get('editorLinkedin').value='br.linkedin.com/in/ana';a.get('editorYoutube').value='https://m.youtube.com/@ana';
  a.get('editorInstagram').value='  instagram.com/ana ';a.get('editorSlides').value='docs.google.com/slides';
  await a.submit('editorForm');
  const sent=JSON.parse(a.calls.find(c=>c.path.includes('/admin/activity-content')&&c.options.method==='POST').options.body).content;
  assert.equal(sent.speaker_bio,'Linha 1\nLinha 2');
  assert.deepEqual(sent.speaker_socials,{instagram:'https://instagram.com/ana',linkedin:'https://br.linkedin.com/in/ana',youtube:'https://m.youtube.com/@ana'});
  assert.equal(sent.slides_url,'https://docs.google.com/slides');
  assert.equal(a.get('editorLinkedin').value,'https://br.linkedin.com/in/ana');
  a.get('editorPhoto').value='/fotos/../index.html';await a.submit('editorForm');
  assert.match(a.get('editorMessage').textContent,/Foto: use \/fotos\/nome\.webp/);
  a.get('editorPhoto').value='/fotos/mesa.webp';a.get('editorPhoto').listeners.input();
  assert.equal(a.get('editorPhotoPreview').hidden,false);assert.equal(a.get('editorPhotoPreview').src,'/fotos/mesa.webp');
  await a.submit('editorForm');
  const withPhoto=a.calls.filter(c=>c.path.includes('/admin/activity-content')&&c.options.method==='POST').at(-1);
  assert.equal(JSON.parse(withPhoto.options.body).content.speaker_photo_url,'/fotos/mesa.webp');
  a.click('logoutButton');assert.equal(a.get('editorBioCount').textContent,'0 / 4000 caracteres');
});

test('editor local oferece prévia sem simular salvamento quando API ainda não está habilitada',async()=>{
  const a=app();await a.start();a.run('saveSession({idToken:"jwt",refreshToken:"refresh",expiresIn:"3600"})');
  a.get('editorActivity').value='mesa';await a.run('loadEditor()');
  assert.equal(a.get('editorForm').hidden,false);assert.equal(a.get('editorSave').disabled,true);
  assert.match(a.get('editorMessage').textContent,/salvamento ficará disponível/);
});

test('editor preserva campos após conflito de edição e bloqueia sobrescrita',async()=>{
  const a=app({handle:(path,options,pub)=>path.includes('/admin/activity-content')
    ? options.method==='POST'?{status:409,code:'CONTENT_CONFLICT'}:{activity:editorialActivity}:pub(path)});
  await a.start();a.run('saveSession({idToken:"jwt",refreshToken:"refresh",expiresIn:"3600"})');
  a.get('editorActivity').value='mesa';await a.run('loadEditor()');a.get('editorName').value='Meu rascunho';
  await a.submit('editorForm');
  assert.equal(a.get('editorName').value,'Meu rascunho');assert.equal(a.get('editorSave').disabled,true);
  assert.match(a.get('editorMessage').textContent,/Outra pessoa alterou/);
});

test('navegação restaura sessão na mesma aba e sair a remove',async()=>{
  const storage=new Map();
  const handle=(path,options,pub)=>path.includes('/functions/v1/passport') ? passport : pub(path);
  const before=app({storage,handle});await before.start();
  before.run('saveSession({idToken:"jwt",refreshToken:"refresh",expiresIn:"3600"})');
  const after=app({storage,handle});await after.start();
  assert.equal(after.get('authSection').hidden,true);
  assert.equal(after.get('participantName').textContent,'Pessoa teste');
  after.click('logoutButton');assert.equal(storage.size,0);
  const signedOut=app({storage,handle});await signedOut.start();assert.equal(signedOut.get('authSection').hidden,false);
});

test('sessão salva rejeitada pelo servidor é descartada',async()=>{
  const storage=new Map([['seccim.auth.session',JSON.stringify({idToken:'revoked',refreshToken:'refresh',expiresAt:Date.now()+3600000})]]);
  const a=app({storage,handle:(path,options,pub)=>path.includes('/functions/v1/passport') ? {status:401} : pub(path)});
  await a.start();assert.equal(storage.size,0);assert.equal(a.get('authSection').hidden,false);
});

test('FAQ envia e edita pergunta anônima, restringe controles ao autor e limpa no logout', async () => {
  let question = {id:'11111111-1111-1111-1111-111111111111',body:'<script>teste</script>',anonymous:true,mine:true,author:'Anônimo',createdAt:'2026-11-03T12:00:00Z',updatedAt:'2026-11-03T12:00:00Z'};
  const a = app({handle:(path,options,pub)=> {
    if(path.includes('/passport/questions')) {
      if(options.method !== 'GET') {const input=JSON.parse(options.body); question={...question,...input}; return {id:question.id};}
      return {questions:[question,{...question,id:'outro',mine:false}],hasMore:false};
    }
    if(path.includes('/functions/v1/passport')) return passport;
    return pub(path);
  }});
  await a.start();
  a.run('saveSession({idToken:"jwt",refreshToken:"refresh",expiresIn:"3600"})'); await a.run('loadPassport()');
  a.get('faqActivity').value='mesa'; await a.run('loadQuestions()');
  assert.equal(a.get('faqList').children[0].children[1].textContent,'<script>teste</script>');
  assert.equal(a.get('faqList').children[0].children.length,3);
  assert.equal(a.get('faqList').children[1].children.length,2);
  a.get('faqList').children[0].children[2].children[0].listeners.click();
  a.get('faqBody').value='Pergunta editada'; a.get('faqAnonymous').checked=false;
  await a.submit('faqForm');
  const write=a.calls.find(c=>c.options.method==='PATCH');
  assert.equal(JSON.parse(write.options.body).anonymous,false);
  assert.equal(JSON.parse(write.options.body).body,'Pergunta editada');
  assert.equal(write.options.headers.Authorization,'Bearer jwt');
  a.get('faqBody').value='Nova pergunta'; a.get('faqAnonymous').checked=true; await a.submit('faqForm');
  assert(a.calls.some(c=>c.options.method==='POST' && JSON.parse(c.options.body).anonymous===true));
  a.click('logoutButton'); assert.equal(a.get('faqList').children.length,0); assert.equal(a.get('faqForm').hidden,true);
});

test('FAQ descarta resposta atrasada após logout', async () => {
  let release; const pending=new Promise(resolve=>{release=resolve;});
  const a=app({handle:async(path,options,pub)=>path.includes('/passport/questions') ? (await pending,{questions:[{id:'q',body:'privada'}]}) : pub(path)});
  await a.start(); a.run('saveSession({idToken:"jwt",refreshToken:"refresh",expiresIn:"3600"}); faqState.ready=true');
  a.get('faqActivity').value='mesa'; const loading=a.run('loadQuestions()'); await Promise.resolve();
  a.click('logoutButton'); release(); await loading;
  assert.equal(a.get('faqList').children.length,0);
});

test('sem configuração não envia autenticação; catálogo funciona sem Firebase', async () => {
  const a = app({ configured: false }); await a.start();
  assert.equal(a.calls.length, 0); assert.equal(a.get('authSubmit').disabled, true);
  const b = app({ authConfigured: false }); await b.start();
  assert.equal(b.calls.length, 2); assert.equal(b.get('authSubmit').disabled, true);
});

test('catálogo público usa texto seguro e não consulta dados privados', async () => {
  const a = app(); await a.start();
  assert.equal(a.document.title, 'Evento teste');
  assert.equal(a.get('badgeGrid').children.length, 0);
  assert.equal(a.get('pageTabs').hidden, true);
  assert.equal(a.get('passportPanel').hidden, true);
  assert.equal(a.get('loginMode').hidden, true);
  a.click('signupMode');
  assert.equal(a.get('signupMode').hidden, true);
  assert.equal(a.get('loginMode').hidden, false);
  assert.equal(a.get('progressPercent').textContent, '—');
  assert(a.calls.every(c => !c.options.headers.Authorization && c.options.credentials === 'omit'));
});

test('login envia senha somente ao Firebase e usa token na Edge Function', async () => {
  const a = app({ handle: (path, options, pub) => path.includes('accounts:signInWithPassword') ? session : path.includes('/functions/v1/passport') ? passport : pub(path) });
  await a.start(); a.get('email').value = 'Pessoa@Example.com'; a.get('password').value = 'senha-de-teste';
  await a.submit('authForm');
  assert.equal(a.get('participantName').textContent, 'Pessoa teste');
  assert.equal(a.get('progressPercent').textContent, '100%');
  assert.equal(a.get('passportPanel').hidden, false);
  assert.equal(a.get('pageTabs').hidden, false);
  assert.equal(a.get('password').value, '');
  const credentialCall = a.calls.find(c => c.url.includes('identitytoolkit'));
  assert.equal(JSON.parse(credentialCall.options.body).password, 'senha-de-teste');
  assert.equal(JSON.parse(credentialCall.options.body).email, 'pessoa@example.com');
  const privateCall = a.calls.find(c => c.path === '/functions/v1/passport');
  assert.equal(privateCall.options.headers.Authorization, 'Bearer jwt');
  assert.equal(privateCall.options.body, undefined);
  assert(!a.calls.some(c => /rest.*participants|rest.*attendances/.test(c.path)));
  assert(!JSON.stringify(a.run('state')).includes('senha-de-teste'));
});

test('cadastro exige confirmação e permite consultar após validar e-mail', async () => {
  const a = app({ handle: (path, options, pub) => path.includes('accounts:signUp') ? session
    : path.includes('accounts:update') ? { localId: 'firebase-user', displayName: 'Pessoa teste' }
    : path.includes('sendOobCode') ? {} : path.includes('/functions/v1/passport') ? passport : pub(path) });
  await a.start(); a.click('signupMode');
  a.get('email').value = 'a@example.com'; a.get('fullName').value = 'Pessoa teste'; a.get('password').value = 'Teste123';
  await a.submit('authForm');
  assert.equal(a.get('verificationPanel').hidden, false);
  assert(!a.calls.some(c => c.path === '/functions/v1/passport'));
  const sent = a.calls.find(c => c.path.includes('sendOobCode'));
  assert.equal(JSON.parse(sent.options.body).requestType, 'VERIFY_EMAIL');
  assert.equal(JSON.parse(sent.options.body).idToken, session.idToken);
  await a.click('checkVerification');
  assert.equal(a.get('authSection').hidden, true);
  assert.equal(a.get('participantName').textContent, 'Pessoa teste');
});

test('login com e-mail não confirmado mantém dados privados escondidos', async () => {
  const a = app({ handle: (path, options, pub) => path.includes('signInWithPassword') ? session
    : path.includes('/functions/v1/passport') ? { status: 403, code: 'EMAIL_NOT_VERIFIED' } : pub(path) });
  await a.start(); a.get('email').value = 'a@example.com'; a.get('password').value = 'teste';
  await a.submit('authForm');
  assert.equal(a.get('verificationPanel').hidden, false);
  assert.equal(a.get('participantName').textContent, 'Participante');
  assert.equal(a.get('progressPercent').textContent, '—');
  assert(a.run('state.session'));
});

test('recuperação apresenta a mesma mensagem para e-mail conhecido ou ausente', async () => {
  const messages = [];
  for (const status of [200, 400]) {
    const a = app({ handle: (path, options, pub) => path.includes('sendOobCode') ? status === 400 ? { status: 400 } : {} : pub(path) });
    await a.start(); a.get('email').value = 'a@example.com'; await a.click('resetPassword');
    messages.push(a.get('authMessage').textContent);
    assert.equal(JSON.parse(a.calls.find(c => c.path.includes('sendOobCode')).options.body).requestType, 'PASSWORD_RESET');
  }
  assert.equal(messages[0], messages[1]);
});

test('senha curta no cadastro e erro de login não vazam mensagens internas', async () => {
  const a = app({ handle: (path, options, pub) => path.includes('signInWithPassword') ? { status: 400 } : pub(path) });
  await a.start(); a.click('signupMode'); a.get('fullName').value = 'Teste';
  for (const invalid of ['123', '12345678', 'abcdefgh', 'Abc1234']) {
    a.get('password').value = invalid;
    await a.submit('authForm'); assert.equal(a.calls.length, 2);
  }
  a.click('loginMode'); a.get('email').value = 'a@example.com'; a.get('password').value = 'invalida';
  await a.submit('authForm');
  assert(a.get('authMessage').classList.contains('error'));
  assert(!a.get('authMessage').textContent.includes('Detalhe interno'));
  assert.equal(a.get('password').value, '');
});

test('renovação usa Firebase Secure Token e falha de autenticação limpa sessão', async () => {
  const a = app({ handle: (path, options, pub) => path.includes('/v1/token') ? { id_token: 'novo', refresh_token: 'refresh2', expires_in: '3600' }
    : path.includes('/functions/v1/passport') ? { status: 401 } : pub(path) });
  await a.start(); a.run('saveSession({idToken:"antigo",refreshToken:"secreto",expiresIn:"1"})');
  await a.run('loadPassport()');
  const refresh = a.calls.find(c => c.url.includes('securetoken.googleapis.com'));
  assert.equal(refresh.options.body, 'grant_type=refresh_token&refresh_token=secreto');
  assert.equal(a.calls.find(c => c.path === '/functions/v1/passport').options.headers.Authorization, 'Bearer novo');
  assert.equal(a.run('state.session'), null);
});

test('logout durante consulta impede restauração de dados por resposta atrasada', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const a = app({ handle: async (path, options, pub) => {
    if (path.includes('/functions/v1/passport')) { await pending; return passport; } return pub(path);
  } });
  await a.start(); a.run('saveSession({idToken:"jwt",refreshToken:"refresh",expiresIn:"3600"})');
  const loading = a.run('loadPassport()'); await Promise.resolve(); a.click('logoutButton'); release(); await loading;
  assert.equal(a.get('participantName').textContent, 'Participante'); assert.equal(a.run('state.session'), null);
  assert.equal(a.get('passportPanel').hidden, true);
  assert.equal(a.get('faqPanel').hidden, true);
  assert.equal(a.get('badgeGrid').children.length, 0);
});

test('catálogo vazio, falha temporária e modal continuam acessíveis', async () => {
  let failed = true;
  const a = app({ handle: (path, options, pub) => { if (failed) throw Error('rede'); return pub(path); } });
  await a.start(); assert.equal(a.get('retryButton').hidden, false);
  failed = false; await a.click('retryButton');
  a.run('renderBadges(true)');
  const card = a.get('badgeGrid').children[0].children[0]; card.focus(); card.listeners.click();
  assert.equal(a.get('pageContent').inert, true); assert.equal(a.document.activeElement, a.get('modalClose'));
  let prevented = false;
  a.document.listeners.keydown({ key: 'Tab', shiftKey:true, preventDefault() { prevented = true; } }); assert(prevented);
  assert.equal(a.document.activeElement,a.get('registrationLink'));
  a.document.listeners.keydown({ key:'Tab', preventDefault() {} });
  assert.equal(a.document.activeElement,a.get('modalClose'));
  assert.match(html,/id="registrationLink"[^>]*href="https:\/\/docs.google.com\/forms\/d\/e\/1FAIpQLSeUgomV8-PWdPO460JppqLMC3wEoqa-dJcnX9T7KOm7lMLtdw\/viewform"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  a.document.listeners.keydown({ key: 'Escape' }); assert.equal(a.document.activeElement, card);
  assert.equal(a.get('pageContent').inert, false);
  a.run('state.badges = []; renderBadges(true)'); assert.equal(a.get('progressPercent').textContent, '0%');
});

test('ranking exige login, renderiza nomes como texto e limpa ao sair', async () => {
  const a=app({handle:(path,options,pub)=> {
    if(path.includes('/passport/ranking')) return {entries:[{position:1,name:'<script>nome</script>',badgeCount:3,isMe:true}],mine:{position:1,badgeCount:3}};
    if(path.includes('/functions/v1/passport')) return passport;
    return pub(path);
  }});
  await a.start(); await a.run('loadRanking()');
  assert.equal(a.get('rankingPanel').hidden,true);
  assert(!a.calls.some(c=>c.path.includes('/passport/ranking')));
  a.run('saveSession({idToken:"jwt",refreshToken:"refresh",expiresIn:"3600"})'); await a.run('loadPassport()');
  a.run('switchSection("ranking")'); await a.run('loadRanking()');
  assert.equal(a.get('rankingPanel').hidden,false); assert.equal(a.get('passportPanel').hidden,true);
  assert.equal(a.get('rankingList').children[0].children[2].textContent,'<script>nome</script> (você)');
  assert.match(a.get('rankingSummary').textContent,/1º.*3 selos/);
  a.click('logoutButton'); assert.equal(a.get('rankingList').children.length,0); assert.equal(a.get('rankingPanel').hidden,true);
});

test('ranking descarta resultado recebido após logout', async () => {
  let release; const pending=new Promise(resolve=>{release=resolve;});
  const a=app({handle:async(path,options,pub)=>path.includes('/passport/ranking') ? (await pending,{entries:[{position:1,name:'Pessoa',badgeCount:2}],mine:{position:1,badgeCount:2}}) : pub(path)});
  await a.start(); a.run('saveSession({idToken:"jwt",refreshToken:"refresh",expiresIn:"3600"}); faqState.ready=true');
  const loading=a.run('loadRanking()'); await Promise.resolve(); a.click('logoutButton'); release(); await loading;
  assert.equal(a.get('rankingList').children.length,0);
});

const overview = { participants: 2, activities: [
  { id: 'mesa', name: 'Mesa', eventDate: '2026-11-04', raffleEligible: true, attendances: 1 },
  { id: 'kafka', name: 'Kafka', eventDate: null, raffleEligible: true, attendances: 0 }] };
const person = { id: '11111111-1111-4111-8111-111111111111', name: '<b>Ana</b>', email: 'ana@example.com', present: false };

const drawState = { drawnId: null, reel: [], remainingParticipants: 2, totalEntries: 3, draws: [] };
const winner = { id: '22222222-2222-4222-8222-222222222222', name: '<i>Bia</i>', prize: 'Caneca', absent: false, drawnAt: '2026-11-04T20:00:00Z', chances: 2 };

const sponsorsList = [{ id: 'empresa-x', name: 'Empresa X', tagline: 'Frase', about: '', contributions: ['Coffee break'],
  logo_url: '/fotos/patrocinadores/empresa-x.png', photos: [{ url: '/fotos/patrocinadores/empresa-x-1.webp', caption: 'Estande' }],
  links: { vagas: 'https://x.example/vagas' }, published: false, content_revision: 2 }];
function adminApp({ denied = false, raffle, draws = drawState, personActivities = [] } = {}) {
  return app({ handle: (path, options, pub) => {
    if (path.includes('/passport/admin/raffle')) return raffle;
    if (path.includes('/passport/admin/person')) {
      if (options.method === 'POST') {
        const input = JSON.parse(options.body);
        return { added: input.add.length, removed: input.remove.length, participant: person, activities: input.add };
      }
      return { participant: person, activities: personActivities };
    }
    if (path.includes('/passport/admin/participants')) {
      const input = JSON.parse(options.body);
      return { created: true, changed: true, participant: { id: person.id, name: input.name, email: input.email, linked: false } };
    }
    if (path.includes('/passport/admin/sponsors')) {
      if (options.method === 'POST') {
        const input = JSON.parse(options.body);
        const saved = { id: input.id, ...input.content, content_revision: (input.revision ?? 0) + 1 };
        return { sponsor: saved, sponsors: [saved] };
      }
      return { sponsor: null, sponsors: sponsorsList };
    }
    if (path.includes('/passport/admin/draws')) {
      if (options.method === 'POST') return { ...draws, drawnId: winner.id, reel: ['Ana', 'Bia'], remainingParticipants: 1, draws: [winner] };
      if (options.method === 'PATCH') return { ...draws, remainingParticipants: 1, draws: [{ ...winner, absent: true }] };
      if (options.method === 'DELETE') return { ...draws, remainingParticipants: 2, draws: [] };
      return draws;
    }
    if (path.includes('/passport/admin/attendance')) {
      if (denied) return { status: 403, code: 'ADMIN_REQUIRED' };
      if (options.method === 'POST' || options.method === 'DELETE') return { changed: true };
      if (path.includes('action=overview')) return overview;
      if (path.includes('action=search')) return { participants: [person] };
      if (path.includes('action=list')) return { total: 1, attendees: [{ ...person, recordedAt: '2026-11-04T12:00:00Z' }] };
    }
    if (path.includes('/functions/v1/passport')) return passport;
    return pub(path);
  } });
}
const login = async a => { await a.start(); a.run('saveSession({idToken:"jwt",refreshToken:"refresh",expiresIn:"3600"})'); await a.run('loadPassport()'); await a.run('loadAdmin()'); };

test('aba da organização só aparece quando o banco autoriza a conta', async () => {
  const a = adminApp({ denied: true }); await login(a);
  assert.equal(a.get('adminTab').hidden, true);
  a.run('switchSection("admin")'); assert.equal(a.get('adminPanel').hidden, true); assert.equal(a.get('passportPanel').hidden, false);
  const b = adminApp(); await login(b);
  assert.equal(b.get('adminTab').hidden, false);
  assert.equal(b.get('adminActivity').children[1].textContent, '04/11 · Mesa (1)');
  assert.equal(b.get('raffleDate').children.length, 1);
  await b.run('loadDraws()');
  assert.match(b.get('raffleStats').textContent, /3 chances no dia · 2 pessoas ainda podem ganhar · 1 atividade\(s\) sem data/);
  assert.equal(b.get('raffleDraw').disabled, false);
  b.click('logoutButton');
  assert.equal(b.get('adminTab').hidden, true); assert.equal(b.get('adminPanel').hidden, true);
  assert.equal(b.get('adminResults').children.length, 0);
});

test('organização busca, registra presença como texto seguro e prepara a próxima busca', async () => {
  const a = adminApp(); await login(a);
  a.run('switchSection("admin")'); assert.equal(a.get('adminPanel').hidden, false);
  a.get('adminActivity').value = 'mesa'; a.get('adminActivity').listeners.change();
  assert.equal(a.get('adminSearch').disabled, false);
  a.get('adminSearch').value = ' an '; await a.run('searchParticipants()');
  const search = a.calls.find(c => c.path.includes('action=search'));
  assert.match(search.path, /activity=mesa&q=an$/);
  const row = a.get('adminResults').children[0];
  assert.equal(row.children[0].children[0].textContent, '<b>Ana</b>');
  assert.equal(row.children.at(-1).textContent, 'Várias palestras');
  await row.children.find(c => c.textContent === 'Registrar presença').listeners.click();
  const write = a.calls.find(c => c.options.method === 'POST');
  assert.deepEqual(JSON.parse(write.options.body), { activity: 'mesa', participant: person.id });
  assert.equal(write.options.headers.Authorization, 'Bearer jwt');
  assert.match(a.get('adminMessage').textContent, /Presença registrada/);
  assert.equal(a.get('adminSearch').value, ''); assert.equal(a.document.activeElement, a.get('adminSearch'));
  await a.run('loadAttendees()');
  assert.equal(a.get('adminCount').textContent, '1 PRESENTE');
  await a.get('adminAttendees').children[0].children.at(-1).listeners.click();
  assert(a.calls.some(c => c.options.method === 'DELETE'));
});

test('lista do sorteio repete nomes por chance e recusa presenças sem data', async () => {
  const entry = { ticketId: 't1', participantId: 'p', name: ' Ana   Souza ', activityId: 'mesa', activityName: 'Mesa' };
  const raffle = { totalEntries: 2, uniqueParticipants: 1, hasMore: false, pendingAttendances: 0,
    entries: [entry, { ...entry, ticketId: 't2' }], unconfiguredActivities: [] };
  const a = adminApp({ raffle }); await login(a);
  await a.run('exportRaffle()');
  assert.equal(await a.blobs[0].text(), 'Ana Souza\nAna Souza\n');
  assert.match(a.get('raffleMessage').textContent, /2 chances de 1 participantes/);
  const b = adminApp({ raffle: { ...raffle, pendingAttendances: 3 } }); await login(b);
  await b.run('exportRaffle()');
  assert.equal(b.blobs.length, 0); assert.match(b.get('raffleMessage').textContent, /sem data/);
});

test('cadastro na hora aproveita a busca e registra presença de quem não tem conta', async () => {
  const a = adminApp(); await login(a);
  a.get('adminActivity').value = 'mesa'; a.get('adminActivity').listeners.change();
  assert.equal(a.get('walkinToggle').disabled, false);
  a.get('adminSearch').value = 'Maria Silva'; a.click('walkinToggle');
  assert.equal(a.get('walkinForm').hidden, false); assert.equal(a.get('walkinName').value, 'Maria Silva');
  assert.equal(a.document.activeElement, a.get('walkinEmail'));
  a.get('walkinEmail').value = 'invalido'; await a.submit('walkinForm');
  assert(!a.calls.some(c => c.path.includes('/admin/participants')));
  assert(a.get('adminMessage').classList.contains('error'));
  a.get('walkinEmail').value = ' Maria@Example.com '; await a.submit('walkinForm');
  const write = a.calls.find(c => c.path.includes('/admin/participants'));
  assert.deepEqual(JSON.parse(write.options.body), { activity: 'mesa', name: 'Maria Silva', email: 'maria@example.com' });
  assert.equal(write.options.headers.Authorization, 'Bearer jwt');
  assert.match(a.get('adminMessage').textContent, /Cadastro criado: Maria Silva está presente/);
  assert.equal(a.get('walkinForm').hidden, true); assert.equal(a.get('adminSearch').value, '');
  // Em seguida abre a lista de palestras para marcar as outras do dia.
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(a.get('multiPanel').hidden, false);
  assert.equal(a.get('multiTitle').textContent, 'Presenças de Maria Silva');
});

test('sorteio no painel mostra o ganhador escolhido pelo servidor e permite marcar ausente', async () => {
  const a = adminApp(); await login(a); await a.run('loadDraws()');
  a.get('rafflePrize').value = ' Caneca ';
  await a.click('raffleDraw');
  const draw = a.calls.find(c => c.path.includes('/admin/draws') && c.options.method === 'POST');
  assert.deepEqual(JSON.parse(draw.options.body), { date: '2026-11-04', prize: 'Caneca', sponsor: null });
  assert.equal(a.get('raffleName').textContent, '<i>Bia</i>');
  assert.equal(a.get('rafflePrizeLabel').textContent, '🎁 Caneca');
  assert(a.get('raffleReel').classList.contains('winner'));
  assert.match(a.get('raffleMessage').textContent, /Bia<\/i> ganhou Caneca! Tinha 2 chances/);
  assert.equal(a.get('rafflePrize').value, '');
  assert.equal(a.get('confetti').children.length, 0);
  const row = a.get('raffleWinners').children[0];
  assert.equal(row.children[0].children[0].textContent, '🏆 1º · <i>Bia</i>');
  const [absentButton, deleteButton] = row.children.at(-1).children;
  assert.equal(absentButton.textContent, 'Ausente'); assert.equal(deleteButton.textContent, 'Apagar');
  await absentButton.listeners.click();
  const absent = a.calls.find(c => c.options.method === 'PATCH');
  assert.deepEqual(JSON.parse(absent.options.body), { date: '2026-11-04', id: winner.id });
  const absentRow = a.get('raffleWinners').children[0];
  assert.match(absentRow.children[0].children[1].textContent, /ausente/);
  assert.deepEqual(absentRow.children.at(-1).children.map(b => b.textContent), ['Apagar']);
  await absentRow.children.at(-1).children[0].listeners.click();
  const removed = a.calls.find(c => c.options.method === 'DELETE');
  assert.deepEqual(JSON.parse(removed.options.body), { date: '2026-11-04', id: winner.id });
  assert.equal(a.get('raffleWinners').children.length, 0);
  assert.equal(a.get('raffleName').textContent, 'Quem será?');
  assert.match(a.get('raffleMessage').textContent, /apagado/);
  a.click('logoutButton');
  assert.equal(a.get('raffleWinners').children.length, 0); assert.equal(a.get('raffleName').textContent, 'Quem será?');
});

test('rodapé aponta para as redes oficiais em nova aba sem vazar a página de origem', () => {
  for (const url of ['https://www.instagram.com/seccim_ufrrj/', 'https://www.linkedin.com/in/seccim/']) {
    assert.match(html, new RegExp(`href="${url.replace(/[.\/]/g, m => '\\' + m)}" target="_blank" rel="noopener noreferrer"`));
  }
});

test('várias palestras: marca o dia inteiro e salva só a diferença numa chamada', async () => {
  const a = adminApp({ personActivities: ['kafka'] }); await login(a);
  a.get('adminActivity').value = 'mesa'; a.get('adminActivity').listeners.change();
  a.get('adminSearch').value = 'ana'; await a.run('searchParticipants()');
  await a.get('adminResults').children[0].children.at(-1).listeners.click();
  assert.equal(a.get('multiPanel').hidden, false);
  assert.equal(a.get('multiTitle').textContent, 'Presenças de <b>Ana</b>');
  const [dayWithDate, undated] = a.get('multiDays').children;
  assert.match(dayWithDate.children[0].children[0].textContent, /04\/11/);
  assert.equal(undated.children[0].children[0].textContent, 'Sem data');
  // A atividade em andamento vem pré-marcada; a já registrada aparece marcada como salva.
  assert.equal(dayWithDate.children[1].children[0].checked, true);
  assert.equal(undated.children[1].className, 'multi-option saved');
  assert.equal(a.get('multiSave').textContent, 'Salvar (+1)');
  // Desmarcar a já registrada vira remoção; "Marcar todas" do dia mantém a pré-marcada.
  a.get('multiDays').children[1].children[1].children[0].checked = false;
  a.get('multiDays').children[1].children[1].children[0].listeners.change();
  assert.equal(a.get('multiSave').textContent, 'Salvar (+1 / −1)');
  await a.click('multiSave');
  const save = a.calls.find(c => c.path.includes('/admin/person') && c.options.method === 'POST');
  assert.deepEqual(JSON.parse(save.options.body), { participant: person.id, add: ['mesa'], remove: ['kafka'] });
  assert.match(a.get('adminMessage').textContent, /1 presença registrada, 1 removida/);
  assert.equal(a.get('multiPanel').hidden, true); assert.equal(a.document.activeElement, a.get('adminSearch'));
});

test('várias palestras: sem mudança não salva e logout fecha o painel', async () => {
  const a = adminApp({ personActivities: ['mesa'] }); await login(a);
  a.get('adminActivity').value = 'mesa'; a.get('adminActivity').listeners.change();
  await a.run(`openMulti(${JSON.stringify(person)}, ['mesa'])`);
  assert.equal(a.get('multiSave').disabled, true);
  await a.click('multiSave');
  assert(!a.calls.some(c => c.path.includes('/admin/person') && c.options.method === 'POST'));
  a.get('multiDays').children[1].children[0].children[1].listeners.click();
  assert.equal(a.get('multiSave').textContent, 'Salvar (+1)');
  a.click('logoutButton');
  assert.equal(a.get('multiPanel').hidden, true); assert.equal(a.get('multiDays').children.length, 0);
});

test('patrocinadores: rodapé mostra só publicados em ordem alfabética, como texto seguro', async () => {
  const a = app({ handle: (path, options, pub) => path.includes('/rest/v1/sponsors')
    ? [{ id: 'zeta', name: 'Zeta', logo_url: 'javascript:alert(1)' }, { id: 'alfa', name: '<b>Alfa</b>', logo_url: '/fotos/patrocinadores/alfa.png' }, { id: 'Ruim X', name: 'Ruim' }]
    : pub(path) });
  await a.start(); await a.run('loadSponsorStrip()');
  const call = a.calls.find(c => c.path.includes('/rest/v1/sponsors'));
  assert.match(call.path, /published=eq\.true/); assert(!call.options.headers.Authorization);
  assert.equal(a.get('sponsorStrip').hidden, false);
  assert.equal(a.get('sponsorNav').hidden, false);
  const [first, second] = a.get('sponsorLogos').children.map(li => li.children[0]);
  assert.equal(a.get('sponsorLogos').children.length, 2);
  assert.equal(first.href, 'patrocinadores.html#alfa'); assert.equal(first.children[0].src, '/fotos/patrocinadores/alfa.png');
  assert.equal(second.children[0].textContent, 'Zeta');
  const empty = app(); await empty.start(); await empty.run('loadSponsorStrip()');
  assert.equal(empty.get('sponsorStrip').hidden, true);
  assert.equal(empty.get('sponsorNav').hidden, true);
});

test('patrocinadores: painel cria rascunho, valida links e imagens e edita com revisão', async () => {
  const a = adminApp(); await login(a); await a.run('loadSponsorsAdmin()');
  assert.equal(a.get('sponsorSelect').children.at(-1).textContent, 'Empresa X (rascunho)');
  assert.equal(a.get('raffleSponsor').children.at(-1).value, 'empresa-x');
  a.get('sponsorSelect').value = '__new'; a.get('sponsorSelect').listeners.change();
  a.get('sponsorName').value = 'Ação & Tecnologia Ltda'; a.get('sponsorName').listeners.input();
  assert.equal(a.get('sponsorId').value, 'acao-tecnologia-ltda');
  a.run('sponsorState.photos = [{ url: "/fotos/a.webp", caption: "fora da pasta" }]');
  await a.submit('sponsorForm'); assert.match(a.get('sponsorMessage').textContent, /fotos não é válida/);
  a.run('sponsorState.photos = [{ url: "/fotos/patrocinadores/acao-1.webp", caption: " Estande no hall " }, { url: "/fotos/patrocinadores/acao-2.webp", caption: "" }]');
  a.get('sponsorContributions').value = ' Coffee break \n\nCanecas ';
  a.get('sponsorVagas').value = 'acao.example/vagas'; a.get('sponsorLogo').value = '/fotos/patrocinadores/acao.png';
  await a.submit('sponsorForm');
  const created = JSON.parse(a.calls.filter(c => c.path.includes('/admin/sponsors') && c.options.method === 'POST').at(-1).options.body);
  assert.equal(created.revision, null); assert.equal(created.id, 'acao-tecnologia-ltda');
  assert.deepEqual(created.content.contributions, ['Coffee break', 'Canecas']);
  assert.deepEqual(created.content.photos, [{ url: '/fotos/patrocinadores/acao-1.webp', caption: 'Estande no hall' }, { url: '/fotos/patrocinadores/acao-2.webp' }]);
  assert.deepEqual(created.content.links, { vagas: 'https://acao.example/vagas' }); assert.equal(created.content.published, false);
  assert.match(a.get('sponsorMessage').textContent, /rascunho/); assert.equal(a.get('sponsorId').readOnly, true);
  a.get('sponsorPublished').checked = true; await a.submit('sponsorForm');
  const updated = JSON.parse(a.calls.filter(c => c.path.includes('/admin/sponsors') && c.options.method === 'POST').at(-1).options.body);
  assert.equal(updated.revision, 1); assert.equal(updated.content.published, true);
  assert.match(a.get('sponsorMessage').textContent, /publicado/);
  a.click('logoutButton'); assert.equal(a.get('sponsorForm').hidden, true); assert.equal(a.get('sponsorName').value, '');
});

test('sorteio mostra no telão o patrocinador do brinde', async () => {
  const draws = { drawnId: null, reel: [], remainingParticipants: 2, totalEntries: 3, draws: [] };
  const a = app({ handle: (path, options, pub) => {
    if (path.includes('/admin/sponsors')) return { sponsor: null, sponsors: sponsorsList };
    if (path.includes('/admin/draws')) return options.method === 'POST'
      ? { ...draws, drawnId: winner.id, reel: ['Bia'], draws: [{ ...winner, sponsor: 'Empresa X' }] } : draws;
    if (path.includes('/passport/admin/attendance')) return path.includes('overview') ? overview : { participants: [], total: 0, attendees: [] };
    if (path.includes('/functions/v1/passport')) return passport;
    return pub(path);
  } });
  await login(a); await a.run('loadSponsorsAdmin()'); await a.run('loadDraws()');
  a.get('rafflePrize').value = 'Caneca'; a.get('raffleSponsor').value = 'empresa-x';
  await a.click('raffleDraw');
  const sent = JSON.parse(a.calls.find(c => c.path.includes('/admin/draws') && c.options.method === 'POST').options.body);
  assert.equal(sent.sponsor, 'empresa-x');
  assert.equal(a.get('rafflePrizeLabel').textContent, '🎁 Caneca · oferecido por Empresa X');
  assert.equal(a.get('raffleSponsor').value, '');
  assert.match(a.get('raffleWinners').children[0].children[0].children[1].textContent, /Caneca \(Empresa X\)/);
});

test('inscrição abre o formulário com nome, e-mail e a palestra marcados, sem CPF', async () => {
  const jwt = ['eyJhbGciOiJSUzI1NiJ9', Buffer.from(JSON.stringify({ email: 'ana@example.com' })).toString('base64url'), 'assinatura'].join('.');
  const a = app({ handle: (path, options, pub) => path.includes('/functions/v1/passport') ? { participant: { id: 'uuid', full_name: 'Ana Souza' }, earnedBadges: [] } : pub(path) });
  await a.start();
  const anonymous = new URL(a.run('registrationUrl("equipe-robotica-shield-nig")'));
  assert.equal(anonymous.searchParams.get('entry.1304510494'), 'SHIELD NIG: Popularizando a robótica e a tecnologia  - 14:00');
  assert.equal(anonymous.searchParams.get('entry.157411751'), null); assert.equal(anonymous.searchParams.get('entry.1890638587'), null);
  a.run(`saveSession({idToken:"${jwt}",refreshToken:"refresh",expiresIn:"3600"})`); await a.run('loadPassport()');
  const url = new URL(a.run('registrationUrl("visao-sobre-ai-gateway")'));
  assert.equal(url.origin + url.pathname, 'https://docs.google.com/forms/d/e/1FAIpQLSeUgomV8-PWdPO460JppqLMC3wEoqa-dJcnX9T7KOm7lMLtdw/viewform');
  assert.equal(url.searchParams.get('usp'), 'pp_url');
  assert.equal(url.searchParams.get('entry.1304510494'), 'Uma visão sobre AI Gateway – LiteLLM - 18:00');
  assert.equal(url.searchParams.get('entry.157411751'), 'Ana Souza'); assert.equal(url.searchParams.get('entry.1890638587'), 'ana@example.com');
  assert(![...url.searchParams.keys()].some(k => /1058176488|85211041/.test(k)), 'CPF e matrícula ficam para a pessoa digitar');
  a.run('openBadge(0, true)');
  assert.equal(a.get('registrationLink').textContent, 'Link para inscrição');
  assert.match(a.get('registrationHint').textContent, /seu nome, e-mail/);
  a.click('logoutButton');
  assert.equal(new URL(a.run('registrationUrl("kafka-alem-das-filas")')).searchParams.get('entry.157411751'), null);
});

const fakeQrLib = 'globalThis.qrcode = () => ({ addData(value) { globalThis.lastQrData = value; }, make() {}, getModuleCount: () => 3, isDark: (r, c) => r === c });';

test('meu QR: mostra o código assinado pelo servidor, renova sozinho e some no logout', async () => {
  let n = 0;
  const a = app({ handle: (path, options, pub) => {
    if (path.includes('/passport/qr')) { n++; return { token: `S1.11111111-1111-4111-8111-111111111111.${n}.AAAAAAAAAAAAAAAAAAAAAA`, expiresAt: Date.now() + 1500, periodSeconds: 30, name: 'Ana <b>' }; }
    if (path.includes('/functions/v1/passport')) return passport;
    return pub(path);
  } });
  await a.start(); a.run(fakeQrLib);
  a.run('saveSession({idToken:"jwt",refreshToken:"refresh",expiresIn:"3600"})'); await a.run('loadPassport()');
  await a.click('qrOpen');
  assert.equal(a.get('qrBackdrop').hidden, false); assert.equal(a.get('pageContent').inert, true);
  assert.equal(a.get('qrName').textContent, 'Ana <b>');
  assert.equal(a.run('lastQrData'), 'S1.11111111-1111-4111-8111-111111111111.1.AAAAAAAAAAAAAAAAAAAAAA');
  const svg = a.get('qrCode').children[0]; assert.equal(svg.children.length, 2);
  assert.equal(svg.children[1].attributes.d, 'M4 4h1v1h-1zM5 5h1v1h-1zM6 6h1v1h-1z');
  assert.match(a.get('qrTimer').textContent, /Atualiza sozinho em \d s/);
  assert.equal(a.calls.find(c => c.path === '/functions/v1/passport/qr').options.headers.Authorization, 'Bearer jwt');
  await new Promise(resolve => setTimeout(resolve, 2000));
  assert.equal(a.run('lastQrData').split('.')[2], '2', 'renovou depois de expirar');
  a.click('logoutButton');
  assert.equal(a.get('qrBackdrop').hidden, true); assert.equal(a.get('qrCode').children.length, 0);
  const before = n; await new Promise(resolve => setTimeout(resolve, 1800)); assert.equal(n, before, 'parou de renovar após sair');
});

test('meu QR: avisa quando o servidor ainda não tem a chave configurada', async () => {
  const a = app({ handle: (path, options, pub) => path.includes('/passport/qr') ? { status: 503, code: 'QR_NOT_CONFIGURED' }
    : path.includes('/functions/v1/passport') ? passport : pub(path) });
  await a.start(); a.run(fakeQrLib);
  a.run('saveSession({idToken:"jwt",refreshToken:"refresh",expiresIn:"3600"})'); await a.run('loadPassport()');
  await a.click('qrOpen');
  assert.match(a.get('qrMessage').textContent, /ainda não está disponível/); assert.equal(a.get('qrCode').children.length, 0);
  a.click('qrClose'); assert.equal(a.get('qrBackdrop').hidden, true); assert.equal(a.get('pageContent').inert, false);
});

test('leitor de QR: registra, avisa repetição, ignora a mesma leitura seguida e explica erros', async () => {
  const replies = [{ result: 'registered', person: { id: 'p', name: 'Ana' } }, { result: 'already', person: { id: 'p', name: 'Ana' } },
    { status: 410, code: 'QR_EXPIRED' }, { status: 400, code: 'QR_INVALID' }, { status: 500 }];
  const sent = [];
  const b = app({ handle: (path, options, pub) => {
    if (path.includes('/admin/attendance/qr')) { sent.push(JSON.parse(options.body)); return replies.shift(); }
    if (path.includes('/admin/sponsors')) return { sponsor: null, sponsors: [] };
    if (path.includes('/passport/admin/attendance')) return path.includes('overview') ? overview : { participants: [], total: 0, attendees: [] };
    if (path.includes('/functions/v1/passport')) return passport;
    return pub(path);
  } });
  await login(b);
  b.get('adminActivity').value = 'mesa'; b.get('adminActivity').listeners.change();
  assert.equal(b.get('scanOpen').disabled, false);
  await b.run('handleScan("S1.um")');
  assert.deepEqual(sent[0], { activity: 'mesa', token: 'S1.um' });
  assert.equal(b.get('scanResult').textContent, '✅ Ana — presença registrada'); assert.match(b.get('scanResult').className, /ok/);
  assert.match(b.get('scanCount').textContent, /^1 presença registrada/);
  await b.run('handleScan("S1.um")'); assert.equal(sent.length, 1, 'mesma leitura em seguida é ignorada');
  await b.run('handleScan("S1.dois")'); assert.equal(b.get('scanResult').textContent, '🔁 Ana já estava presente');
  await b.run('handleScan("S1.tres")'); assert.match(b.get('scanResult').textContent, /expirado/);
  await b.run('handleScan("S1.quatro")'); assert.match(b.get('scanResult').textContent, /inválido/);
  await b.run('handleScan("S1.cinco")'); assert.match(b.get('scanResult').textContent, /Falha de conexão/);
  assert.equal(b.run('scanState.seen.has("S1.cinco")'), false, 'falha de rede permite tentar a mesma leitura de novo');
  b.run('scanState.seen.set("S1.velho", Date.now() - 61000)'); await b.run('handleScan("S1.um")');
  assert.equal(sent.length, 5, 'QR lido há menos de 60 s continua ignorado');
  assert.equal(b.run('scanState.seen.has("S1.velho")'), false, 'leituras antigas são esquecidas');
  await b.run('handleScan("https://site-qualquer.test")'); assert.match(b.get('scanResult').textContent, /não é do passaporte/);
  assert.equal(sent.length, 5, 'QR de fora não chega ao servidor');
  b.get('adminActivity').value = ''; await b.run('handleScan("S1.seis")'); assert.equal(sent.length, 5, 'sem atividade não registra');
});

const signedPhoto = 'https://mqparqbuhstkdpcgbbsa.supabase.co/storage/v1/object/sign/avatars/u/0123456789abcdef.webp?token=t';
function profileApp({ saveStatus } = {}) {
  let saved = { nickname: null, showNickname: true, headline: '', bio: '', course: '', period: '', links: {}, photoUrl: null };
  return app({ handle: (path, options, pub) => {
    if (path.includes('/passport/profile/photo')) return options.method === 'DELETE' ? { photoUrl: null } : { photoUrl: signedPhoto };
    if (path.includes('/passport/profile')) {
      if (options.method === 'POST') {
        if (saveStatus) return { status: saveStatus, code: 'NICKNAME_TAKEN' };
        const input = JSON.parse(options.body); saved = { ...input, photoUrl: saved.photoUrl };
      }
      return { name: 'Ana Oficial', profile: saved };
    }
    if (path.includes('/functions/v1/passport')) return passport;
    return pub(path);
  } });
}

test('perfil: carrega, valida apelido e links, salva e limpa ao sair', async () => {
  const a = profileApp(); await a.start();
  a.run('saveSession({idToken:"jwt",refreshToken:"refresh",expiresIn:"3600"})'); await a.run('loadPassport()');
  a.click('profileTab'); await a.run('loadProfile()');
  assert.equal(a.get('profilePanel').hidden, false); assert.equal(a.get('profileForm').hidden, false);
  assert.equal(a.get('profileOfficialName').textContent, 'Ana Oficial');
  a.get('profileNickname').value = 'a b'; await a.submit('profileForm');
  assert.match(a.get('profileMessage').textContent, /Apelido: de 3 a 20/);
  a.get('profileNickname').value = '@Ana.Dev'; a.get('profileLinkedin').value = 'linkedin.com.evil.test/in/ana';
  await a.submit('profileForm'); assert.match(a.get('profileMessage').textContent, /LinkedIn precisa ser/);
  a.get('profileLinkedin').value = 'br.linkedin.com/in/ana'; a.get('profileHeadline').value = ' Estagiária · Empresa X ';
  a.get('profilePeriod').value = '5'; a.get('profileShowNickname').checked = false; a.get('profileBio').value = 'Oi!';
  await a.submit('profileForm');
  const sent = JSON.parse(a.calls.filter(c => c.path === '/functions/v1/passport/profile' && c.options.method === 'POST').at(-1).options.body);
  assert.deepEqual(sent, { nickname: 'ana.dev', showNickname: false, headline: 'Estagiária · Empresa X', bio: 'Oi!', course: '', period: '5',
    links: { linkedin: 'https://br.linkedin.com/in/ana' } });
  assert.match(a.get('profileMessage').textContent, /Perfil salvo/);
  assert.equal(a.get('profileAvatar').children[0].textContent, 'A', 'sem foto mostra a inicial');
  a.click('logoutButton');
  assert.equal(a.get('profileForm').hidden, true); assert.equal(a.get('profileNickname').value, ''); assert.equal(a.get('profilePanel').hidden, true);
});

test('perfil: apelido em uso avisa sem perder o que foi digitado', async () => {
  const a = profileApp({ saveStatus: 409 }); await a.start();
  a.run('saveSession({idToken:"jwt",refreshToken:"refresh",expiresIn:"3600"})'); await a.run('loadPassport()'); await a.run('loadProfile()');
  a.get('profileNickname').value = 'ocupado'; await a.submit('profileForm');
  assert.match(a.get('profileMessage').textContent, /já está em uso/); assert.equal(a.get('profileNickname').value, 'ocupado');
});

test('foto de perfil: envia a imagem reduzida com o token e mostra só links assinados do Storage', async () => {
  const a = profileApp(); await a.start();
  a.run('saveSession({idToken:"jwt",refreshToken:"refresh",expiresIn:"3600"})'); await a.run('loadPassport()'); await a.run('loadProfile()');
  a.run('globalThis.__blob = new Blob([new Uint8Array([1,2,3])], { type: "image/webp" })');
  a.run('prepareAvatar = async () => __blob');
  await a.run('changeProfilePhoto({ type: "image/jpeg", size: 1000 })');
  const upload = a.calls.find(c => c.path === '/functions/v1/passport/profile/photo' && c.options.method === 'PUT');
  assert.equal(upload.options.headers.Authorization, 'Bearer jwt'); assert.equal(upload.options.headers['Content-Type'], 'image/webp');
  assert.equal(upload.options.body, a.run('__blob'));
  assert.equal(a.get('profileAvatar').children[0].children[0].src, signedPhoto); assert.equal(a.get('profilePhotoRemove').hidden, false);
  assert.equal(a.run('avatarNode("X", "https://evil.test/a.png")').children.length, 0, 'link de fora não vira imagem');
  assert.equal(a.run('avatarNode("Ana Souza", "javascript:alert(1)")').textContent, 'AS');
  await a.click('profilePhotoRemove');
  assert(a.calls.some(c => c.path === '/functions/v1/passport/profile/photo' && c.options.method === 'DELETE'));
  assert.equal(a.get('profilePhotoRemove').hidden, true);
});

test('leitor de QR mostra a foto do perfil e a moderação remove foto pela organização', async () => {
  const sent = [];
  const b = app({ handle: (path, options, pub) => {
    if (path.includes('/admin/attendance/qr')) return { result: 'registered', person: { id: 'p', name: 'Ana', nickname: 'ana', photoUrl: signedPhoto } };
    if (path.includes('/admin/profiles')) {
      if (options.method === 'POST') { sent.push(JSON.parse(options.body)); return { ok: true }; }
      return { profiles: [{ participantId: '11111111-1111-4111-8111-111111111111', name: 'Ana', nickname: 'ana', headline: '', photoUrl: signedPhoto }] };
    }
    if (path.includes('/admin/sponsors')) return { sponsor: null, sponsors: [] };
    if (path.includes('/passport/admin/attendance')) return path.includes('overview') ? overview : { participants: [], total: 0, attendees: [] };
    if (path.includes('/functions/v1/passport')) return passport;
    return pub(path);
  } });
  await login(b);
  b.get('adminActivity').value = 'mesa'; b.get('adminActivity').listeners.change();
  await b.run('handleScan("S1.foto")');
  assert.equal(b.get('scanPerson').children[0].children[0].src, signedPhoto);
  await b.run('handleScan("https://site.test")'); assert.equal(b.get('scanPerson').children.length, 0, 'erro limpa a foto anterior');
  b.get('moderationSearch').value = 'ana'; await b.run('searchProfiles()');
  const row = b.get('moderationResults').children[0];
  assert.equal(row.children[1].children[0].textContent, 'Ana (@ana)');
  await row.children.find(c => c.textContent === 'Remover foto').listeners.click();
  assert.deepEqual(sent[0], { participant: '11111111-1111-4111-8111-111111111111', action: 'remove_photo' });
  assert.match(b.get('moderationMessage').textContent, /Remover foto: feito/);
});

test('envio de imagens: foto do palestrante e fotos do carrossel vão pelo backend e entram na lista', async () => {
  const uploaded = [];
  const a = adminApp(); await login(a);
  a.run(`globalThis.fetchOriginal = fetch; fetch = async (url, options) => {
    if (String(url).includes('/admin/images')) { const kind = new URL(url).searchParams.get('kind');
      return { ok: true, status: 200, json: async () => ({ url: 'https://mqparqbuhstkdpcgbbsa.supabase.co/storage/v1/object/public/site-images/' + kind + '/0123456789abcdef.webp' }) }; }
    return fetchOriginal(url, options); }`);
  a.run('prepareImage = async () => new Blob([new Uint8Array([1])], { type: "image/webp" })');
  await a.run('loadSponsorsAdmin()');
  a.get('sponsorSelect').value = '__new'; a.get('sponsorSelect').listeners.change();
  await a.run('uploadSponsorPhotos([{ type: "image/jpeg" }, { type: "image/png" }])');
  assert.equal(a.run('sponsorState.photos.length'), 2); assert.equal(a.get('sponsorPhotoCount').textContent, '2 / 12 fotos');
  const first = a.get('sponsorPhotoList').children[0];
  first.children[1].value = 'Estande'; first.children[1].listeners.input();
  first.children[2].children[1].listeners.click();
  assert.equal(a.run('sponsorState.photos[1].caption'), 'Estande', 'mover para baixo troca a ordem');
  a.get('sponsorPhotoList').children[0].children[2].children[2].listeners.click();
  assert.equal(a.run('sponsorState.photos.length'), 1);
  await a.run('uploadSponsorLogo({ type: "image/png" })');
  assert.match(a.get('sponsorLogo').value, /site-images\/sponsors\//); assert.equal(a.get('sponsorLogoPreview').hidden, false);
  a.run('sponsorState.photos = Array.from({ length: 12 }, () => ({ url: "x", caption: "" }))');
  await a.run('uploadSponsorPhotos([{ type: "image/png" }])'); assert.match(a.get('sponsorMessage').textContent, /até 12 fotos/);
  await a.run('uploadSpeakerPhoto({ type: "image/jpeg" })');
  assert.match(a.get('editorPhoto').value, /site-images\/speakers\//);
  assert.match(a.get('editorMessage').textContent, /Salve as informações/);
});
