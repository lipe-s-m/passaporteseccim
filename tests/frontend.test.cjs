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
  .replace(/clearPassport\(\);\s*loadPublicContent\(\);\s*$/, '');

function app({ configured = true, authConfigured = true, handle } = {}) {
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
    getElementById: get, createElement: element, querySelectorAll: () => [],
    addEventListener(k, fn) { this.listeners[k] = fn; } };
  const publicData = path => path.includes('/site_content') ? [{ key: 'page_title', value: 'Evento teste' }]
    : path.includes('/activities') ? [{ id: 'mesa', name: '<img src=x onerror=alert(1)>', description: 'Descrição', category: 'Categoria' }] : [];
  const blobs = [];
  const context = vm.createContext({ document, AbortController, Date, URLSearchParams, setTimeout, clearTimeout,
    confirm: () => true, Blob,
    URL: { createObjectURL: blob => { blobs.push(blob); return 'blob:' + blobs.length; }, revokeObjectURL() {} },
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
  const card = a.get('badgeGrid').children[0]; card.focus(); card.listeners.click();
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
  assert.equal(a.get('rankingList').children[0].children[1].textContent,'<script>nome</script> (você)');
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

function adminApp({ denied = false, raffle } = {}) {
  return app({ handle: (path, options, pub) => {
    if (path.includes('/passport/admin/raffle')) return raffle;
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
  assert.match(b.get('raffleMessage').textContent, /1 atividade\(s\) sem data/);
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
  await row.children.at(-1).listeners.click();
  const write = a.calls.find(c => c.options.method === 'POST');
  assert.deepEqual(JSON.parse(write.options.body), { activity: 'mesa', participant: person.id });
  assert.equal(write.options.headers.Authorization, 'Bearer jwt');
  assert.match(a.get('adminMessage').textContent, /Presença registrada/);
  assert.equal(a.get('adminSearch').value, ''); assert.equal(a.document.activeElement, a.get('adminSearch'));
  await a.run('loadAttendees()');
  assert.equal(a.get('adminCount').textContent, '1 PRESENTES');
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
