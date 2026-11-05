import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueQrToken, readQrToken, qrSecretValid } from '../supabase/functions/passport/qr-token.mjs';

const secret = 'segredo-de-teste-com-mais-de-32-caracteres';
const person = '11111111-1111-4111-8111-111111111111';
const t0 = Date.UTC(2026, 10, 6, 12, 0, 5);

test('QR vale na janela atual e na anterior, e expira depois', async () => {
  const { token, expiresAt } = await issueQrToken(secret, person, t0);
  assert.match(token, /^S1\.11111111-1111-4111-8111-111111111111\.\d+\.[A-Za-z0-9_-]{22}$/);
  assert.equal(expiresAt, Date.UTC(2026, 10, 6, 12, 0, 30));
  assert.deepEqual(await readQrToken(secret, token, t0), { participantId: person });
  assert.deepEqual(await readQrToken(secret, token, t0 + 50_000), { participantId: person });
  assert.deepEqual(await readQrToken(secret, token, t0 + 60_000), { error: 'QR_EXPIRED' });
  assert.deepEqual(await readQrToken(secret, token, t0 - 30_000), { error: 'QR_EXPIRED' });
});

test('QR recusa assinatura forjada, troca de pessoa, outra chave e lixo', async () => {
  const { token } = await issueQrToken(secret, person, t0);
  const [prefix, , window, sig] = token.split('.');
  const other = '22222222-2222-4222-8222-222222222222';
  for (const forged of [`${prefix}.${other}.${window}.${sig}`, `${prefix}.${person}.${Number(window) + 1}.${sig}`,
    token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), 'https://evil.test', '', `S1.${person}.${window}`, null])
    assert.equal((await readQrToken(secret, forged, t0)).error, 'QR_INVALID', String(forged));
  assert.equal((await readQrToken('outra-chave-com-mais-de-32-caracteres!!', token, t0)).error, 'QR_INVALID');
  assert.equal(qrSecretValid('curta'), false); assert.equal(qrSecretValid(secret), true);
});
