// Perfis de outros participantes, para quem está logado: busca por nome ou apelido e perfil com selos e brindes.
import { officialLink, profilePeriods } from '../profile-content.mjs';
import { response } from '../http.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = value => typeof value === 'string' ? value : '';
const count = n => Number.isSafeInteger(n) && n >= 0 ? n : 0;

// GET ?q=texto busca; GET ?id=participante abre o perfil.
export async function people({ url, userRpc, signPhotos }) {
  const query = url.searchParams.get('q'), id = url.searchParams.get('id');
  if ((query === null) === (id === null)) return response(400, 'INVALID_PEOPLE_QUERY');
  if (query !== null && (query.trim().replace(/^@/, '').length < 2 || query.trim().length > 60)) return response(400, 'INVALID_PEOPLE_QUERY');
  if (id !== null && !uuid.test(id)) return response(400, 'INVALID_PEOPLE_QUERY');
  try {
    const { data, code } = query !== null
      ? await userRpc('search_people', { p_query:query.trim() })
      : await userRpc('person_profile', { p_participant:id });
    if (code !== undefined) return code === 'P0002' ? response(404, 'PROFILE_NOT_FOUND') : code === '42501' ? response(403, 'PEOPLE_UNAVAILABLE')
      : code === '22023' ? response(400, 'INVALID_PEOPLE_QUERY') : response(503, 'PEOPLE_UNAVAILABLE');
    if (query !== null) {
      if (!Array.isArray(data?.people)) return response(503, 'PEOPLE_UNAVAILABLE');
      const photos = await signPhotos(data.people.map(p => p.photoPath));
      return response(200, null, { people:data.people.map(p => ({ id:p.participantId, name:text(p.name), nickname:p.nickname ?? null,
        headline:text(p.headline), badgeCount:count(p.badgeCount), photoUrl:photos[p.photoPath] ?? null })) });
    }
    if (typeof data?.participantId !== 'string' || !Array.isArray(data.badges) || !Array.isArray(data.prizes)) return response(503, 'PEOPLE_UNAVAILABLE');
    const photos = await signPhotos([data.photoPath]);
    // Os links já foram validados ao salvar; conferir de novo impede que um dado antigo vire link perigoso.
    const links = Object.fromEntries(Object.entries(data.links ?? {}).filter(([key, value]) => officialLink(key, value)));
    return response(200, null, { person:{ id:data.participantId, name:text(data.name), isMe:data.isMe === true, nickname:data.nickname ?? null,
      headline:text(data.headline), bio:text(data.bio), course:text(data.course), period:profilePeriods.includes(data.period) ? data.period : '',
      links, photoUrl:photos[data.photoPath] ?? null,
      badges:data.badges.map(b => ({ id:b.id, name:text(b.name), category:text(b.category), eventDate:typeof b.eventDate === 'string' ? b.eventDate : null })),
      prizes:data.prizes.map(p => ({ prize:text(p.prize), date:typeof p.date === 'string' ? p.date : null, sponsor:typeof p.sponsor === 'string' ? p.sponsor : null })) } });
  } catch { return response(503, 'PEOPLE_UNAVAILABLE'); }
}
