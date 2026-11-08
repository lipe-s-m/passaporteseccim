// Rota do FAQ.
import { response } from '../http.mjs';

// FAQ das palestras.
export async function faq({ request, url, user, fetcher, supabaseUrl, serviceKey }) {
  let input;
  try {
    if (request.method === 'GET') input = Object.fromEntries(url.searchParams);
    else {
      const raw = await request.text();
      if (raw.length > 16000) return response(413, 'QUESTION_TOO_LARGE');
      input = JSON.parse(raw);
    }
    if (!input || typeof input.activity !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.activity) || input.activity.length > 200) throw Error();
    if (['PATCH','DELETE'].includes(request.method) && (typeof input.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id))) throw Error();
    if (['POST','PATCH'].includes(request.method) && (typeof input.body !== 'string' || !input.body.trim() || input.body.length > 2000 || typeof input.anonymous !== 'boolean')) throw Error();
    if (request.method === 'GET' && (!Number.isInteger(Number(input.offset ?? 0)) || Number(input.offset ?? 0) < 0 || Number(input.offset ?? 0) > 100000)) throw Error();
  } catch { return response(400, 'INVALID_QUESTION'); }
  try {
    // O UID recebido no corpo é ignorado; o banco verifica a autoria em toda alteração.
    const result = await fetcher(`${supabaseUrl}/rest/v1/rpc/manage_faq`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ p_uid: user.localId,
        p_action: ({GET:'list',POST:'create',PATCH:'update',DELETE:'delete'})[request.method],
        p_activity: input.activity, p_id: request.method === 'PATCH' || request.method === 'DELETE' ? input.id : null,
        p_body: request.method === 'POST' || request.method === 'PATCH' ? input.body.trim() : null,
        p_anonymous: input.anonymous === true, p_offset: request.method === 'GET' ? Number(input.offset ?? 0) : 0 })
    });
    if (!result.ok) {
      const error = await result.json().catch(() => ({}));
      return response(error.code === '42501' ? 403 : error.code === '22023' ? 400 : 503, 'FAQ_UNAVAILABLE');
    }
    const data = await result.json();
    if (request.method !== 'GET') return response(200, null, { id: data.id });
    if (!Array.isArray(data.questions)) return response(503, 'FAQ_UNAVAILABLE');
    return response(200, null, { hasMore: data.hasMore === true, questions: data.questions.map(q => ({
      id:q.id, body:q.body, anonymous:q.anonymous === true, mine:q.mine === true,
      author:q.anonymous ? 'Anônimo' : q.author, createdAt:q.createdAt, updatedAt:q.updatedAt
    })) });
  } catch { return response(503, 'FAQ_UNAVAILABLE'); }
}
