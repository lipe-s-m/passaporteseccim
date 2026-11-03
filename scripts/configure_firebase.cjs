// Ferramenta administrativa local: reutiliza a sessão da CLI oficial sem imprimir tokens.
// Uso: node scripts/configure_firebase.cjs CAMINHO_PARA_FIREBASE_TOOLS
// Dependência administrativa: firebase-tools 15.34.2 (fora do aplicativo publicado).
const path = require('node:path');
const fs = require('node:fs');
const root = process.argv[2];
if (!root) throw new Error('Informe o diretório do pacote firebase-tools já instalado pela CLI.');
const { getGlobalDefaultAccount } = require(path.join(root, 'lib/auth.js'));
const { requireAuth } = require(path.join(root, 'lib/requireAuth.js'));
const { getConfig, updateConfig } = require(path.join(root, 'lib/gcp/identityPlatform.js'));
const project = JSON.parse(fs.readFileSync('.firebaserc', 'utf8')).projects.default;
(async () => {
  const account = getGlobalDefaultAccount();
  if (!account) throw new Error('Entre na CLI Firebase antes de configurar.');
  await requireAuth({ project, user: account.user, tokens: account.tokens, cwd: process.cwd() });
  const before = await getConfig(project);
  if (!before.signIn?.email?.enabled || !before.signIn.email.passwordRequired) {
    throw new Error('Habilite e-mail/senha com deploy --only auth antes desta etapa.');
  }
  await updateConfig(project, {
    passwordPolicyConfig: {
      passwordPolicyEnforcementState: 'ENFORCE',
      passwordPolicyVersions: [{ customStrengthOptions: {
        minPasswordLength: 8, maxPasswordLength: 128, containsNumericCharacter: true,
        containsLowercaseCharacter: false, containsUppercaseCharacter: false,
        containsNonAlphanumericCharacter: false
      } }]
    },
    emailPrivacyConfig: { enableImprovedEmailPrivacy: true }
  }, 'passwordPolicyConfig,emailPrivacyConfig');
  const after = await getConfig(project);
  const policy = after.passwordPolicyConfig;
  if (policy?.passwordPolicyEnforcementState !== 'ENFORCE' ||
    policy.passwordPolicyVersions?.[0]?.customStrengthOptions?.minPasswordLength !== 8 ||
    policy.passwordPolicyVersions?.[0]?.customStrengthOptions?.containsNumericCharacter !== true ||
    after.emailPrivacyConfig?.enableImprovedEmailPrivacy !== true) throw new Error('Configuração não confirmada.');
  console.log(JSON.stringify({ project, emailPassword: true, passwordPolicy: 'ENFORCE', minimumLength: 8, maximumLength: 128, requiresNumber: true, emailEnumerationProtection: true }));
})().catch(() => { console.error('Falha na configuração administrativa do Firebase. Nenhuma credencial foi exibida.'); process.exitCode = 1; });
