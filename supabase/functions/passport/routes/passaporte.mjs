// Rotas do participante: passaporte, ranking e QR pessoal.
import { issueQrToken, qrSecretValid, QR_PERIOD_SECONDS } from '../qr-token.mjs';
import { response } from '../http.mjs';

// QR pessoal do participante.
export async function myQr({ qrSecret, now, passportRpc }) {
  if (!qrSecretValid(qrSecret)) return response(503, 'QR_NOT_CONFIGURED');
  try {
    const { passport, error } = await passportRpc();
    if (error) return error;
    const { token, expiresAt } = await issueQrToken(qrSecret, passport.participant.id, now());
    return response(200, null, { token, expiresAt, periodSeconds: QR_PERIOD_SECONDS, name: passport.participant.full_name });
  } catch { return response(503, 'QR_UNAVAILABLE'); }
}

// Ranking de selos.
export async function ranking({ user, fetcher, supabaseUrl, serviceKey, signPhotos }) {
  try {
    const result = await fetcher(`${supabaseUrl}/rest/v1/rpc/get_badge_ranking`, {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(8000),
      headers:{'Content-Type':'application/json',apikey:serviceKey,Authorization:`Bearer ${serviceKey}`},
      body:JSON.stringify({p_uid:user.localId})
    });
    if (!result.ok) return response(503,'RANKING_UNAVAILABLE');
    const data = await result.json();
    const validCount = n => Number.isSafeInteger(n) && n >= 0;
    if (!Array.isArray(data.entries) || data.entries.length > 20 ||
      !data.entries.every(e => Number.isSafeInteger(e.position) && e.position > 0 && typeof e.name === 'string' && validCount(e.badgeCount)) ||
      !data.mine || !validCount(data.mine.badgeCount) ||
      !(data.mine.position === null || Number.isSafeInteger(data.mine.position) && data.mine.position > 0)) return response(503,'RANKING_UNAVAILABLE');
    // Fotos só para quem está logado: o ranking já exige conta confirmada.
    const photos = await signPhotos(data.entries.map(e => e.photoPath));
    return response(200,null,{
      entries:data.entries.map(e=>({position:e.position,name:e.name,badgeCount:e.badgeCount,isMe:e.isMe === true,
        photoUrl:photos[e.photoPath] ?? null})),
      mine:{position:data.mine.position,badgeCount:data.mine.badgeCount}
    });
  } catch { return response(503,'RANKING_UNAVAILABLE'); }
}

// Passaporte da conta verificada (rota padrão).
export async function passport({ passportRpc }) {
  try {
    // UID, nome e e-mail vêm exclusivamente da resposta autenticada do Google.
    // Query string, corpo e claims de papel enviados pelo cliente são ignorados.
    const { passport, error } = await passportRpc();
    if (error) return error;
    // Resposta com campos permitidos; sem e-mail, tokens, hashes ou credenciais.
    return response(200, null, { participant: { id: passport.participant.id, full_name: passport.participant.full_name },
      earnedBadges: passport.earnedBadges.filter(id => typeof id === "string") });
  } catch { return response(503, "PASSPORT_UNAVAILABLE"); }
}
