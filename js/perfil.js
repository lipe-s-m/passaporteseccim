// Meu perfil e identidade no cartão do passaporte.
// Apelido, foto, cargo/área/empresa, bio, curso, período e links. O nome oficial (o da inscrição) não muda aqui.
const profilePath = "/functions/v1/passport/profile";
const profileState = { version:0, loaded:false, busy:false, photoUrl:null };
const profileLinkHosts = { linkedin:"linkedin.com", github:"github.com" };

// Foto e apelido no cartão do passaporte (página inicial), quando a pessoa definiu no perfil.
function renderPassportIdentity(profile) {
  const nickname = profile?.nickname || "";
  $("participantAvatar").replaceChildren(avatarNode(nickname || state.participantName, profile?.photoUrl ?? null));
  $("participantNickname").textContent = nickname ? `@${nickname}` : ""; $("participantNickname").hidden = !nickname;
}

async function loadPassportIdentity() {
  const generation = state.generation;
  try {
    const token = await accessToken();
    const data = await request(profilePath, { token });
    if (generation !== state.generation || !data?.profile) return;
    renderPassportIdentity(data.profile);
  } catch { /* Sem perfil, o cartão fica com as iniciais. */ }
}

function fillProfile(data) {
  const p = data.profile;
  $("profileOfficialName").textContent = data.name;
  $("profileNickname").value = p.nickname ?? ""; $("profileShowNickname").checked = p.showNickname !== false;
  $("profilePublic").checked = p.publicProfile !== false;
  $("profileHeadline").value = p.headline ?? ""; $("profileBio").value = p.bio ?? ""; $("profileCourse").value = p.course ?? "";
  $("profilePeriod").value = p.period ?? ""; $("profileLinkedin").value = p.links?.linkedin ?? ""; $("profileGithub").value = p.links?.github ?? "";
  profileBioCount(); renderProfilePhoto(p.photoUrl ?? null); renderPassportIdentity(p);
}

function renderProfilePhoto(url) {
  profileState.photoUrl = url;
  $("profileAvatar").replaceChildren(avatarNode($("profileNickname").value || $("profileOfficialName").textContent, url, "avatar avatar-large"));
  $("profilePhotoRemove").hidden = !url;
}

function profileBioCount() { $("profileBioCount").textContent = `${$("profileBio").value.length} / 160 caracteres`; }

async function loadProfile() {
  if (!state.session || !faqState.ready) return;
  const version = ++profileState.version;
  message("profileMessage", "Carregando seu perfil...");
  try {
    const token = await accessToken();
    if (version !== profileState.version) return;
    const data = await request(profilePath, { token });
    if (version !== profileState.version) return;
    if (typeof data?.name !== "string" || !data.profile) throw Error();
    fillProfile(data); profileState.loaded = true; $("profileForm").hidden = false;
    message("profileMessage", "");
  } catch {
    if (version === profileState.version) message("profileMessage", "Não foi possível carregar seu perfil. Tente novamente.", true);
  }
}

function readProfile() {
  const nickname = $("profileNickname").value.trim().replace(/^@/, "").toLowerCase();
  if (nickname && !/^[a-z0-9_.]{3,20}$/.test(nickname)) throw Error("Apelido: de 3 a 20 caracteres, só letras minúsculas, números, ponto e sublinhado.");
  const links = {};
  for (const [key, field] of [["linkedin", "profileLinkedin"], ["github", "profileGithub"]]) {
    const url = editorLink($(field).value); if (!url) continue;
    let valid = false; try { const u = new URL(url); valid = u.protocol === "https:" && !u.username && !u.password &&
      (u.hostname === profileLinkHosts[key] || u.hostname.endsWith("." + profileLinkHosts[key])); } catch {}
    if (!valid) throw Error(`O link do ${key === "linkedin" ? "LinkedIn" : "GitHub"} precisa ser um endereço https do ${profileLinkHosts[key]}.`);
    $(field).value = url; links[key] = url;
  }
  return { nickname: nickname || null, showNickname: $("profileShowNickname").checked, headline: $("profileHeadline").value.trim(),
    bio: $("profileBio").value.trim(), course: $("profileCourse").value.trim(), period: $("profilePeriod").value, links,
    publicProfile: $("profilePublic").checked };
}

async function saveProfile(event) {
  event.preventDefault();
  if (profileState.busy || !state.session) return;
  let input; try { input = readProfile(); } catch (error) { message("profileMessage", error.message, true); return; }
  const version = profileState.version;
  profileState.busy = true; $("profileSave").disabled = true; message("profileMessage", "Salvando...");
  try {
    const token = await accessToken();
    const data = await request(profilePath, { method: "POST", token, body: input });
    if (version !== profileState.version) return;
    fillProfile(data); message("profileMessage", "Perfil salvo! ✨");
  } catch (error) {
    if (version !== profileState.version) return;
    message("profileMessage", error.status === 409 ? "Esse apelido já está em uso. Escolha outro."
      : error.status === 400 ? "Confira os campos antes de salvar." : "Não foi possível salvar. Tente novamente.", true);
  } finally { if (version === profileState.version) { profileState.busy = false; $("profileSave").disabled = false; } }
}

async function uploadProfilePhoto(blob) {
  const token = await accessToken();
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${SUPABASE_URL}${profilePath}/photo`, { method: "PUT", body: blob, signal: controller.signal,
      credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": blob.type || "application/octet-stream" } });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(Error(), { status: response.status });
    return data;
  } finally { clearTimeout(timer); }
}

async function changeProfilePhoto(file) {
  if (profileState.busy || !state.session) return;
  const version = profileState.version;
  profileState.busy = true; message("profileMessage", "Enviando foto...");
  try {
    const blob = await prepareAvatar(file);
    const data = await uploadProfilePhoto(blob);
    if (version !== profileState.version) return;
    renderProfilePhoto(data?.photoUrl ?? null); message("profileMessage", "Foto atualizada! 📸"); loadPassportIdentity();
  } catch (error) {
    if (version !== profileState.version) return;
    message("profileMessage", error.status === 413 ? "Foto muito grande mesmo depois de reduzida. Tente outra."
      : error.status === 400 ? "Esse arquivo não é uma imagem válida." : error.message || "Não foi possível enviar a foto.", true);
  } finally { if (version === profileState.version) { profileState.busy = false; $("profilePhotoInput").value = ""; } }
}

async function removeProfilePhoto() {
  if (profileState.busy || !state.session || !confirm("Remover sua foto de perfil?")) return;
  const version = profileState.version;
  profileState.busy = true;
  try {
    const token = await accessToken();
    await request(`${profilePath}/photo`, { method: "DELETE", token });
    if (version !== profileState.version) return;
    renderProfilePhoto(null); message("profileMessage", "Foto removida."); loadPassportIdentity();
  } catch { if (version === profileState.version) message("profileMessage", "Não foi possível remover a foto.", true); }
  finally { if (version === profileState.version) profileState.busy = false; }
}

function resetProfile() {
  profileState.version++; Object.assign(profileState, { loaded:false, busy:false, photoUrl:null });
  $("profileForm").hidden = true; $("profileOfficialName").textContent = ""; $("profileAvatar").replaceChildren();
  for (const id of ["profileNickname","profileHeadline","profileBio","profileCourse","profileLinkedin","profileGithub"]) $(id).value = "";
  $("profilePeriod").value = ""; $("profileShowNickname").checked = true; $("profilePublic").checked = true; message("profileMessage", "");
}

$("profileForm").addEventListener("submit", saveProfile);
$("profileBio").addEventListener("input", profileBioCount);
$("profilePhotoInput").addEventListener("change", () => { const file = $("profilePhotoInput").files?.[0]; if (file) changeProfilePhoto(file); });
$("profilePhotoRemove").addEventListener("click", removeProfilePhoto);
