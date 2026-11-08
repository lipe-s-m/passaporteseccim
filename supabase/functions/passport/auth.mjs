// Identidade da pessoa: token do Firebase conferido pelo próprio Google (accounts:lookup).
import { response } from './http.mjs';

function claimsFrom(token) {
  const [header, payload, signature, extra] = token.split(".");
  if (!header || !payload || !signature || extra) throw new Error("Token malformado.");
  const decode = value => JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")));
  if (decode(header).alg !== "RS256") throw new Error("Algoritmo inválido.");
  return decode(payload);
}

// Devolve { user } com a conta verificada ou { error } com a resposta de recusa.
export async function verifyUser(request, { projectId, apiKey, supabaseUrl, serviceKey, fetcher, now }) {
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/i.exec(request.headers.get("Authorization") ?? "");
  if (!match || match[1].length > 8192) return { error: response(401, "UNAUTHORIZED") };
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) || !/^AIza[\w-]+$/.test(apiKey) || !supabaseUrl || !serviceKey) {
    return { error: response(503, "AUTH_NOT_CONFIGURED") };
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
  } catch { return { error: response(401, "UNAUTHORIZED") }; }

  try {
    const checked = await fetcher(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: match[1] })
    });
    if (!checked.ok) return { error: response(checked.status === 429 || checked.status >= 500 ? 503 : 401, "AUTH_UNAVAILABLE") };
    const data = await checked.json();
    const user = Array.isArray(data.users) && data.users.length === 1 ? data.users[0] : null;
    if (!user || user.localId !== claims.sub || user.disabled ||
      (user.validSince && Number(user.validSince) > claims.auth_time)) return { error: response(401, "UNAUTHORIZED") };
    if (user.emailVerified !== true) return { error: response(403, "EMAIL_NOT_VERIFIED") };
    if (typeof user.email !== "string" || user.email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(user.email)) {
      return { error: response(403, "EMAIL_REQUIRED") };
    }
    return { user };
  } catch { return { error: response(503, "AUTH_UNAVAILABLE") }; }
}
