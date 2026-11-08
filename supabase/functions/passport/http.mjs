// Respostas JSON com CORS e validações de entrada usadas por várias rotas.
export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
};

export function response(status, code, data) {
  return new Response(JSON.stringify(data ?? { code }), { status, headers: cors });
}

// Dia do calendário no formato AAAA-MM-DD, recusando datas inexistentes como 2026-02-30.
export function validDate(date) {
  if (typeof date !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === date;
}

export async function readJson(request, limit) {
  const raw = await request.text();
  if (raw.length > limit) throw Error();
  return JSON.parse(raw);
}
