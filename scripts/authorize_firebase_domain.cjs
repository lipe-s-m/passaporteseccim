// Autoriza o domínio publicado, preservando os domínios já configurados.
// Uso: node scripts/authorize_firebase_domain.cjs CAMINHO_FIREBASE_TOOLS DOMINIO
const path = require('node:path');
const fs = require('node:fs');
const [root, domain] = process.argv.slice(2);
if (!root || !domain || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(domain)) throw Error('Informe o pacote firebase-tools e o domínio, sem protocolo.');
const {getGlobalDefaultAccount} = require(path.join(root,'lib/auth.js'));
const {requireAuth} = require(path.join(root,'lib/requireAuth.js'));
const {getConfig,updateConfig} = require(path.join(root,'lib/gcp/identityPlatform.js'));
const project = JSON.parse(fs.readFileSync('.firebaserc','utf8')).projects.default;
(async()=>{
  const account=getGlobalDefaultAccount();
  if (!account) throw Error();
  await requireAuth({project,user:account.user,tokens:account.tokens,cwd:process.cwd()});
  const before=await getConfig(project);
  const domains=[...new Set([...(before.authorizedDomains ?? []),domain])];
  if (!before.authorizedDomains?.includes(domain)) await updateConfig(project,{authorizedDomains:domains},'authorizedDomains');
  const after=await getConfig(project);
  if (!after.authorizedDomains?.includes(domain)) throw Error();
  console.log(`Domínio autorizado no Firebase: ${domain}`);
})().catch(()=>{console.error('Não foi possível autorizar o domínio no Firebase.');process.exitCode=1;});
