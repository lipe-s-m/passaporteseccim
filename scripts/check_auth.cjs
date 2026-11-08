// Teste administrativo ponta a ponta. Não envia e-mails nem imprime senhas/tokens.
// Cria contas sintéticas, marca e-mail confirmado como administrador e apaga
// as contas Firebase ao final. Limpar também as fixtures Supabase conforme o manifesto.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const cliRoot = process.argv[2];
if (!cliRoot) throw new Error('Informe o diretório do pacote firebase-tools autorizado.');
const { getGlobalDefaultAccount } = require(path.join(cliRoot, 'lib/auth.js'));
const { requireAuth } = require(path.join(cliRoot, 'lib/requireAuth.js'));
const { Client } = require(path.join(cliRoot, 'lib/apiv2.js'));
const html = fs.readFileSync('js/config.js', 'utf8');
const project = html.match(/const FIREBASE_PROJECT_ID = "([^"]+)"/)[1];
const apiKey = html.match(/const FIREBASE_API_KEY = "([^"]+)"/)[1];
const supabaseUrl = html.match(/const SUPABASE_URL = "([^"]+)"/)[1];
const publicKey = html.match(/const SUPABASE_PUBLISHABLE_KEY = "([^"]+)"/)[1];
const fixtures = [];
const manifest = 'dados-privados/auth-test-fixtures.json';

async function firebase(action, body) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/${action}?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error(`Firebase recusou etapa de teste (HTTP ${r.status}).`);
  return r.json();
}
async function passport(token) {
  const r = await fetch(`${supabaseUrl}/functions/v1/passport`, {
    headers: { apikey: publicKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(25000)
  });
  return { status: r.status, body: await r.json() };
}
function saveManifest() {
  fs.mkdirSync('dados-privados', { recursive: true });
  fs.writeFileSync(manifest, JSON.stringify(fixtures.map(({ email, uid, participantId, firebaseDeleted }) => ({ email, uid, participantId, firebaseDeleted })), null, 2));
}
(async () => {
  const account = getGlobalDefaultAccount();
  if (!account) throw new Error('Faça login na CLI Firebase.');
  await requireAuth({ project, user: account.user, tokens: account.tokens, cwd: process.cwd() });
  const admin = new Client({ urlPrefix: 'https://identitytoolkit.googleapis.com', apiVersion: 'v1' });
  try {
    const rejected = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `policy-${crypto.randomUUID()}@example.invalid`, password: 'curta', returnSecureToken: true })
    });
    assert.equal(rejected.status, 400, 'Política deve rejeitar senha curta.');
    console.log('OK: Firebase rejeitou senha curta no servidor.');
    for (let i = 0; i < 2; i++) {
      const email = `seccim-auth-test-${crypto.randomUUID()}@example.invalid`;
      const password = crypto.randomBytes(24).toString('base64url');
      const user = await firebase('accounts:signUp', { email, password, returnSecureToken: true });
      const fixture = { email, uid: user.localId, password, token: user.idToken, firebaseDeleted: false };
      fixtures.push(fixture); saveManifest();
      const unverified = await passport(fixture.token);
      assert.equal(unverified.status, 403);
      assert.equal(unverified.body.code, 'EMAIL_NOT_VERIFIED');
      const parts = fixture.token.split('.');
      const changed = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      changed.sub = 'identidade-forjada';
      parts[1] = Buffer.from(JSON.stringify(changed)).toString('base64url');
      assert.equal((await passport(parts.join('.'))).status, 401);
      console.log(`OK: conta de teste ${i + 1} sem confirmação e token adulterado bloqueados.`);
      await admin.post(`projects/${project}/accounts:update`, { localId: fixture.uid, emailVerified: true, displayName: `Pessoa de teste ${i + 1}` });
      const login = await firebase('accounts:signInWithPassword', { email, password, returnSecureToken: true });
      const loaded = await passport(login.idToken);
      assert.equal(loaded.status, 200);
      assert(loaded.body.participant.id);
      assert.equal(loaded.body.participant.full_name, `Pessoa de teste ${i + 1}`);
      assert.deepEqual(loaded.body.earnedBadges, []);
      assert.equal(loaded.body.participant.email, undefined);
      fixture.participantId = loaded.body.participant.id; saveManifest();
      console.log(`OK: conta de teste ${i + 1} confirmada consultou o próprio passaporte.`);
    }
    assert.notEqual(fixtures[0].participantId, fixtures[1].participantId);
    const direct = await fetch(`${supabaseUrl}/rest/v1/participants?select=id`, {
      headers: { apikey: publicKey, Authorization: `Bearer ${fixtures[0].token}` }
    });
    assert([401, 403].includes(direct.status));
    console.log('OK: duas identidades separadas; token Firebase não abre tabela privada diretamente.');
  } finally {
    for (const fixture of fixtures) {
      try {
        await admin.post(`projects/${project}/accounts:delete`, { localId: fixture.uid });
        fixture.firebaseDeleted = true;
      } catch { console.error('Uma conta sintética requer limpeza manual; consulte o manifesto privado.'); process.exitCode = 1; }
    }
    saveManifest();
    console.log(fixtures.every(f => f.firebaseDeleted)
      ? 'Contas Firebase temporárias removidas. Limpar fixtures Supabase usando dados-privados/auth-test-fixtures.json.'
      : 'Limpeza Firebase incompleta. Confira o manifesto privado antes de repetir os testes.');
  }
})().catch(() => { console.error('O teste ponta a ponta falhou. Nenhuma senha ou token foi exibido; confira a etapa anterior e o manifesto de limpeza.'); process.exitCode = 1; });
