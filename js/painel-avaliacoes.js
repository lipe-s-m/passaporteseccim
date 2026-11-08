// Painel: resultado da pesquisa de satisfação, sem o nome de quem respondeu.
const feedbackAdminState = { version:0, data:null };

function resetFeedbackAdmin() {
  feedbackAdminState.version++; feedbackAdminState.data = null;
  for (const id of ["feedbackSummaryList", "feedbackComments", "feedbackActivity"]) $(id).replaceChildren();
  $("feedbackCommentsHint").textContent = ""; $("feedbackExport").disabled = true; message("feedbackAdminMessage", "");
}

async function loadFeedbackAdmin() {
  const version = ++feedbackAdminState.version;
  message("feedbackAdminMessage", "Carregando avaliações...");
  try {
    const data = await request("/functions/v1/passport/admin/feedback", { token: await accessToken() });
    if (version !== feedbackAdminState.version) return;
    if (!Array.isArray(data?.activities) || !Array.isArray(data.responses)) throw Error();
    feedbackAdminState.data = data;
    renderFeedbackAdmin();
    message("feedbackAdminMessage", data.responses.length ? "" : "Ainda não há avaliações.");
  } catch { if (version === feedbackAdminState.version) message("feedbackAdminMessage", "Não foi possível carregar as avaliações.", true); }
}

function renderFeedbackAdmin() {
  const { activities, responses } = feedbackAdminState.data;
  const decimal = n => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  $("feedbackSummaryList").replaceChildren(...activities.map(a => {
    const row = document.createElement("li"); row.className = "admin-row";
    const info = document.createElement("div"); info.className = "admin-person";
    const name = document.createElement("strong"); name.textContent = a.name;
    const detail = document.createElement("small");
    detail.textContent = a.responses && a.average !== null
      ? `★ ${decimal(a.average)} · ${a.responses} de ${a.attendances} presentes avaliaram` : `Sem avaliações · ${a.attendances} presentes`;
    info.append(name, detail);
    if (a.responses) {
      // Espaço sem quebra entre a estrela e a contagem, para "5★ 13" não se separar no celular.
      const spread = document.createElement("small");
      spread.textContent = a.distribution.map((c, i) => `${i + 1}★\u00a0${c}`).reverse().join(" · ");
      info.append(spread);
    }
    row.append(info);
    return row;
  }));
  const current = $("feedbackActivity").value;
  const all = document.createElement("option"); all.value = ""; all.textContent = `Todas as palestras (${responses.length})`;
  $("feedbackActivity").replaceChildren(all, ...activities.filter(a => a.responses).map(a => {
    const option = document.createElement("option"); option.value = a.id; option.textContent = `${a.name} (${a.responses})`;
    return option;
  }));
  $("feedbackActivity").value = activities.some(a => a.id === current && a.responses) ? current : "";
  $("feedbackExport").disabled = !responses.length;
  renderFeedbackComments();
}

function renderFeedbackComments() {
  const data = feedbackAdminState.data;
  if (!data) return;
  const id = $("feedbackActivity").value;
  const names = new Map(data.activities.map(a => [a.id, a.name]));
  const chosen = data.responses.filter(r => !id || r.activityId === id);
  const withComment = chosen.filter(r => r.comment);
  $("feedbackComments").replaceChildren(...withComment.map(r => {
    const row = document.createElement("li"); row.className = "admin-row";
    const info = document.createElement("div"); info.className = "admin-person";
    const head = document.createElement("strong");
    head.textContent = `${feedbackStars(r.rating)}${id ? "" : ` · ${names.get(r.activityId) ?? r.activityId}`}`;
    const body = document.createElement("p"); body.className = "faq-question"; body.textContent = r.comment;
    const when = document.createElement("small"); when.textContent = r.date ? `Enviado em ${shortDate(r.date)}` : "";
    info.append(head, body, when); row.append(info);
    return row;
  }));
  const onlyRating = chosen.length - withComment.length;
  $("feedbackCommentsHint").textContent = chosen.length
    ? `${withComment.length} com comentário${onlyRating ? ` e ${onlyRating} só com nota` : ""}.` : "";
}

// Planilhas executam células que começam com = + - @: o apóstrofo mantém o conteúdo como texto.
function csvCell(value) {
  let cell = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(cell)) cell = "'" + cell;
  return `"${cell.replace(/"/g, '""')}"`;
}

function exportFeedback() {
  const data = feedbackAdminState.data;
  if (!data?.responses.length) return;
  const activities = new Map(data.activities.map(a => [a.id, a]));
  const rows = [["Palestra", "Dia da palestra", "Nota", "Comentário", "Dia da resposta"],
    ...data.responses.map(r => [activities.get(r.activityId)?.name ?? r.activityId, activities.get(r.activityId)?.eventDate ?? "",
      r.rating, r.comment, r.date ?? ""])];
  // BOM e ponto e vírgula: o Excel em português abre com acentos e colunas certas.
  download("pesquisa-satisfacao.csv", "\ufeff" + rows.map(row => row.map(csvCell).join(";")).join("\r\n") + "\r\n", "text/csv;charset=utf-8");
  message("feedbackAdminMessage", `${data.responses.length} respostas baixadas em CSV.`);
}

$("feedbackSection").addEventListener("toggle", () => { if ($("feedbackSection").open && !feedbackAdminState.data) loadFeedbackAdmin(); });
$("feedbackRefresh").addEventListener("click", loadFeedbackAdmin);
$("feedbackExport").addEventListener("click", exportFeedback);
$("feedbackActivity").addEventListener("change", renderFeedbackComments);
