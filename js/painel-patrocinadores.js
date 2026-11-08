// Painel: editor de patrocinadores (logo, fotos e links).
const sponsorsPath = "/functions/v1/passport/admin/sponsors";
const sponsorState = { version:0, list:[], current:null, revision:null, busy:false, dirty:false, loaded:false, photos:[] };
const sponsorLinkFields = { vagas:"sponsorVagas", site:"sponsorSite", linkedin:"sponsorLinkedin", instagram:"sponsorInstagram", youtube:"sponsorYoutube" };
const sponsorLinkLabels = { vagas:"Vagas e estágios", site:"Site", linkedin:"LinkedIn", instagram:"Instagram", youtube:"YouTube" };
const sponsorTextFields = ["sponsorName","sponsorId","sponsorTagline","sponsorLogo","sponsorAbout","sponsorContributions",...Object.values(sponsorLinkFields)];
const slugify = name => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function resetSponsors() {
  sponsorState.version++; Object.assign(sponsorState, { list:[], current:null, revision:null, busy:false, dirty:false, loaded:false, photos:[] });
  renderSponsorPhotos(); renderSponsorLogo();
  $("sponsorForm").hidden = true; $("sponsorPreviewFrame").hidden = true; $("sponsorFields").disabled = false;
  for (const id of sponsorTextFields) $(id).value = "";
  $("sponsorPublished").checked = false; $("sponsorSelect").value = "";
  renderSponsorOptions(); message("sponsorMessage", "");
  try { sessionStorage.removeItem("seccim.sponsor.preview"); } catch {}
}

function renderSponsorOptions() {
  const option = (value, label) => { const node = document.createElement("option"); node.value = value; node.textContent = label; return node; };
  const selected = $("sponsorSelect").value;
  $("sponsorSelect").replaceChildren(option("", "Selecione"), option("__new", "+ Novo patrocinador"),
    ...sponsorState.list.map(s => option(s.id, s.published ? s.name : `${s.name} (rascunho)`)));
  $("sponsorSelect").value = selected === "__new" || sponsorState.list.some(s => s.id === selected) ? selected : "";
  const raffle = $("raffleSponsor").value;
  $("raffleSponsor").replaceChildren(option("", "Organização SECCIM"), ...sponsorState.list.map(s => option(s.id, s.name)));
  $("raffleSponsor").value = sponsorState.list.some(s => s.id === raffle) ? raffle : "";
}

async function loadSponsorsAdmin() {
  if (!state.session) return;
  const version = ++sponsorState.version;
  try {
    const token = await accessToken();
    if (version !== sponsorState.version) return;
    const data = await request(sponsorsPath, { token });
    if (version !== sponsorState.version) return;
    if (!Array.isArray(data?.sponsors)) throw Error();
    sponsorState.list = data.sponsors; sponsorState.loaded = true;
    renderSponsorOptions();
  } catch {
    if (version === sponsorState.version) message("sponsorMessage", "Não foi possível carregar os patrocinadores.", true);
  }
}

function fillSponsor(sponsor) {
  sponsorState.current = sponsor?.id ?? null; sponsorState.revision = sponsor?.content_revision ?? null; sponsorState.dirty = false;
  $("sponsorName").value = sponsor?.name ?? ""; $("sponsorId").value = sponsor?.id ?? "";
  // O identificador vira o endereço (#id) e o vínculo dos brindes: não muda depois de criado.
  $("sponsorId").readOnly = !!sponsor;
  $("sponsorTagline").value = sponsor?.tagline ?? ""; $("sponsorAbout").value = sponsor?.about ?? "";
  $("sponsorLogo").value = sponsor?.logo_url ?? "";
  $("sponsorContributions").value = (sponsor?.contributions ?? []).join("\n");
  sponsorState.photos = (sponsor?.photos ?? []).map(p => ({ url: p.url, caption: p.caption ?? "" }));
  renderSponsorPhotos(); renderSponsorLogo();
  for (const [key, id] of Object.entries(sponsorLinkFields)) $(id).value = sponsor?.links?.[key] ?? "";
  $("sponsorPublished").checked = sponsor?.published === true;
  $("sponsorForm").hidden = false; $("sponsorPreviewFrame").hidden = true; message("sponsorMessage", "");
}

function readSponsor() {
  const name = $("sponsorName").value.trim(), id = $("sponsorId").value.trim();
  if (!name) throw Error("Informe o nome do patrocinador.");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) || id.length > 60) throw Error("Identificador: use letras minúsculas, números e hífens (ex.: empresa-x).");
  const logo = $("sponsorLogo").value.trim();
  if (logo && !sponsorImage(logo)) throw Error("Envie o logo de novo pelo botão “Enviar logo”.");
  const contributions = $("sponsorContributions").value.split("\n").map(line => line.trim()).filter(Boolean);
  if (contributions.length > 20 || contributions.some(line => line.length > 200)) throw Error("Entregas: até 20 itens, com até 200 caracteres cada.");
  const photos = sponsorState.photos.map(photo => {
    const url = photo.url, caption = (photo.caption ?? "").trim();
    if (!sponsorImage(url)) throw Error("Uma das fotos não é válida: remova e envie de novo.");
    if (caption.length > 160) throw Error("Legendas: até 160 caracteres.");
    return caption ? { url, caption } : { url };
  });
  if (photos.length > 12) throw Error("Use até 12 fotos.");
  const links = {};
  for (const [key, field] of Object.entries(sponsorLinkFields)) {
    const url = editorLink($(field).value); if (!url) continue;
    let valid = false; try { const u = new URL(url); valid = u.protocol === "https:" && !u.username && !u.password; } catch {}
    if (!valid) throw Error(`O link de ${sponsorLinkLabels[key]} precisa começar com https://.`);
    $(field).value = url; links[key] = url;
  }
  return { id, content: { name, tagline: $("sponsorTagline").value.trim(), about: $("sponsorAbout").value.trim(),
    contributions, logo_url: logo || null, photos, links, published: $("sponsorPublished").checked } };
}

async function saveSponsor(event) {
  event.preventDefault();
  if (sponsorState.busy || !state.session) return;
  let input; try { input = readSponsor(); } catch (error) { message("sponsorMessage", error.message, true); return; }
  const version = sponsorState.version;
  sponsorState.busy = true; $("sponsorFields").disabled = true; $("sponsorSave").disabled = true;
  message("sponsorMessage", "Salvando...");
  try {
    const token = await accessToken();
    const data = await request(sponsorsPath, { method: "POST", token, body: { ...input, revision: sponsorState.current ? sponsorState.revision : null } });
    if (version !== sponsorState.version) return;
    if (!data?.sponsor?.id || !Array.isArray(data.sponsors)) throw Error();
    sponsorState.list = data.sponsors; renderSponsorOptions();
    $("sponsorSelect").value = data.sponsor.id; fillSponsor(data.sponsor);
    message("sponsorMessage", data.sponsor.published ? "Salvo e publicado no site." : "Salvo como rascunho. Marque “Publicado no site” quando o patrocinador aprovar.");
    loadSponsorStrip();
  } catch (error) {
    if (version !== sponsorState.version) return;
    message("sponsorMessage", error.status === 409 ? "Outra pessoa alterou este patrocinador ou o identificador já existe. Recarregue antes de salvar."
      : error.status === 400 ? "Confira os textos, imagens e links antes de salvar." : "Não foi possível salvar. Seus campos foram mantidos.", true);
  } finally {
    if (version === sponsorState.version) { sponsorState.busy = false; $("sponsorFields").disabled = false; $("sponsorSave").disabled = false; }
  }
}

function renderSponsorLogo() {
  const url = $("sponsorLogo").value;
  $("sponsorLogoPreview").hidden = !url; if (url) $("sponsorLogoPreview").src = url;
  $("sponsorLogoClear").hidden = !url;
}

async function uploadSponsorLogo(file) {
  message("sponsorMessage", "Enviando logo...");
  try {
    const url = await uploadSiteImage(await prepareImage(file, { maxSide: 800, transparent: true, maxBytes: 700 * 1024 }), "sponsors");
    $("sponsorLogo").value = url; renderSponsorLogo(); sponsorState.dirty = true;
    message("sponsorMessage", "Logo enviado. Salve o patrocinador para publicar.");
  } catch (error) { message("sponsorMessage", imageError(error), true); }
  finally { $("sponsorLogoFile").value = ""; }
}

// Fotos do carrossel: lista com miniatura, legenda, ordem e remoção.
function renderSponsorPhotos() {
  const photos = sponsorState.photos;
  $("sponsorPhotoList").replaceChildren(...photos.map((photo, index) => {
    const item = document.createElement("li"); item.className = "photo-item";
    const img = document.createElement("img"); img.src = photo.url; img.alt = ""; img.loading = "lazy";
    const caption = document.createElement("input"); caption.type = "text"; caption.maxLength = 160; caption.value = photo.caption ?? "";
    caption.placeholder = "Legenda (opcional)"; caption.setAttribute("aria-label", `Legenda da foto ${index + 1}`);
    caption.addEventListener("input", () => { photo.caption = caption.value; sponsorState.dirty = true; });
    const controls = document.createElement("div"); controls.className = "photo-controls";
    for (const [label, text, step] of [["Mover para cima", "↑", -1], ["Mover para baixo", "↓", 1]]) {
      const move = document.createElement("button"); move.type = "button"; move.className = "action-button secondary"; move.textContent = text;
      move.setAttribute("aria-label", `${label}: foto ${index + 1}`); move.disabled = index + step < 0 || index + step >= photos.length;
      move.addEventListener("click", () => { photos.splice(index + step, 0, photos.splice(index, 1)[0]); sponsorState.dirty = true; renderSponsorPhotos(); });
      controls.append(move);
    }
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "action-button secondary danger"; remove.textContent = "Remover";
    remove.addEventListener("click", () => { photos.splice(index, 1); sponsorState.dirty = true; renderSponsorPhotos(); });
    controls.append(remove);
    item.append(img, caption, controls);
    return item;
  }));
  $("sponsorPhotoCount").textContent = `${photos.length} / 12 fotos`;
}

async function uploadSponsorPhotos(files) {
  const list = [...files];
  if (sponsorState.photos.length + list.length > 12) { message("sponsorMessage", "O carrossel aceita até 12 fotos.", true); $("sponsorPhotoFiles").value = ""; return; }
  try {
    for (const [index, file] of list.entries()) {
      message("sponsorMessage", `Enviando foto ${index + 1} de ${list.length}...`);
      const url = await uploadSiteImage(await prepareImage(file, { maxSide: 1600, maxBytes: 1400 * 1024 }), "sponsors");
      sponsorState.photos.push({ url, caption: "" }); sponsorState.dirty = true; renderSponsorPhotos();
    }
    message("sponsorMessage", "Fotos enviadas. Escreva as legendas e salve o patrocinador.");
  } catch (error) { message("sponsorMessage", imageError(error), true); }
  finally { $("sponsorPhotoFiles").value = ""; }
}

$("sponsorLogoFile").addEventListener("change", () => { const file = $("sponsorLogoFile").files?.[0]; if (file) uploadSponsorLogo(file); });
$("sponsorLogoClear").addEventListener("click", () => { $("sponsorLogo").value = ""; renderSponsorLogo(); sponsorState.dirty = true; });
$("sponsorPhotoFiles").addEventListener("change", () => { if ($("sponsorPhotoFiles").files?.length) uploadSponsorPhotos($("sponsorPhotoFiles").files); });
$("sponsorSelect").addEventListener("change", () => {
  if (sponsorState.dirty && !confirm("Descartar as alterações ainda não salvas?")) { $("sponsorSelect").value = sponsorState.current ?? "__new"; return; }
  const id = $("sponsorSelect").value;
  if (!id) { $("sponsorForm").hidden = true; sponsorState.current = null; return; }
  fillSponsor(id === "__new" ? null : sponsorState.list.find(s => s.id === id));
  if (id === "__new") $("sponsorName").focus();
});
$("sponsorName").addEventListener("input", () => { if (!sponsorState.current) $("sponsorId").value = slugify($("sponsorName").value); });
$("sponsorForm").addEventListener("input", () => { sponsorState.dirty = true; });
$("sponsorForm").addEventListener("submit", saveSponsor);
$("sponsorReload").addEventListener("click", async () => {
  if (sponsorState.dirty && !confirm("Descartar as alterações e recarregar?")) return;
  await loadSponsorsAdmin(); const current = sponsorState.list.find(s => s.id === $("sponsorSelect").value); if (current) fillSponsor(current);
});
$("sponsorPreview").addEventListener("click", () => {
  try {
    const { id, content } = readSponsor();
    sessionStorage.setItem("seccim.sponsor.preview", JSON.stringify({ id, ...content }));
    $("sponsorPreviewFrame").src = `patrocinadores.html?preview=1&v=${Date.now()}`; $("sponsorPreviewFrame").hidden = false;
  } catch (error) { message("sponsorMessage", error.message || "Não foi possível abrir a prévia nesta aba.", true); }
});
