// Base compartilhada: atalho $, estado da sessão, textos, chamadas HTTP, datas, avatar e validação de links.
const $ = id => document.getElementById(id);
const state = { copy: Object.create(null), badges: [], session: null, generation: 0, focus: null, mode: "login", busy: false };
function text(key, fallback = "", values = {}) {
  const template = state.copy[key] ?? fallback;
  return template.replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
}

function message(id, value, error = false) {
  $(id).textContent = value;
  $(id).classList.toggle("error", error);
  $(id).hidden = !value;
}

function configured() {
  // Chaves JWT legadas não são aceitas nesta implementação para evitar confusão
  // entre anon e service_role. Usar a chave publishable atual do Dashboard.
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SUPABASE_URL) &&
    /^sb_publishable_[A-Za-z0-9_-]+$/.test(SUPABASE_PUBLISHABLE_KEY);
}

async function request(path, { method = "GET", body, token } = {}) {
  return fetchJson(`${SUPABASE_URL}${path}`, {
    method, body, headers: { apikey: SUPABASE_PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  });
}

function firebaseConfigured() {
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(FIREBASE_PROJECT_ID) && /^AIza[\w-]+$/.test(FIREBASE_API_KEY);
}

async function firebaseRequest(action, body, refresh = false) {
  if (!firebaseConfigured()) throw new Error("Autenticação indisponível.");
  const base = refresh ? "https://securetoken.googleapis.com/v1/token" : `https://identitytoolkit.googleapis.com/v1/${action}`;
  return fetchJson(`${base}?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method: "POST", body: refresh ? new URLSearchParams(body).toString() : body,
    headers: { "X-Firebase-Locale": "pt-BR" }, form: refresh
  });
}

async function fetchJson(url, { method = "GET", body, headers = {}, form = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method, signal: controller.signal, credentials: "omit", cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { ...headers, ...(body ? { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" } : {}) },
      ...(body ? { body: form ? body : JSON.stringify(body) } : {})
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error("Falha na requisição.");
      error.status = response.status;
      error.code = data?.code ?? data?.error?.message?.split(" : ")[0];
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function applyCopy() {
  document.querySelectorAll("[data-copy]").forEach(node => {
    if (state.copy[node.dataset.copy] !== undefined) node.textContent = text(node.dataset.copy);
  });
  document.title = text("page_title", "Passaporte Digital");
}

// Normaliza links digitados (editor, patrocinadores e perfil). Mesmas regras do backend.
function editorLink(raw){
  // Quem cola "instagram.com/fulano" quer dizer https://instagram.com/fulano.
  const value=raw.trim();if(!value)return "";
  return /^[a-z][a-z0-9+.-]*:/i.test(value)?value:`https://${value}`;
}
const dayLabel = date => new Date(`${date}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" });
const shortDate = date => date ? date.split("-").reverse().slice(0, 2).join("/") : "sem data";

// Bibliotecas de QR ficam em vendor/ e só carregam quando alguém usa o QR (ver vendor/README.md).
const scriptLoads = new Map();
function loadScript(src, globalName) {
  if (globalThis[globalName]) return Promise.resolve();
  if (!scriptLoads.has(src)) scriptLoads.set(src, new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src; script.async = true;
    script.onload = () => globalThis[globalName] ? resolve() : reject(Error("Biblioteca indisponível."));
    script.onerror = () => { scriptLoads.delete(src); reject(Error("Biblioteca indisponível.")); };
    document.head.append(script);
  }));
  return scriptLoads.get(src);
}

// Foto pequena ou iniciais: usada no perfil, no ranking, no leitor de QR e na moderação.
function avatarNode(name, photoUrl, className = "avatar") {
  const box = document.createElement("span"); box.className = className;
  const safe = typeof photoUrl === "string" && /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/sign\/avatars\//.test(photoUrl);
  if (safe) {
    const img = document.createElement("img"); img.src = photoUrl; img.alt = ""; img.loading = "lazy";
    img.addEventListener?.("error", () => { img.remove?.(); box.textContent = initials(name); });
    box.append(img);
  } else box.textContent = initials(name);
  return box;
}
const initials = name => (name || "?").replace(/^@/, "").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join("") || "?";

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
