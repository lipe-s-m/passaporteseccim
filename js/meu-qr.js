// QR pessoal do participante.
// O QR identifica a pessoa pelo cadastro e é assinado pelo servidor; renova a cada 30 s
// para que uma captura de tela repassada deixe de valer rapidamente.
const qrState = { version:0, refresh:null, tick:null, expiresAt:0, focus:null };

function drawQr(token) {
  const qr = qrcode(0, "M"); qr.addData(token); qr.make();
  const size = qr.getModuleCount(), margin = 4, ns = "http://www.w3.org/2000/svg";
  let path = "";
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++)
    if (qr.isDark(row, col)) path += `M${col + margin} ${row + margin}h1v1h-1z`;
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${size + margin * 2} ${size + margin * 2}`);
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "QR de presença");
  svg.setAttribute("shape-rendering", "crispEdges");
  const background = document.createElementNS(ns, "rect");
  background.setAttribute("width", "100%"); background.setAttribute("height", "100%"); background.setAttribute("fill", "#fff");
  const dark = document.createElementNS(ns, "path"); dark.setAttribute("d", path); dark.setAttribute("fill", "#000");
  svg.append(background, dark);
  $("qrCode").replaceChildren(svg);
}

function qrCountdown() {
  const seconds = Math.max(0, Math.ceil((qrState.expiresAt - Date.now()) / 1000));
  $("qrTimer").textContent = seconds ? `Atualiza sozinho em ${seconds} s` : "Atualizando...";
}

async function refreshQr() {
  const version = ++qrState.version;
  clearTimeout(qrState.refresh);
  try {
    const token = await accessToken();
    if (version !== qrState.version) return;
    const data = await request("/functions/v1/passport/qr", { token });
    if (version !== qrState.version) return;
    if (typeof data?.token !== "string" || !data.token.startsWith("S1.")) throw Error();
    await loadScript("vendor/qrcode-generator-1.4.4.js", "qrcode");
    if (version !== qrState.version) return;
    drawQr(data.token);
    $("qrName").textContent = data.name || $("participantName").textContent;
    message("qrMessage", "");
    // Relógio do celular pode estar adiantado ou atrasado: sem prazo plausível, renova em 25 s.
    const remaining = Number(data.expiresAt) - Date.now();
    const wait = remaining > 1000 && remaining <= 60000 ? remaining + 300 : 25000;
    qrState.expiresAt = Date.now() + wait;
    qrState.refresh = setTimeout(refreshQr, wait);
    qrCountdown();
  } catch (error) {
    if (version !== qrState.version) return;
    $("qrCode").replaceChildren();
    message("qrMessage", error.status === 503 ? "O QR de presença ainda não está disponível. Procure a organização para registrar pelo nome."
      : "Não foi possível gerar seu QR. Confira a internet; tentando de novo em instantes.", true);
    qrState.expiresAt = 0; $("qrTimer").textContent = "";
    qrState.refresh = setTimeout(refreshQr, 5000);
  }
}

function openMyQr() {
  if (!state.session || !faqState.ready) return;
  qrState.focus = document.activeElement;
  $("qrBackdrop").hidden = false; $("pageContent").inert = true; document.body.style.overflow = "hidden";
  $("qrName").textContent = $("participantName").textContent; $("qrCode").replaceChildren();
  $("qrTimer").textContent = ""; message("qrMessage", "Gerando seu QR...");
  clearInterval(qrState.tick); qrState.tick = setInterval(qrCountdown, 1000);
  $("qrClose").focus();
  return refreshQr();
}

function closeMyQr() {
  qrState.version++; clearTimeout(qrState.refresh); clearInterval(qrState.tick);
  const wasOpen = !$("qrBackdrop").hidden;
  $("qrBackdrop").hidden = true; $("qrCode").replaceChildren(); $("qrTimer").textContent = ""; message("qrMessage", "");
  if (wasOpen) { $("pageContent").inert = false; document.body.style.overflow = ""; if (qrState.focus?.isConnected) qrState.focus.focus(); }
  qrState.focus = null;
}

$("qrOpen").addEventListener("click", openMyQr);
$("qrClose").addEventListener("click", closeMyQr);
