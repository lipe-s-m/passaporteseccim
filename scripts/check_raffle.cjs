// Teste real do endpoint administrativo. Tokens/senhas ficam somente em memória.
// Protocolo: aguarda "check" após cadastrar o UID temporário no banco e "revoke"
// após revogar. Todas as contas Firebase são removidas no finally.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const readline=require('node:readline');
const assert=require('node:assert/strict');
const root=process.argv[2];
if(!root) throw Error('Informe o diretório firebase-tools.');
const {getGlobalDefaultAccount}=require(path.join(root,'lib/auth.js'));
const {requireAuth}=require(path.join(root,'lib/requireAuth.js'));
const {Client}=require(path.join(root,'lib/apiv2.js'));
const html=fs.readFileSync('js/config.js','utf8');
const value=key=>html.match(new RegExp(`const ${key} = "([^"]+)";`))[1];
const project=value('FIREBASE_PROJECT_ID'), key=value('FIREBASE_API_KEY');
const fixtures=[];
async function firebase(action,body){
  const result=await fetch(`https://identitytoolkit.googleapis.com/v1/${action}?key=${key}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!result.ok) throw Error('Firebase: '+result.status);
  return result.json();
}
async function get(token){
  return fetch(value('SUPABASE_URL')+'/functions/v1/passport/admin/raffle?date=2099-05-09',{
    headers:{apikey:value('SUPABASE_PUBLISHABLE_KEY'),...(token ? {Authorization:'Bearer '+token} : {})},signal:AbortSignal.timeout(20000)});
}
(async()=>{
  const account=getGlobalDefaultAccount();
  if(!account) throw Error('CLI Firebase não autenticada.');
  await requireAuth({project,user:account.user,tokens:account.tokens,cwd:process.cwd()});
  const admin=new Client({urlPrefix:'https://identitytoolkit.googleapis.com',apiVersion:'v1'});
  const input=readline.createInterface({input:process.stdin});
  const lines=input[Symbol.asyncIterator]();
  try {
    assert.equal((await get()).status,401);
    for(let i=0;i<2;i++){
      const email=`raffle-e2e-${crypto.randomUUID()}@example.invalid`,password=crypto.randomBytes(24).toString('base64url')+'a1';
      const signup=await firebase('accounts:signUp',{email,password,returnSecureToken:true});
      fixtures.push({uid:signup.localId});
      assert.equal((await get(signup.idToken)).status,403);
      await admin.post(`projects/${project}/accounts:update`,{localId:signup.localId,emailVerified:true});
      fixtures[i].token=(await firebase('accounts:signInWithPassword',{email,password,returnSecureToken:true})).idToken;
      assert.equal((await get(fixtures[i].token)).status,403);
    }
    fs.mkdirSync('dados-privados',{recursive:true});
    fs.writeFileSync('dados-privados/raffle-test-fixture.json',JSON.stringify({uid:fixtures[0].uid}));
    console.log(JSON.stringify({ready:true,adminUid:fixtures[0].uid}));
    const check=await lines.next(); if(check.value!=='check') throw Error('Etapa esperada: check');
    const allowed=await get(fixtures[0].token); assert.equal(allowed.status,200);
    const data=await allowed.json(); assert(Array.isArray(data.entries));
    assert.equal((await get(fixtures[1].token)).status,403);
    console.log('OK: conta administrativa 200; conta comum 403. Aguardando revogação.');
    const revoke=await lines.next(); if(revoke.value!=='revoke') throw Error('Etapa esperada: revoke');
    assert.equal((await get(fixtures[0].token)).status,403);
    console.log('OK: permissão revogada bloqueia o mesmo token imediatamente.');
  } finally {
    input.close();
    for(const fixture of fixtures) await admin.post(`projects/${project}/accounts:delete`,{localId:fixture.uid});
    console.log('Contas Firebase temporárias removidas.');
  }
})().catch(()=>{console.error('Falha no teste real de sorteios; nenhuma credencial foi exibida.');process.exitCode=1;});
