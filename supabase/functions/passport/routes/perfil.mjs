// Rotas do perfil do participante.
import { validProfile, imageType, MAX_PHOTO_BYTES } from '../profile-content.mjs';
import { response, readJson } from '../http.mjs';

// Meu perfil: ler e salvar.
export async function profile({ request, profileRpc, publicProfile }) {
  let input = null;
  if (request.method === 'POST') {
    try { input = await readJson(request, 8000); if (!validProfile(input)) throw Error(); }
    catch { return response(400, 'INVALID_PROFILE'); }
  }
  try {
    const { data, error } = await profileRpc('manage_profile', { p_profile:input ? { ...input,
      nickname:input.nickname?.trim().toLowerCase() || null, headline:input.headline.trim(), bio:input.bio.trim(), course:input.course.trim() } : null });
    if (error) return error;
    if (typeof data?.name !== 'string' || !data.profile) return response(503, 'PROFILE_UNAVAILABLE');
    return response(200, null, await publicProfile(data));
  } catch { return response(503, 'PROFILE_UNAVAILABLE'); }
}

// Foto de perfil: enviar (PUT) ou remover (DELETE).
export async function profilePhoto({ request, passportRpc, storage, signPhotos, deletePhoto, profileRpc }) {
  try {
    if (request.method === 'DELETE') {
      const { data, error } = await profileRpc('set_profile_photo', { p_path:null });
      if (error) return error;
      await deletePhoto(data?.previous);
      return response(200, null, { photoUrl:null });
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    const type = imageType(bytes);
    if (bytes.length > MAX_PHOTO_BYTES) return response(413, 'PHOTO_TOO_LARGE');
    if (!type) return response(400, 'INVALID_PHOTO');
    const { passport, error: passportError } = await passportRpc();
    if (passportError) return passportError;
    // Nome aleatório a cada troca: o link assinado antigo deixa de mostrar a foto nova e vice-versa.
    const name = [...crypto.getRandomValues(new Uint8Array(8))].map(v => v.toString(16).padStart(2, '0')).join('');
    const path = `${passport.participant.id}/${name}.${type}`;
    const contentType = { webp:'image/webp', jpg:'image/jpeg', png:'image/png' }[type];
    const uploaded = await storage(`object/avatars/${path}`, { method:'POST', headers:{'Content-Type':contentType,'x-upsert':'false'}, body:bytes });
    if (!uploaded.ok) return response(503, 'PHOTO_UNAVAILABLE');
    const { data, error } = await profileRpc('set_profile_photo', { p_path:path });
    if (error) { await deletePhoto(path); return error; }
    await deletePhoto(data?.previous);
    const photos = await signPhotos([path]);
    return response(200, null, { photoUrl:photos[path] ?? null });
  } catch { return response(503, 'PHOTO_UNAVAILABLE'); }
}
