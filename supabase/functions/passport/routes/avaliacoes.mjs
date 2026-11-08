// Rotas da pesquisa de satisfação: avaliação de quem teve presença e resultado para a organização.
import { response, readJson } from '../http.mjs';

const slug = value => typeof value === 'string' && value.length <= 200 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
const rating = value => Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;

// Palestras que a própria conta assistiu, com a avaliação enviada; POST grava uma avaliação.
export async function feedback({ request, userRpc }) {
  let input = null;
  if (request.method === 'POST') {
    try {
      input = await readJson(request, 4000);
      if (!input || !slug(input.activity) || !rating(input.rating) ||
        typeof input.comment !== 'string' || input.comment.trim().length > 1000) throw Error();
    } catch { return response(400, 'INVALID_FEEDBACK'); }
  }
  try {
    const { data, code } = await userRpc('manage_feedback', input
      ? { p_activity:input.activity, p_rating:input.rating, p_comment:input.comment.trim() } : {});
    if (code !== undefined) return code === '42501' ? response(403, 'FEEDBACK_NOT_ALLOWED')
      : code === '22023' ? response(400, 'INVALID_FEEDBACK') : response(503, 'FEEDBACK_UNAVAILABLE');
    if (!Array.isArray(data?.items)) return response(503, 'FEEDBACK_UNAVAILABLE');
    return response(200, null, { items:data.items.map(i => ({ activityId:i.activityId, name:i.name,
      eventDate:typeof i.eventDate === 'string' ? i.eventDate : null, rating:rating(i.rating),
      comment:typeof i.comment === 'string' ? i.comment : '' })) });
  } catch { return response(503, 'FEEDBACK_UNAVAILABLE'); }
}

// Resultado para a organização: resumo por palestra e respostas sem identificar quem respondeu.
export async function adminFeedback({ adminRpc }) {
  try {
    const { data, error } = await adminRpc('admin_feedback', {}, 'FEEDBACK_UNAVAILABLE');
    if (error) return error;
    if (!Array.isArray(data?.activities) || !Array.isArray(data.responses)) return response(503, 'FEEDBACK_UNAVAILABLE');
    const count = n => Number.isSafeInteger(n) && n >= 0 ? n : 0;
    return response(200, null, {
      activities:data.activities.map(a => ({ id:a.id, name:a.name, eventDate:typeof a.eventDate === 'string' ? a.eventDate : null,
        attendances:count(a.attendances), responses:count(a.responses),
        average:typeof a.average === 'number' ? a.average : null,
        distribution:Array.isArray(a.distribution) && a.distribution.length === 5 ? a.distribution.map(count) : [0,0,0,0,0] })),
      responses:data.responses.map(r => ({ activityId:r.activityId, rating:rating(r.rating),
        comment:typeof r.comment === 'string' ? r.comment : '', date:typeof r.date === 'string' ? r.date : null }))
    });
  } catch { return response(503, 'FEEDBACK_UNAVAILABLE'); }
}
