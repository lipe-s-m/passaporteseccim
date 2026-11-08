// Rotas do sorteio.
import { sponsorId } from '../sponsor-content.mjs';
import { response, validDate, readJson } from '../http.mjs';

// Lista de chances do dia para exportação (scripts/export_raffle.py).
export async function raffle({ url, user, fetcher, supabaseUrl, serviceKey }) {
  const date = url.searchParams.get('date');
  const rawOffset = url.searchParams.get('offset') ?? '0';
  if (!validDate(date) || !/^(0|[1-9]\d{0,7})$/.test(rawOffset) || Number(rawOffset) > 10000000) return response(400,'INVALID_RAFFLE_QUERY');
  try {
    const result = await fetcher(`${supabaseUrl}/rest/v1/rpc/get_daily_raffle`, {
      method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
      headers:{'Content-Type':'application/json',apikey:serviceKey,Authorization:`Bearer ${serviceKey}`},
      body:JSON.stringify({p_uid:user.localId,p_date:date,p_offset:Number(rawOffset)})
    });
    if (!result.ok) {
      const error = await result.json().catch(()=>({}));
      return response(error.code === '42501' ? 403 : error.code === '22023' ? 400 : 503,
        error.code === '42501' ? 'ADMIN_REQUIRED' : 'RAFFLE_UNAVAILABLE');
    }
    const data = await result.json();
    if (!Array.isArray(data.entries) || data.entries.length > 1000 || !Array.isArray(data.unconfiguredActivities) ||
      !Number.isSafeInteger(data.totalEntries) || data.totalEntries < 0 ||
      !Number.isSafeInteger(data.uniqueParticipants) || data.uniqueParticipants < 0 ||
      !Number.isSafeInteger(data.pendingAttendances) || data.pendingAttendances < 0) return response(503,'RAFFLE_UNAVAILABLE');
    return response(200,null,{
      date,timezone:'America/Sao_Paulo',offset:Number(rawOffset),pageSize:1000,
      totalEntries:data.totalEntries,uniqueParticipants:data.uniqueParticipants,
      hasMore:data.hasMore === true,nextOffset:data.hasMore === true ? Number(rawOffset) + 1000 : null,
      entries:data.entries.map(e=>({ticketId:e.ticketId,participantId:e.participantId,name:e.name,
        activityId:e.activityId,activityName:e.activityName})),
      unconfiguredActivities:data.unconfiguredActivities.map(a=>({id:a.id,name:a.name})),
      pendingAttendances:data.pendingAttendances
    });
  } catch { return response(503,'RAFFLE_UNAVAILABLE'); }
}

// Sorteio no painel: listar, sortear, marcar ausente e apagar.
export async function draws({ request, url, adminRpc }) {
  let input;
  try {
    input = request.method === 'GET' ? Object.fromEntries(url.searchParams) : await readJson(request, 2000);
    if (!input || !validDate(input.date)) throw Error();
    if (request.method === 'POST' && input.prize !== undefined && (typeof input.prize !== 'string' || input.prize.trim().length > 120)) throw Error();
    if (request.method === 'POST' && input.sponsor !== undefined && input.sponsor !== null && !sponsorId(input.sponsor)) throw Error();
    if (['PATCH','DELETE'].includes(request.method) && (typeof input.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id))) throw Error();
  } catch { return response(400, 'INVALID_DRAW'); }
  try {
    const { data, error } = await adminRpc('admin_raffle_draw', {
      p_action:({GET:'list',POST:'draw',PATCH:'absent',DELETE:'delete'})[request.method], p_date:input.date,
      p_prize:request.method === 'POST' ? (input.prize ?? '').trim() : '', p_draw:['PATCH','DELETE'].includes(request.method) ? input.id : null,
      p_sponsor:request.method === 'POST' ? input.sponsor ?? null : null
    }, 'DRAW_UNAVAILABLE');
    if (error) return error;
    if (!Array.isArray(data?.draws) || !Array.isArray(data.reel) ||
      !Number.isSafeInteger(data.remainingParticipants) || !Number.isSafeInteger(data.totalEntries)) return response(503,'DRAW_UNAVAILABLE');
    return response(200,null,{ date:input.date, drawnId:typeof data.drawnId === 'string' ? data.drawnId : null,
      reel:data.reel.filter(name => typeof name === 'string'),
      draws:data.draws.map(d=>({id:d.id,name:d.name,prize:d.prize,absent:d.absent === true,drawnAt:d.drawnAt,
        sponsor:typeof d.sponsor === 'string' ? d.sponsor : null,
        chances:Number.isSafeInteger(d.chances) ? d.chances : 0})),
      remainingParticipants:data.remainingParticipants, totalEntries:data.totalEntries });
  } catch { return response(503,'DRAW_UNAVAILABLE'); }
}
