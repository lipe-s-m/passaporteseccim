// FAQ das palestras: perguntas, respostas e moderação pela organização.
const faqState = { ready:false, version:0, questions:[], editing:null, busy:false };
function resetFaqForm() {
  faqState.editing = null;
  $("faqBody").value = "";
  $("faqAnonymous").checked = false;
  $("faqFormTitle").textContent = "Faça sua pergunta";
  $("faqSave").textContent = "Enviar pergunta";
  $("faqCancel").hidden = true;
}

function resetFaq() {
  faqState.ready = false;
  faqState.version++;
  faqState.questions = [];
  faqState.busy = false;
  for (const id of ["faqSave","faqCancel","faqActivity","faqRefresh","faqMore","faqBody","faqAnonymous"]) $(id).disabled = false;
  resetFaqForm();
  $("faqList").replaceChildren();
  $("faqActivityHead").hidden = true; $("faqActivityHead").replaceChildren();
  $("faqForm").hidden = true;
  $("faqRefresh").hidden = true;
  $("faqMore").hidden = true;
  $("faqLogin").hidden = false;
  message("faqMessage", "");
}

function populateFaqActivities() {
  const selected = $("faqActivity").value;
  $("faqActivity").replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = ""; placeholder.textContent = "Selecione uma atividade";
  $("faqActivity").append(placeholder);
  state.badges.forEach(b => {
    const option = document.createElement("option"); option.value = b.id; option.textContent = b.name;
    $("faqActivity").append(option);
  });
  $("faqActivity").value = state.badges.some(b => b.id === selected) ? selected : "";
  $("faqLogin").hidden = faqState.ready;
}

function renderQuestions() {
  $("faqList").replaceChildren();
  faqState.questions.forEach((q, index) => {
    const card = document.createElement("article"); card.className = q.mine ? "faq-card faq-question-card mine" : "faq-card faq-question-card";
    card.style.animationDelay = `${Math.min(index, 12) * 35}ms`;
    // Autor com avatar de iniciais (ou "?" para anônimo), data e marcação de edição.
    const meta = document.createElement("div"); meta.className = "faq-author";
    const name = q.anonymous ? "Anônimo" : q.author;
    const avatar = avatarNode(q.anonymous ? "?" : name, null); if (q.anonymous) avatar.classList.add("anon");
    const who = document.createElement("div");
    const author = document.createElement("strong"); author.textContent = name + (q.mine ? " · Você" : "");
    const date = new Date(q.createdAt);
    const when = document.createElement("small");
    when.textContent = `${Number.isNaN(date.getTime()) ? "" : date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}${q.updatedAt !== q.createdAt ? " · Editada" : ""}`;
    who.append(author, when); meta.append(avatar, who);
    const body = document.createElement("p"); body.className = "faq-question"; body.textContent = q.body;
    card.append(meta,body);
    if (q.mine) {
      const actions = document.createElement("div"); actions.className = "faq-controls";
      const edit = document.createElement("button"); edit.type = "button"; edit.className = "action-button secondary"; edit.textContent = "Editar"; edit.disabled = faqState.busy;
      edit.addEventListener("click", () => {
        faqState.editing = q.id; $("faqBody").value = q.body; $("faqAnonymous").checked = q.anonymous;
        $("faqFormTitle").textContent = "Editar sua pergunta"; $("faqSave").textContent = "Salvar alterações";
        $("faqCancel").hidden = false; $("faqBody").focus();
      });
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "action-button secondary danger"; remove.textContent = "Excluir"; remove.disabled = faqState.busy;
      remove.addEventListener("click", () => { if (confirm("Excluir esta pergunta? Esta ação não pode ser desfeita.")) mutateQuestion("DELETE", {id:q.id}); });
      actions.append(edit,remove); card.append(actions);
    }
    $("faqList").append(card);
  });
  renderFaqActivityHead();
}
// Medalha e nome da atividade escolhida, com a contagem de perguntas carregadas.
function renderFaqActivityHead() {
  const activity = state.badges.find(b => b.id === $("faqActivity").value);
  $("faqActivityHead").hidden = !activity;
  if (!activity) { $("faqActivityHead").replaceChildren(); return; }
  const info = document.createElement("div");
  const name = Object.assign(document.createElement("strong"), { textContent: activity.name });
  const count = faqState.questions.length;
  const detail = Object.assign(document.createElement("small"), { textContent: `${activity.category ? `${activity.category} · ` : ""}${count}${faqState.hasMore ? "+" : ""} ${count === 1 ? "pergunta" : "perguntas"}` });
  info.append(name, detail);
  $("faqActivityHead").replaceChildren(miniEmblem(activity.category), info);
}

async function loadQuestions(append = false) {
  const version = ++faqState.version;
  const activity = $("faqActivity").value;
  const ready = faqState.ready && !!state.session;
  $("faqLogin").hidden = ready;
  $("faqForm").hidden = !ready || !activity;
  $("faqRefresh").hidden = !ready || !activity;
  $("faqMore").hidden = true;
  if (!append) { faqState.questions = []; renderQuestions(); }
  if (!ready || !activity) { message("faqMessage", ready ? "Selecione uma atividade para ver as perguntas." : ""); return; }
  const offset = append ? faqState.questions.length : 0;
  message("faqMessage", "Carregando perguntas...");
  try {
    const token = await accessToken();
    if (version !== faqState.version) return;
    const data = await request(`/functions/v1/passport/questions?activity=${encodeURIComponent(activity)}&offset=${offset}`, {token});
    if (version !== faqState.version) return;
    if (!Array.isArray(data?.questions)) throw Error();
    faqState.questions = append ? [...faqState.questions, ...data.questions.filter(q => !faqState.questions.some(old => old.id === q.id))] : data.questions;
    faqState.hasMore = data.hasMore === true; renderQuestions(); $("faqMore").hidden = !data.hasMore;
    message("faqMessage", faqState.questions.length ? "" : "Ainda não há perguntas. Que tal enviar a primeira?");
  } catch {
    if (version === faqState.version) message("faqMessage", "Não foi possível carregar as perguntas. Tente atualizar ou entre novamente.", true);
  }
}

async function mutateQuestion(method, values) {
  if (faqState.busy || !faqState.ready || !state.session || !$("faqActivity").value) return;
  const version = ++faqState.version;
  const activity = $("faqActivity").value;
  faqState.busy = true;
  for (const id of ["faqSave","faqCancel","faqActivity","faqRefresh","faqMore","faqBody","faqAnonymous"]) $(id).disabled = true;
  renderQuestions();
  try {
    const token = await accessToken();
    if (version !== faqState.version) return;
    await request("/functions/v1/passport/questions", {method,token,body:{activity,...values}});
    if (version !== faqState.version) return;
    resetFaqForm();
    await loadQuestions();
  } catch {
    if (version === faqState.version) message("faqMessage", "Não foi possível salvar a alteração. Confira sua sessão e tente novamente.", true);
  } finally {
    faqState.busy = false;
    for (const id of ["faqSave","faqCancel","faqActivity","faqRefresh","faqMore","faqBody","faqAnonymous"]) $(id).disabled = false;
    renderQuestions();
  }
}

$("faqActivity").addEventListener("change", () => { resetFaqForm(); loadQuestions(); });
$("faqRefresh").addEventListener("click", () => loadQuestions());
$("faqMore").addEventListener("click", () => loadQuestions(true));
$("faqCancel").addEventListener("click", resetFaqForm);
$("faqForm").addEventListener("submit", event => {
  event.preventDefault();
  const body = $("faqBody").value.trim();
  if (!body || body.length > 2000) { message("faqMessage", "Escreva uma pergunta de até 2.000 caracteres.", true); return; }
  return mutateQuestion(faqState.editing ? "PATCH" : "POST", {id:faqState.editing,body,anonymous:$("faqAnonymous").checked});
});
