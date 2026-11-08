// Rotas de presença da organização.
import { readQrToken, qrSecretValid } from '../qr-token.mjs';
import { response, readJson } from '../http.mjs';

// Presenças em lote por lista de e-mails.
export async function bulkAttendance({ request, adminRpc }) {
  let input;
  try {
    input = await readJson(request,32000);
    if (!input || typeof input.activity !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.activity) ||
      !Array.isArray(input.emails) || input.emails.length < 1 || input.emails.length > 100 ||
      !input.emails.every(email => typeof email === 'string' && email.length <= 1000)) throw Error();
  } catch { return response(400,'INVALID_BULK_ATTENDANCE'); }
  try {
    const {data,error}=await adminRpc('admin_bulk_attendance',{p_activity:input.activity,p_emails:input.emails},'ATTENDANCE_UNAVAILABLE');
    if(error)return error;
    if(!Array.isArray(data.registered)||!Array.isArray(data.alreadyPresent)||!Array.isArray(data.notFound)||
      !Array.isArray(data.invalid)||!Number.isSafeInteger(data.duplicatesIgnored))return response(503,'ATTENDANCE_UNAVAILABLE');
    const entries=list=>list.length<=100&&list.every(e=>typeof e==='string'||
      (e&&typeof e.name==='string'&&typeof e.email==='string'&&e.email.length<=254));
    if(!entries(data.registered)||!entries(data.alreadyPresent)||!entries(data.notFound)||!entries(data.invalid))return response(503,'ATTENDANCE_UNAVAILABLE');
    return response(200,null,{registered:data.registered,alreadyPresent:data.alreadyPresent,
      notFound:data.notFound,invalid:data.invalid,duplicatesIgnored:data.duplicatesIgnored});
  }catch{return response(503,'ATTENDANCE_UNAVAILABLE');}
}

// Cadastro na hora de quem ainda não tem conta.
export async function walkin({ request, adminRpc }) {
  let input;
  try {
    input = await readJson(request, 2000);
    if (!input || typeof input.activity !== 'string' || input.activity.length > 200 ||
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.activity) ||
      typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120 ||
      typeof input.email !== 'string' || input.email.trim().length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw Error();
  } catch { return response(400, 'INVALID_PARTICIPANT'); }
  try {
    const { data, error } = await adminRpc('admin_register_participant', { p_activity:input.activity,
      p_name:input.name.trim(), p_email:input.email.trim().toLowerCase() }, 'PARTICIPANT_UNAVAILABLE');
    if (error) return error;
    const p = data?.participant;
    if (!p?.id || typeof p.name !== 'string') return response(503,'PARTICIPANT_UNAVAILABLE');
    return response(200,null,{ created:data.created === true, changed:data.changed === true,
      participant:{ id:p.id, name:p.name, email:p.email, linked:p.linked === true } });
  } catch { return response(503,'PARTICIPANT_UNAVAILABLE'); }
}

// Leitor de QR da organização.
export async function qrScan({ request, qrSecret, now, adminRpc, signPhotos }) {
  if (!qrSecretValid(qrSecret)) return response(503, 'QR_NOT_CONFIGURED');
  let input, scanned;
  try {
    input = await readJson(request, 2000);
    if (!input || typeof input.activity !== 'string' || input.activity.length > 200 ||
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.activity) || typeof input.token !== 'string' || input.token.length > 200) throw Error();
    scanned = await readQrToken(qrSecret, input.token, now());
  } catch { return response(400, 'QR_INVALID'); }
  if (scanned.error) return response(scanned.error === 'QR_EXPIRED' ? 410 : 400, scanned.error);
  try {
    // A mesma RPC das presenças em lote: confere a organização e não duplica selo nem chance.
    const { data, error } = await adminRpc('admin_person_attendances', { p_participant:scanned.participantId,
      p_add:[input.activity], p_remove:[] }, 'ATTENDANCE_UNAVAILABLE');
    if (error) return error;
    if (!data?.participant?.id || !Array.isArray(data.activities)) return response(503, 'ATTENDANCE_UNAVAILABLE');
    // Apelido e foto do perfil ajudam o organizador a conferir se é a mesma pessoa.
    const card = await adminRpc('profile_card', { p_participant:scanned.participantId }, 'ATTENDANCE_UNAVAILABLE').catch(() => ({}));
    const photos = await signPhotos([card.data?.photoPath]);
    return response(200, null, { result: data.added > 0 ? 'registered' : 'already',
      person: { id: data.participant.id, name: data.participant.name, nickname: card.data?.nickname ?? null,
        photoUrl: photos[card.data?.photoPath] ?? null } });
  } catch { return response(503, 'ATTENDANCE_UNAVAILABLE'); }
}

// Presenças de uma pessoa em várias palestras de uma vez.
export async function personAttendance({ request, url, adminRpc }) {
  let input;
  const slugs = list => Array.isArray(list) && list.length <= 50 &&
    list.every(id => typeof id === 'string' && id.length <= 200 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id));
  try {
    input = request.method === 'GET' ? Object.fromEntries(url.searchParams) : await readJson(request, 8000);
    if (!input || typeof input.participant !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.participant)) throw Error();
    if (request.method === 'POST' && (!slugs(input.add ?? []) || !slugs(input.remove ?? []) ||
      (input.add ?? []).length + (input.remove ?? []).length < 1)) throw Error();
  } catch { return response(400, 'INVALID_PERSON_ATTENDANCE'); }
  try {
    const { data, error } = await adminRpc('admin_person_attendances', { p_participant:input.participant,
      p_add:request.method === 'POST' ? [...new Set(input.add ?? [])] : [],
      p_remove:request.method === 'POST' ? [...new Set(input.remove ?? [])] : [] }, 'ATTENDANCE_UNAVAILABLE');
    if (error) return error;
    if (!data?.participant?.id || !Array.isArray(data.activities)) return response(503,'ATTENDANCE_UNAVAILABLE');
    return response(200,null,{ added:Number.isSafeInteger(data.added) ? data.added : 0,
      removed:Number.isSafeInteger(data.removed) ? data.removed : 0,
      participant:{ id:data.participant.id, name:data.participant.name, email:data.participant.email },
      activities:data.activities.filter(id => typeof id === 'string') });
  } catch { return response(503,'ATTENDANCE_UNAVAILABLE'); }
}

// Presenças por palestra: visão geral, busca, lista, registrar e remover.
export async function attendance({ request, url, adminRpc }) {
  let input, action;
  try {
    input = request.method === 'GET' ? Object.fromEntries(url.searchParams) : await readJson(request, 2000);
    action = request.method === 'POST' ? 'add' : request.method === 'DELETE' ? 'remove' : input?.action;
    if (!input || !(request.method === 'GET' ? ['overview','search','list'] : ['add','remove']).includes(action)) throw Error();
    if (action !== 'overview' && (typeof input.activity !== 'string' || input.activity.length > 200 ||
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.activity))) throw Error();
    if (action === 'search' && (typeof input.q !== 'string' || input.q.trim().length < 2 || input.q.trim().length > 120)) throw Error();
    if (['add','remove'].includes(action) && (typeof input.participant !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.participant))) throw Error();
  } catch { return response(400, 'INVALID_ATTENDANCE'); }
  try {
    const { data, error } = await adminRpc('admin_attendance', { p_action:action,
      p_activity:action === 'overview' ? null : input.activity,
      p_participant:['add','remove'].includes(action) ? input.participant : null,
      p_query:action === 'search' ? input.q.trim() : null }, 'ATTENDANCE_UNAVAILABLE');
    if (error) return error;
    const person = p => ({ id:p.id, name:p.name, email:p.email });
    if (action === 'overview') {
      if (!Array.isArray(data.activities) || !Number.isSafeInteger(data.participants)) return response(503,'ATTENDANCE_UNAVAILABLE');
      return response(200,null,{ participants:data.participants, activities:data.activities.map(a=>({id:a.id,name:a.name,
        eventDate:typeof a.eventDate === 'string' ? a.eventDate : null,raffleEligible:a.raffleEligible === true,
        attendances:Number.isSafeInteger(a.attendances) ? a.attendances : 0})) });
    }
    if (action === 'search') {
      if (!Array.isArray(data.participants)) return response(503,'ATTENDANCE_UNAVAILABLE');
      return response(200,null,{ participants:data.participants.map(p=>({...person(p),present:p.present === true})) });
    }
    if (action === 'list') {
      if (!Array.isArray(data.attendees) || !Number.isSafeInteger(data.total)) return response(503,'ATTENDANCE_UNAVAILABLE');
      return response(200,null,{ total:data.total, attendees:data.attendees.map(p=>({...person(p),recordedAt:p.recordedAt})) });
    }
    return response(200,null,{ changed:data.changed === true });
  } catch { return response(503,'ATTENDANCE_UNAVAILABLE'); }
}
