// Pesquisa de satisfação: nota e comentário das palestras que a pessoa assistiu.
const feedbackPath = "/functions/v1/passport/feedback";
const feedbackState = { version:0, items:[], open:null, rating:0, comment:"", busy:false, form:null };
const feedbackStars = n => "★".repeat(n) + "☆".repeat(5 - n);

function resetFeedback() {
  feedbackState.version++;
  Object.assign(feedbackState, { items:[], open:null, rating:0, comment:"", busy:false, form:null });
  $("feedbackCard").hidden = true; $("feedbackList").replaceChildren(); $("feedbackSummary").textContent = "";
  message("feedbackMessage", "");
}

// Só aparece para quem tem presença registrada; sem presença, o cartão fica escondido.
async function loadFeedback() {
  const version = ++feedbackState.version;
  try {
    const data = await request(feedbackPath, { token: await accessToken() });
    if (version !== feedbackState.version) return;
    if (!Array.isArray(data?.items)) throw Error();
    feedbackState.items = data.items;
    renderFeedback();
  } catch { if (version === feedbackState.version) $("feedbackCard").hidden = true; }
}

function renderFeedback() {
  const items = feedbackState.items, done = items.filter(i => i.rating).length;
  $("feedbackCard").hidden = !items.length;
  $("feedbackSummary").textContent = done === items.length
    ? (items.length === 1 ? "Você já avaliou a palestra que assistiu. Obrigado!" : `Você já avaliou as ${items.length} palestras que assistiu. Obrigado!`)
    : `Você assistiu ${items.length === 1 ? "1 palestra" : `${items.length} palestras`} e avaliou ${done}. Conte o que achou!`;
  feedbackState.form = null;
  $("feedbackList").replaceChildren(...items.map(item => {
    const row = document.createElement("li"); row.className = "feedback-item";
    const head = document.createElement("div"); head.className = "feedback-head";
    const info = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = item.name;
    const status = document.createElement("span");
    status.className = item.rating ? "feedback-status" : "feedback-status pending";
    status.textContent = item.rating ? feedbackStars(item.rating) : "Ainda não avaliada";
    if (item.rating) status.setAttribute("aria-label", `Sua nota: ${item.rating} de 5`);
    info.append(name, status);
    const open = feedbackState.open === item.activityId;
    const button = document.createElement("button"); button.type = "button"; button.className = "action-button secondary";
    button.textContent = open ? "Fechar" : item.rating ? "Editar" : "Avaliar";
    button.setAttribute("aria-expanded", String(open));
    button.addEventListener("click", () => openFeedback(open ? null : item.activityId));
    head.append(info, button); row.append(head);
    if (open) row.append(feedbackForm(item));
    return row;
  }));
}

function openFeedback(activityId) {
  const item = feedbackState.items.find(i => i.activityId === activityId);
  feedbackState.open = item ? activityId : null;
  feedbackState.rating = item?.rating ?? 0; feedbackState.comment = item?.comment ?? "";
  message("feedbackMessage", "");
  renderFeedback();
  feedbackState.form?.stars[Math.max(feedbackState.rating, 1) - 1].focus();
}

function feedbackForm(item) {
  const form = document.createElement("div"); form.className = "feedback-form";
  const label = document.createElement("p"); label.className = "feedback-label"; label.textContent = "Sua nota";
  label.id = `feedback-label-${item.activityId}`;
  const group = document.createElement("div"); group.className = "feedback-stars";
  group.setAttribute("role", "group"); group.setAttribute("aria-labelledby", label.id);
  const stars = [1, 2, 3, 4, 5].map(n => {
    const star = document.createElement("button"); star.type = "button"; star.className = "feedback-star";
    star.setAttribute("aria-label", `${n} de 5`);
    star.addEventListener("click", () => { feedbackState.rating = n; paint(); });
    return star;
  });
  const paint = () => stars.forEach((star, i) => {
    star.textContent = i < feedbackState.rating ? "★" : "☆"; star.setAttribute("aria-pressed", String(i + 1 === feedbackState.rating));
  });
  paint(); group.append(...stars);
  const field = document.createElement("label"); field.className = "faq-field"; field.textContent = "Comentário (opcional)";
  const area = document.createElement("textarea"); area.maxLength = 1000; area.value = feedbackState.comment;
  const count = document.createElement("small"); count.className = "faq-hint";
  const counter = () => { count.textContent = `${area.value.length} / 1000 caracteres`; };
  area.addEventListener("input", () => { feedbackState.comment = area.value; counter(); });
  counter(); field.append(area, count);
  const actions = document.createElement("div"); actions.className = "collection-actions";
  const save = document.createElement("button"); save.type = "button"; save.className = "action-button";
  save.textContent = item.rating ? "Atualizar avaliação" : "Enviar avaliação"; save.disabled = feedbackState.busy;
  save.addEventListener("click", saveFeedback);
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "action-button secondary"; cancel.textContent = "Cancelar";
  cancel.addEventListener("click", () => openFeedback(null));
  actions.append(save, cancel);
  form.append(label, group, field, actions);
  feedbackState.form = { stars, area, save };
  return form;
}

async function saveFeedback() {
  const activity = feedbackState.open;
  if (!activity || feedbackState.busy) return;
  if (!feedbackState.rating) { message("feedbackMessage", "Escolha uma nota de 1 a 5 estrelas.", true); return; }
  const version = feedbackState.version;
  feedbackState.busy = true; if (feedbackState.form) feedbackState.form.save.disabled = true;
  message("feedbackMessage", "Enviando...");
  try {
    const data = await request(feedbackPath, { method: "POST", token: await accessToken(),
      body: { activity, rating: feedbackState.rating, comment: feedbackState.comment.trim() } });
    if (version !== feedbackState.version) return;
    if (!Array.isArray(data?.items)) throw Error();
    feedbackState.items = data.items; feedbackState.open = null;
    renderFeedback();
    message("feedbackMessage", "Obrigado! Sua avaliação foi enviada.");
  } catch (error) {
    if (version !== feedbackState.version) return;
    message("feedbackMessage", error.status === 403 ? "Só quem teve a presença registrada nesta palestra pode avaliá-la."
      : "Não foi possível enviar a avaliação. Tente novamente.", true);
  } finally {
    if (version === feedbackState.version) { feedbackState.busy = false; if (feedbackState.form) feedbackState.form.save.disabled = false; }
  }
}
