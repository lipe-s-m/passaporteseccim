const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
};

function response(status, code, data) {
  return new Response(JSON.stringify(data ?? { code }), { status, headers: cors });
}

function claimsFrom(token) {
  const [header, payload, signature, extra] = token.split(".");
  if (!header || !payload || !signature || extra) throw new Error("Token malformado.");
  const decode = value => JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")));
  if (decode(header).alg !== "RS256") throw new Error("Algoritmo inválido.");
  return decode(payload);
}

export function createHandler({ projectId, apiKey, supabaseUrl, serviceKey, fetcher = fetch, now = () => Date.now() }) {
  return async request => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const faq = url.pathname.endsWith('/passport/questions');
    if (!(faq ? ['GET','POST','PATCH','DELETE'] : ['GET']).includes(request.method)) return response(405, "METHOD_NOT_ALLOWED");
    const match = /^Bearer ([A-Za-z0-9_.-]+)$/i.exec(request.headers.get("Authorization") ?? "");
    if (!match || match[1].length > 8192) return response(401, "UNAUTHORIZED");
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) || !/^AIza[\w-]+$/.test(apiKey) || !supabaseUrl || !serviceKey) {
      return response(503, "AUTH_NOT_CONFIGURED");
    }

    let claims;
    try {
      claims = claimsFrom(match[1]);
      const time = Math.floor(now() / 1000);
      // Estes campos ainda são NÃO confiáveis. Só serão usados após o Google
      // verificar o token e retornar a conta correspondente em accounts:lookup.
      if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}` ||
        typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 128 ||
        !Number.isInteger(claims.exp) || claims.exp <= time ||
        !Number.isInteger(claims.iat) || claims.iat > time + 60 ||
        !Number.isInteger(claims.auth_time) || claims.auth_time > time + 60) throw new Error("Token inválido.");
    } catch { return response(401, "UNAUTHORIZED"); }

    let user;
    try {
      const checked = await fetcher(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: match[1] })
      });
      if (!checked.ok) return response(checked.status === 429 || checked.status >= 500 ? 503 : 401, "AUTH_UNAVAILABLE");
      const data = await checked.json();
      user = Array.isArray(data.users) && data.users.length === 1 ? data.users[0] : null;
      if (!user || user.localId !== claims.sub || user.disabled ||
        (user.validSince && Number(user.validSince) > claims.auth_time)) return response(401, "UNAUTHORIZED");
      if (user.emailVerified !== true) return response(403, "EMAIL_NOT_VERIFIED");
      if (typeof user.email !== "string" || user.email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(user.email)) {
        return response(403, "EMAIL_REQUIRED");
      }
    } catch { return response(503, "AUTH_UNAVAILABLE"); }

    if (url.pathname.endsWith('/passport/admin/raffle')) {
      const date = url.searchParams.get('date');
      const rawOffset = url.searchParams.get('offset') ?? '0';
      if (!date || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(date) ||
        !/^(0|[1-9]\d{0,7})$/.test(rawOffset) || Number(rawOffset) > 10000000) return response(400,'INVALID_RAFFLE_QUERY');
      const parsedDate = new Date(date + 'T00:00:00Z');
      if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10) !== date) return response(400,'INVALID_RAFFLE_QUERY');
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

    if (url.pathname.endsWith('/passport/ranking')) {
      try {
        const result = await fetcher(`${supabaseUrl}/rest/v1/rpc/get_badge_ranking`, {
          method:'POST', redirect:'error', signal:AbortSignal.timeout(8000),
          headers:{'Content-Type':'application/json',apikey:serviceKey,Authorization:`Bearer ${serviceKey}`},
          body:JSON.stringify({p_uid:user.localId})
        });
        if (!result.ok) return response(503,'RANKING_UNAVAILABLE');
        const data = await result.json();
        const validCount = n => Number.isSafeInteger(n) && n >= 0;
        if (!Array.isArray(data.entries) || data.entries.length > 20 ||
          !data.entries.every(e => Number.isSafeInteger(e.position) && e.position > 0 && typeof e.name === 'string' && validCount(e.badgeCount)) ||
          !data.mine || !validCount(data.mine.badgeCount) ||
          !(data.mine.position === null || Number.isSafeInteger(data.mine.position) && data.mine.position > 0)) return response(503,'RANKING_UNAVAILABLE');
        return response(200,null,{
          entries:data.entries.map(e=>({position:e.position,name:e.name,badgeCount:e.badgeCount,isMe:e.isMe === true})),
          mine:{position:data.mine.position,badgeCount:data.mine.badgeCount}
        });
      } catch { return response(503,'RANKING_UNAVAILABLE'); }
    }

    if (faq) {
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

    try {
      // UID, nome e e-mail vêm exclusivamente da resposta autenticada do Google.
      // Query string, corpo e claims de papel enviados pelo cliente são ignorados.
      const result = await fetcher(`${supabaseUrl}/rest/v1/rpc/get_firebase_passport`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
        headers: { "Content-Type": "application/json", apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ p_uid: user.localId, p_email: user.email.trim().toLowerCase(),
          p_name: typeof user.displayName === "string" ? user.displayName.slice(0, 120) : "Participante" })
      });
      if (!result.ok) return response(result.status === 409 ? 409 : 503, "PASSPORT_UNAVAILABLE");
      const passport = await result.json();
      if (!passport?.participant?.id || !passport.participant.full_name || !Array.isArray(passport.earnedBadges)) {
        return response(503, "PASSPORT_UNAVAILABLE");
      }
      // Resposta com campos permitidos; sem e-mail, tokens, hashes ou credenciais.
      return response(200, null, { participant: { id: passport.participant.id, full_name: passport.participant.full_name },
        earnedBadges: passport.earnedBadges.filter(id => typeof id === "string") });
    } catch { return response(503, "PASSPORT_UNAVAILABLE"); }
  };
}
