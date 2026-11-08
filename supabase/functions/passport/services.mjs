// Acesso ao banco (RPCs) e ao Storage com a chave administrativa, sempre em nome da conta verificada.
import { response } from './http.mjs';

export function createServices({ supabaseUrl, serviceKey, fetcher, user }) {
  // Rotas administrativas: a permissão é sempre conferida no banco pela RPC.
  const adminRpc = async (name, params, unavailable) => {
    const result = await fetcher(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(8000),
      headers:{'Content-Type':'application/json',apikey:serviceKey,Authorization:`Bearer ${serviceKey}`},
      body:JSON.stringify({ p_uid:user.localId, ...params })
    });
    if (result.ok) return { data: await result.json() };
    const error = await result.json().catch(()=>({}));
    return { error: response(error.code === '42501' ? 403 : error.code === '22023' ? 400 : error.code === '40001' ? 409 : 503,
      error.code === '42501' ? 'ADMIN_REQUIRED' : error.code === '40001' ? 'CONTENT_CONFLICT' : unavailable) };
  };

  // Cadastro da conta verificada: cria ou vincula pelo e-mail confirmado, como no passaporte.
  const passportRpc = async () => {
    const result = await fetcher(`${supabaseUrl}/rest/v1/rpc/get_firebase_passport`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/json", apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ p_uid: user.localId, p_email: user.email.trim().toLowerCase(),
        p_name: typeof user.displayName === "string" ? user.displayName.slice(0, 120) : "Participante" })
    });
    if (!result.ok) return { error: response(result.status === 409 ? 409 : 503, "PASSPORT_UNAVAILABLE") };
    const passport = await result.json();
    if (!passport?.participant?.id || !passport.participant.full_name || !Array.isArray(passport.earnedBadges)) {
      return { error: response(503, "PASSPORT_UNAVAILABLE") };
    }
    return { passport };
  };

  // Fotos de perfil: bucket privado "avatars"; leitura só por links assinados que expiram em 1 hora.
  const storage = (path, init = {}) => fetcher(`${supabaseUrl}/storage/v1/${path}`, { redirect:'error', signal:AbortSignal.timeout(10000),
    ...init, headers:{ apikey:serviceKey, Authorization:`Bearer ${serviceKey}`, ...(init.headers ?? {}) } });
  const signPhotos = async paths => {
    const unique = [...new Set(paths.filter(p => typeof p === 'string' && p))];
    if (!unique.length) return {};
    try {
      const result = await storage('object/sign/avatars', { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ expiresIn:3600, paths:unique }) });
      if (!result.ok) return {};
      const signed = await result.json();
      return Object.fromEntries((Array.isArray(signed) ? signed : []).filter(item => item && !item.error &&
        typeof item.signedURL === 'string' && item.signedURL.startsWith('/object/sign/avatars/'))
        .map(item => [item.path, `${supabaseUrl}/storage/v1${item.signedURL}`]));
    } catch { return {}; }
  };
  const deletePhoto = path => path ? storage('object/avatars', { method:'DELETE', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ prefixes:[path] }) }).catch(() => null) : null;
  const profileRpc = async (name, params) => {
    const result = await fetcher(`${supabaseUrl}/rest/v1/rpc/${name}`, { method:'POST', redirect:'error', signal:AbortSignal.timeout(8000),
      headers:{'Content-Type':'application/json',apikey:serviceKey,Authorization:`Bearer ${serviceKey}`},
      body:JSON.stringify({ p_uid:user.localId, ...params }) });
    if (result.ok) return { data: await result.json() };
    const error = await result.json().catch(()=>({}));
    return { error: error.code === '23505' ? response(409,'NICKNAME_TAKEN') : error.code === '22023' || error.code === '23514' ? response(400,'INVALID_PROFILE')
      : error.code === '42501' ? response(403,'PROFILE_UNAVAILABLE') : response(503,'PROFILE_UNAVAILABLE') };
  };
  const publicProfile = async data => {
    const p = data?.profile ?? {}; const photos = await signPhotos([p.photoPath]);
    return { name:data?.name, profile:{ nickname:p.nickname ?? null, showNickname:p.showNickname !== false, headline:p.headline ?? '',
      bio:p.bio ?? '', course:p.course ?? '', period:p.period ?? '', links:p.links ?? {}, photoUrl:photos[p.photoPath] ?? null } };
  };

  return { adminRpc, passportRpc, storage, signPhotos, deletePhoto, profileRpc, publicProfile };
}
