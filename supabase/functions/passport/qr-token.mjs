// QR pessoal de presença: identifica a pessoa pelo ID do cadastro, muda a cada 30 s e é
// assinado com HMAC-SHA256. A chave (QR_SECRET) existe só nos secrets da Edge Function,
// então uma captura de tela repassada a outra pessoa deixa de valer em até um minuto.
export const QR_PERIOD_SECONDS = 30;
const encoder = new TextEncoder();
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenPattern = /^S1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{1,12})\.([A-Za-z0-9_-]{22})$/;

export const qrSecretValid = secret => typeof secret === 'string' && secret.length >= 32;

async function signature(secret, payload) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))).slice(0, 16));
}

// Comparação em tempo constante para não revelar, pelo tempo de resposta, quanto da assinatura acertou.
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function issueQrToken(secret, participantId, nowMs) {
  const window = Math.floor(nowMs / 1000 / QR_PERIOD_SECONDS);
  const payload = `S1.${participantId.toLowerCase()}.${window}`;
  return { token: `${payload}.${await signature(secret, payload)}`, expiresAt: (window + 1) * QR_PERIOD_SECONDS * 1000 };
}

// Aceita a janela atual e a anterior: o QR na tela vale de 30 a 60 segundos.
export async function readQrToken(secret, token, nowMs) {
  const match = typeof token === 'string' ? tokenPattern.exec(token.trim()) : null;
  if (!match) return { error: 'QR_INVALID' };
  if (!sameText(await signature(secret, `S1.${match[1]}.${match[2]}`), match[3])) return { error: 'QR_INVALID' };
  const current = Math.floor(nowMs / 1000 / QR_PERIOD_SECONDS), window = Number(match[2]);
  if (window > current || window < current - 1) return { error: 'QR_EXPIRED' };
  return { participantId: match[1] };
}
