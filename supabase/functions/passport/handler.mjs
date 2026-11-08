// Entrada da função: confere método e identidade e repassa para a rota (pasta routes/).
import { cors, response } from './http.mjs';
import { verifyUser } from './auth.mjs';
import { createServices } from './services.mjs';
import { passport, ranking, myQr } from './routes/passaporte.mjs';
import { faq } from './routes/faq.mjs';
import { profile, profilePhoto } from './routes/perfil.mjs';
import { attendance, bulkAttendance, walkin, personAttendance, qrScan } from './routes/presencas.mjs';
import { raffle, draws } from './routes/sorteio.mjs';
import { activityContent, sponsors, siteImages } from './routes/conteudo.mjs';
import { adminProfiles } from './routes/moderacao.mjs';
import { feedback, adminFeedback } from './routes/avaliacoes.mjs';
import { people } from './routes/pessoas.mjs';

// Rota pelo final do caminho: métodos aceitos e função que responde. Sem correspondência, vale o passaporte (GET).
const routes = [
  ['/passport/questions', ['GET','POST','PATCH','DELETE'], faq],
  ['/passport/ranking', ['GET'], ranking],
  ['/passport/qr', ['GET'], myQr],
  ['/passport/profile', ['GET','POST'], profile],
  ['/passport/profile/photo', ['PUT','DELETE'], profilePhoto],
  ['/passport/feedback', ['GET','POST'], feedback],
  ['/passport/people', ['GET'], people],
  ['/passport/admin/attendance', ['GET','POST','DELETE'], attendance],
  ['/passport/admin/attendance/bulk', ['POST'], bulkAttendance],
  ['/passport/admin/attendance/qr', ['POST'], qrScan],
  ['/passport/admin/participants', ['POST'], walkin],
  ['/passport/admin/person', ['GET','POST'], personAttendance],
  ['/passport/admin/raffle', ['GET'], raffle],
  ['/passport/admin/draws', ['GET','POST','PATCH','DELETE'], draws],
  ['/passport/admin/activity-content', ['GET','POST'], activityContent],
  ['/passport/admin/sponsors', ['GET','POST'], sponsors],
  ['/passport/admin/profiles', ['GET','POST'], adminProfiles],
  ['/passport/admin/images', ['PUT'], siteImages],
  ['/passport/admin/feedback', ['GET'], adminFeedback],
];

export function createHandler({ projectId, apiKey, supabaseUrl, serviceKey, qrSecret = '', fetcher = fetch, now = () => Date.now() }) {
  return async request => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const [, methods, route] = routes.find(([suffix]) => url.pathname.endsWith(suffix)) ?? [null, ['GET'], passport];
    if (!methods.includes(request.method)) return response(405, "METHOD_NOT_ALLOWED");
    const { user, error } = await verifyUser(request, { projectId, apiKey, supabaseUrl, serviceKey, fetcher, now });
    if (error) return error;
    return route({ request, url, user, qrSecret, now, fetcher, supabaseUrl, serviceKey,
      ...createServices({ supabaseUrl, serviceKey, fetcher, user }) });
  };
}
