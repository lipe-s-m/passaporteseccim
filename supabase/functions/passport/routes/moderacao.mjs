// Rota de moderação de perfis.
import { response, readJson } from '../http.mjs';

// Moderação de perfis: busca e remoção de foto ou apelido.
export async function adminProfiles({ request, url, adminRpc, signPhotos, deletePhoto }) {
  let input;
  try {
    input = request.method === 'GET' ? Object.fromEntries(url.searchParams) : await readJson(request, 2000);
    if (request.method === 'GET' && (typeof input.q !== 'string' || input.q.trim().length < 2 || input.q.trim().length > 120)) throw Error();
    if (request.method === 'POST' && (typeof input.participant !== 'string' || !['remove_photo','remove_nickname'].includes(input.action) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.participant))) throw Error();
  } catch { return response(400, 'INVALID_PROFILE_QUERY'); }
  try {
    const { data, error } = await adminRpc('admin_profiles', request.method === 'GET' ? { p_query:input.q.trim() }
      : { p_participant:input.participant, p_action:input.action }, 'PROFILE_UNAVAILABLE');
    if (error) return error;
    if (request.method === 'POST') { await deletePhoto(data?.removedPhoto); return response(200, null, { ok:true }); }
    if (!Array.isArray(data?.profiles)) return response(503, 'PROFILE_UNAVAILABLE');
    const photos = await signPhotos(data.profiles.map(p => p.photoPath));
    return response(200, null, { profiles:data.profiles.map(p => ({ participantId:p.participantId, name:p.name, nickname:p.nickname ?? null,
      headline:p.headline ?? '', photoUrl:photos[p.photoPath] ?? null, moderatedAt:p.moderatedAt ?? null })) });
  } catch { return response(503, 'PROFILE_UNAVAILABLE'); }
}
