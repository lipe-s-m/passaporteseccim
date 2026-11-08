// Passaporte: progresso, selos, modal da palestra, link de inscrição e carga dos dados públicos e privados.

function updateProgress(privateLoaded = false) {
  const total = state.badges.length;
  const earned = state.badges.filter(b => b.earned).length;
  const percent = total ? Math.round(earned / total * 100) : 0;
  $("progressPercent").textContent = privateLoaded ? `${percent}%` : "—";
  $("progressBar").style.width = `${privateLoaded ? percent : 0}%`;
  $("progressTrack").setAttribute("aria-valuenow", String(privateLoaded ? percent : 0));
  $("progressCount").textContent = privateLoaded
    ? text("progress_count", "{earned} de {total} selos", { earned, total })
    : text("login_to_progress", "Entre para consultar seu progresso.");
  $("collectionMeta").textContent = privateLoaded
    ? text("collection_count", "{earned} / {total} DESBLOQUEADOS", { earned, total })
    : text("catalog_count", "{total} ATIVIDADES", { total });
}

// Selos agrupados por dia, como missões: cada dia mostra quantos selos a pessoa já tem.
function renderBadges(privateLoaded = false) {
  const days = new Map();
  state.badges.forEach((badge, index) => {
    const key = badge.event_date ?? "";
    days.set(key, [...(days.get(key) ?? []), [badge, index]]);
  });
  let order = 0;
  $("badgeGrid").replaceChildren(...[...days.entries()].sort(([a], [b]) => (a || "9999").localeCompare(b || "9999")).map(([date, list]) => {
    const done = list.filter(([badge]) => badge.earned).length, complete = privateLoaded && done === list.length;
    const section = document.createElement("section"); section.className = complete ? "badge-day complete" : "badge-day";
    const head = document.createElement("header"); head.className = "badge-day-head";
    const title = document.createElement("h3"); title.textContent = date ? dayLabel(date) : "Outras atividades";
    const count = document.createElement("span"); count.className = "badge-day-count";
    count.textContent = complete ? "✓ Dia completo" : privateLoaded ? `${done} / ${list.length}` : `${list.length} ${list.length === 1 ? "atividade" : "atividades"}`;
    head.append(title, count);
    const grid = document.createElement("div"); grid.className = "badge-grid";
    grid.append(...list.map(([badge, index]) => badgeCard(badge, index, privateLoaded, order++)));
    section.append(head, grid);
    return section;
  }));
  updateProgress(privateLoaded);
  renderGame(privateLoaded);
}
function badgeCard(badge, index, privateLoaded, order) {
  const theme = badgeTheme(badge.category), earned = privateLoaded && badge.earned;
  const card = document.createElement("article");
  card.className = `badge-card tone-${theme.tone} ${earned ? "earned" : "locked"}${earned && badge.fresh ? " fresh" : ""}`;
  card.style.animationDelay = `${Math.min(order, 12) * 35}ms`;
  const status = !privateLoaded ? text("status_login", "Entre para consultar")
    : badge.earned ? text("status_earned", "CONQUISTADO") : text("status_locked", "BLOQUEADO");
  const detailsButton = document.createElement("button");
  detailsButton.type = "button"; detailsButton.className = "badge-card-trigger";
  detailsButton.setAttribute("aria-label", `${badge.name}. ${status}. Abrir resumo do selo.`);
  // Emblema com o ícone da área; conteúdo remoto sempre por textContent.
  const art = document.createElement("div"); art.className = "badge-emblem"; art.setAttribute("aria-hidden", "true");
  const icon = document.createElement("span"); icon.className = "badge-icon"; icon.textContent = theme.icon;
  const mark = document.createElement("span"); mark.className = "badge-mark"; mark.textContent = earned ? "✓" : "🔒";
  art.append(icon, mark);
  const title = document.createElement("h3");
  title.textContent = badge.name;
  const foot = document.createElement("div");
  foot.className = "badge-foot";
  const category = document.createElement("span");
  category.textContent = badge.category;
  const label = document.createElement("strong");
  label.textContent = status;
  foot.append(category, label);
  detailsButton.append(art, title, foot);
  detailsButton.addEventListener("click", () => openBadge(index, privateLoaded));
  const more = document.createElement("a"); more.className = "badge-more"; more.href = `palestra.html?id=${encodeURIComponent(badge.id)}`; more.textContent = "Saiba mais →";
  more.setAttribute("aria-label", `Saiba mais sobre ${badge.name}`);
  card.append(detailsButton, more);
  return card;
}

// Formulário oficial de inscrição (Google Forms). O link abre com nome, e-mail e a palestra
// marcados; CPF e matrícula a pessoa digita no próprio formulário e o passaporte não guarda.
// Os textos das opções precisam ser idênticos aos do formulário, inclusive travessões e espaços.
const registrationForm = "https://docs.google.com/forms/d/e/1FAIpQLSeUgomV8-PWdPO460JppqLMC3wEoqa-dJcnX9T7KOm7lMLtdw/viewform";
const registrationFields = { name: "entry.157411751", email: "entry.1890638587" };
const registrationOptions = {
  "mesa-redonda": ["entry.303859995", "Mesa Redonda: Nossa Raíz, Nosso Futuro - 09:30"],
  "trabalhando-com-dados": ["entry.303859995", "Trabalhando com Dados nos dias atuais - 11:00"],
  "tecnologia-ia-oportunidades": ["entry.303859995", "Tecnologia, Inteligência Artificial e Oportunidades para o Futuro - 14:00"],
  "iniciacao-cientifica": ["entry.303859995", "Iniciação Científica - 15:20"],
  "linkedin-curriculo-entrevista": ["entry.303859995", "LinkedIn, currículo e entrevista: construindo sua jornada profissional - 16:00"],
  "da-rural-ao-canada": ["entry.1964417905", "Da Rural ao Canadá: construindo uma carreira internacional em tecnologia - 16:30"],
  "meninas-na-robotica": ["entry.1304510494", "Meninas na Robótica: descobrindo a tecnologia na prática – Sessão 1 - 09:30",
    "A Sessão 1 (09:30) vem marcada; troque para a Sessão 2 (11:00) no formulário se preferir."],
  "equipe-robotica-shield-nig": ["entry.1304510494", "SHIELD NIG: Popularizando a robótica e a tecnologia  - 14:00"],
  "sua-ideia-vale-uma-startup": ["entry.1304510494", "Sua ideia vale uma startup? - 16:00"],
  "visao-sobre-ai-gateway": ["entry.1304510494", "Uma visão sobre AI Gateway – LiteLLM - 18:00"],
  "ciencia-computacao-alem-software": ["entry.932672977", "Ciência da Computação além das empresas de software - 09:30"],
  "kafka-alem-das-filas": ["entry.932672977", "Kafka além das filas - 11:00"],
  "como-iniciar-em-ia-security": ["entry.932672977", "Como iniciar em IA Security - 14:00"],
  "como-e-desenvolver-um-jogo": ["entry.932672977", "Como é desenvolver um jogo? - 16:00"],
  "e-se-a-aws-fosse-um-jogo": ["entry.932672977", "E se a AWS fosse um jogo, por onde você começaria? - 18:00"]
};
// E-mail da conta só para preencher o formulário; a identidade continua sendo verificada no servidor.
function sessionEmail() {
  try {
    const payload = JSON.parse(atob(state.session.idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.email === "string" ? payload.email : "";
  } catch { return ""; }
}
function registrationUrl(activityId) {
  const params = new URLSearchParams({ usp: "pp_url" });
  const option = registrationOptions[activityId];
  if (option) params.append(option[0], option[1]);
  if (state.session && state.participantName) params.append(registrationFields.name, state.participantName);
  const email = state.session ? sessionEmail() : "";
  if (email) params.append(registrationFields.email, email);
  return `${registrationForm}?${params}`;
}

function openBadge(index, privateLoaded) {
  const badge = state.badges[index];
  if (!badge) return;
  state.focus = document.activeElement;
  $("modalTitle").textContent = badge.name;
  $("modalDescription").textContent = badge.description;
  $("modalCategory").textContent = badge.category;
  $("modalStatus").textContent = !privateLoaded ? text("status_login", "Entre para consultar")
    : badge.earned ? text("status_earned", "CONQUISTADO") : text("status_locked", "BLOQUEADO");
  $("modalStatus").classList.toggle("locked-status", !badge.earned);
  const theme = badgeTheme(badge.category);
  $("modalEmblem").className = `badge-emblem modal-emblem tone-${theme.tone} ${privateLoaded && badge.earned ? "earned" : "locked"}`;
  $("modalEmblem").textContent = theme.icon;
  const signedIn = !!(state.session && state.participantName);
  $("registrationLink").href = registrationUrl(badge.id);
  $("registrationLink").textContent = registrationOptions[badge.id] ? "Inscrever-se nesta palestra" : "Link para inscrição";
  $("registrationHint").textContent = [signedIn
    ? "O formulário abre com seu nome, e-mail e esta palestra marcados. Confira, informe CPF e matrícula (se for aluno da UFRRJ) e toque em Enviar."
    : "O formulário abre com esta palestra marcada. Preencha seus dados, incluindo CPF e matrícula (se for aluno da UFRRJ), e toque em Enviar.",
    registrationOptions[badge.id]?.[2] ?? ""].filter(Boolean).join(" ");
  $("modalBackdrop").classList.add("open");
  $("pageContent").inert = true;
  document.body.style.overflow = "hidden";
  $("modalClose").focus();
}

function closeModal() {
  $("modalBackdrop").classList.remove("open");
  $("pageContent").inert = false;
  document.body.style.overflow = "";
  if (state.focus?.isConnected) state.focus.focus();
  state.focus = null;
}

function clearPassport() {
  rankingState.version++;
  $("rankingPanel").hidden = true;
  $("rankingList").replaceChildren();
  $("rankingSummary").textContent = "";
  $("rankingRefresh").disabled = false;
  message("rankingMessage", "");
  closeMyQr();
  resetProfile();
  resetFeedback();
  resetPeople();
  $("profilePanel").hidden = true;
  resetFaq();
  resetAdmin();
  closeModal();
  $("pageTabs").hidden = true;
  $("passportPanel").hidden = true;
  $("faqPanel").hidden = true;
  $("participantName").textContent = text("participant_guest", "Participante");
  state.participantName = ""; state.participantId = "";
  $("participantAvatar").replaceChildren(); $("participantNickname").hidden = true; $("participantNickname").textContent = "";
  $("connectionStatus").textContent = text("session_signed_out", "NÃO CONECTADO");
  $("logoutButton").hidden = true;
  $("refreshButton").hidden = true;
  $("authSection").hidden = false;
  $("authForm").hidden = false;
  $("authModes").hidden = false;
  $("verificationPanel").hidden = true;
  setAuthMode(state.mode);
  state.badges.forEach(b => { b.earned = false; b.fresh = false; });
  $("badgeGrid").replaceChildren();
  updateProgress();
  renderGame(false); hideToast();
}

async function loadPassport() {
  const generation = state.generation;
  try {
    message("pageMessage", text("loading_passport", "Carregando seu passaporte..."));
    const token = await accessToken();
    // A função valida o token no Google e decide a identidade no servidor.
    const data = await request("/functions/v1/passport", { token });
    if (generation !== state.generation) return;
    if (!data?.participant?.id || !data.participant.full_name || !Array.isArray(data.earnedBadges)) {
      throw new Error("Cadastro não disponível.");
    }
    const earned = new Set(data.earnedBadges);
    state.badges.forEach(b => { b.earned = earned.has(b.id); });
    markNewBadges(data.participant.id);
    $("participantName").textContent = data.participant.full_name;
    state.participantName = data.participant.full_name;
    state.participantId = data.participant.id;
    renderPassportIdentity(null);
    loadPassportIdentity();
    loadFeedback();
    $("connectionStatus").textContent = text("session_signed_in", "CONECTADO");
    $("authSection").hidden = true;
    $("logoutButton").hidden = false;
    $("refreshButton").hidden = false;
    renderBadges(true);
    faqState.ready = true;
    $("pageTabs").hidden = false;
    switchSection(false);
    $("retryButton").hidden = true;
    populateFaqActivities();
    if (!$("faqPanel").hidden) loadQuestions();
    // Só contas autorizadas no banco recebem 200; as demais seguem sem a aba.
    loadAdmin();
    message("pageMessage", "");
    message("authMessage", "");
  } catch (error) {
    if (generation !== state.generation) return;
    if (error.status === 403 && error.code === "EMAIL_NOT_VERIFIED") {
      showVerification();
      return;
    }
    if (error.status === 401) { state.generation++; forgetSession(); }
    clearPassport();
    if (state.session) {
      $("authSection").hidden = true;
      $("retryButton").hidden = false;
      $("logoutButton").hidden = false;
    }
    message("pageMessage", text("passport_error", "Não foi possível consultar o passaporte. Tente atualizar ou entre novamente."), true);
  }
}

async function loadPublicContent() {
  if (state.session) $("authSection").hidden = true;
  if (!configured()) {
    state.publicReady = false;
    setAuthBusy(false);
    message("pageMessage", "O passaporte ainda não está disponível. Tente novamente mais tarde.", true);
    return;
  }
  $("retryButton").hidden = true;
  try {
    const [copy, activities] = await Promise.all([
      request("/rest/v1/site_content?select=key,value"),
      request("/rest/v1/activities?select=id,name,description,short_description,category,event_date,speaker_name,speaker_photo_url,speaker_bio,starts_at,ends_at,speaker_socials,slides_url&order=sort_order.asc,id.asc").catch(() =>
        request("/rest/v1/activities?select=id,name,description,category,event_date&order=sort_order.asc,id.asc"))
    ]);
    if (!Array.isArray(copy) || !Array.isArray(activities)) throw new Error("Conteúdo inválido.");
    state.copy = Object.fromEntries(copy.map(row => [row.key, row.value]));
    state.badges = activities.map(row => ({ ...row, earned: false }));
    populateFaqActivities();
    state.publicReady = true;
    applyCopy();
    setAuthMode(state.mode);
    if (state.session) await loadPassport();
    else {
      clearPassport();
      message("pageMessage", activities.length ? "" : text("empty_catalog", "A programação será publicada em breve."));
    }
  } catch (error) {
    state.publicReady = false;
    $("retryButton").hidden = false;
    setAuthBusy(false);
    message("pageMessage", "Não foi possível carregar o conteúdo. Tente novamente.", true);
  }
}

$("retryButton").addEventListener("click", loadPublicContent);
$("refreshButton").addEventListener("click", async () => {
  $("refreshButton").disabled = true;
  try { await loadPublicContent(); } finally { $("refreshButton").disabled = false; }
});
$("modalClose").addEventListener("click", closeModal);
$("modalBackdrop").addEventListener("click", event => {
  if (event.target === $("modalBackdrop")) closeModal();
});
