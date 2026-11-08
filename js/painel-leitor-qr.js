// Painel: leitor de QR para registrar presença pela câmera.
const scanState = { version:0, stream:null, detector:null, timer:null, busy:false, seen:new Map(), count:0, canvas:null };

function scanResult(kind, text) {
  // Sem leitura válida, não deixa na tela a foto da pessoa anterior.
  if (kind === "error" || kind === "idle") $("scanPerson").replaceChildren();
  $("scanResult").textContent = text;
  $("scanResult").className = `scan-result ${kind}`;
  globalThis.navigator?.vibrate?.(kind === "ok" ? 80 : kind === "warn" ? [40, 40, 40] : [120, 60, 120]);
}

async function readFrame() {
  const video = $("scanVideo");
  if (!video.videoWidth) return "";
  if (scanState.detector) return (await scanState.detector.detect(video))[0]?.rawValue ?? "";
  // Reserva para navegadores sem BarcodeDetector (Safari no iPhone): jsQR sobre um quadro reduzido.
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.round(video.videoWidth * scale), height = Math.round(video.videoHeight * scale);
  scanState.canvas ??= document.createElement("canvas");
  scanState.canvas.width = width; scanState.canvas.height = height;
  const context = scanState.canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(video, 0, 0, width, height);
  return jsQR(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: "dontInvert" })?.data ?? "";
}

async function handleScan(value) {
  const activity = $("adminActivity").value;
  // A pessoa costuma ficar parada na frente da câmera: cada QR é lido uma vez durante a sua
  // validade (até 60 s), para não aparecer "já estava presente" logo depois do registro.
  const now = Date.now();
  for (const [seen, at] of scanState.seen) if (now - at > 60000) scanState.seen.delete(seen);
  if (!value || scanState.busy || !activity || scanState.seen.has(value)) return;
  scanState.seen.set(value, now);
  if (!value.startsWith("S1.")) { scanResult("error", "❌ Esse QR não é do passaporte da SECCIM."); return; }
  const version = scanState.version;
  scanState.busy = true;
  try {
    const token = await accessToken();
    const data = await request("/functions/v1/passport/admin/attendance/qr", { method: "POST", token, body: { activity, token: value } });
    if (version !== scanState.version) return;
    const name = data?.person?.name || "Participante";
    // Foto do perfil para o organizador conferir se é a mesma pessoa que mostrou o QR.
    $("scanPerson").replaceChildren(avatarNode(name, data?.person?.photoUrl));
    if (data?.result === "registered") { scanState.count++; scanResult("ok", `✅ ${name} — presença registrada`); }
    else scanResult("warn", `🔁 ${name} já estava presente`);
    $("scanCount").textContent = `${scanState.count} ${scanState.count === 1 ? "presença registrada" : "presenças registradas"} por QR nesta sessão`;
    loadAttendees();
  } catch (error) {
    if (version !== scanState.version) return;
    if (error.status === 410) scanResult("error", "⏱️ QR expirado: peça para a pessoa fechar e abrir “Meu QR” de novo.");
    else if (error.status === 400) scanResult("error", "❌ QR inválido. Registre pela busca por nome.");
    else if (error.status === 403) scanResult("error", "Sua conta não tem permissão para registrar presenças.");
    else { scanState.seen.delete(value); scanResult("error", "⚠️ Falha de conexão. Aponte de novo para tentar."); }
  } finally { if (version === scanState.version) scanState.busy = false; }
}

function scanLoop(version) {
  scanState.timer = setTimeout(async () => {
    if (version !== scanState.version) return;
    try { const value = await readFrame(); if (version === scanState.version && value) await handleScan(value); } catch {}
    if (version === scanState.version) scanLoop(version);
  }, 200);
}

async function openScanner() {
  const activity = adminState.activities.find(a => a.id === $("adminActivity").value);
  if (!activity || !state.session) return;
  closeScanner();
  const version = scanState.version;
  $("scanPanel").hidden = false; $("scanOpen").hidden = true;
  $("scanActivity").textContent = `Registrando presença em: ${activity.name}`;
  scanState.count = 0; $("scanCount").textContent = "";
  scanResult("idle", "Abrindo a câmera...");
  try {
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) throw Object.assign(Error(), { code: "unsupported" });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    if (version !== scanState.version) { stream.getTracks().forEach(track => track.stop()); return; }
    scanState.stream = stream;
    $("scanVideo").srcObject = stream; await $("scanVideo").play();
    const nativeQr = "BarcodeDetector" in globalThis && (await BarcodeDetector.getSupportedFormats?.().catch(() => []))?.includes("qr_code");
    if (nativeQr) scanState.detector = new BarcodeDetector({ formats: ["qr_code"] });
    else await loadScript("vendor/jsqr-1.4.0.js", "jsQR");
    if (version !== scanState.version) return;
    scanResult("idle", "Aponte para o QR na tela do participante.");
    scanLoop(version);
  } catch (error) {
    if (version !== scanState.version) return;
    scanResult("error", error?.name === "NotAllowedError" ? "Permita o uso da câmera nas configurações do navegador e tente de novo."
      : error?.code === "unsupported" ? "Este navegador não permite usar a câmera. Use a busca por nome."
      : "Não foi possível abrir a câmera. Use a busca por nome.");
  }
}

function closeScanner() {
  scanState.version++; clearTimeout(scanState.timer);
  scanState.stream?.getTracks?.().forEach(track => track.stop());
  Object.assign(scanState, { stream:null, detector:null, busy:false }); scanState.seen.clear();
  $("scanVideo").srcObject = null; $("scanPanel").hidden = true; $("scanPerson").replaceChildren(); $("scanOpen").hidden = false;
}

$("scanOpen").addEventListener("click", openScanner);
$("scanClose").addEventListener("click", closeScanner);
// Câmera desligada ao minimizar ou trocar de aplicativo: privacidade e bateria.
document.addEventListener("visibilitychange", () => { if (document.hidden) closeScanner(); });
