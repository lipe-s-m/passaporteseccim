// Painel: presenças por busca, em lote, cadastro na hora e várias palestras de uma vez.
const bulkAttendanceState = { version:0, busy:false };
const multiState = { version:0, person:null, saved:new Set(), checked:new Set(), busy:false };
const personPath = "/functions/v1/passport/admin/person";
function clearBulkAttendance() {
  bulkAttendanceState.version++; bulkAttendanceState.busy=false;
  $("bulkAttendanceEmails").value=""; $("bulkAttendanceEmails").disabled=true;
  $("bulkAttendanceSubmit").disabled=true; $("bulkAttendanceSubmit").textContent="Registrar presenças da lista";
  $("bulkAttendanceResults").hidden=true;
  for(const group of ["Missing","Invalid","Added","Present"]) {
    $(`bulkAttendance${group}Group`).hidden=true; $(`bulkAttendance${group}`).replaceChildren();
  }
  $("bulkAttendanceSummary").textContent=""; message("bulkAttendanceMessage","");
}

async function registerBulkAttendance(event) {
  event.preventDefault();
  const activity=$("adminActivity").value;
  const emails=$("bulkAttendanceEmails").value.split(/[\s,;]+/).map(email=>email.trim()).filter(Boolean);
  if(bulkAttendanceState.busy||!activity||!state.session)return;
  if(!emails.length){message("bulkAttendanceMessage","Cole pelo menos um e-mail.",true);return;}
  if(emails.length>100){message("bulkAttendanceMessage","O limite é de 100 e-mails por envio.",true);return;}
  const version=++bulkAttendanceState.version;
  bulkAttendanceState.busy=true; $("bulkAttendanceSubmit").disabled=true;
  message("bulkAttendanceMessage","Conferindo cadastro e registrando presenças...");
  try {
    const token=await accessToken();
    if(version!==bulkAttendanceState.version||!state.session)return;
    const data=await request("/functions/v1/passport/admin/attendance/bulk",{
      method:"POST",token,body:{activity,emails}
    });
    if(version!==bulkAttendanceState.version)return;
    for(const group of ["Missing","Invalid","Added","Present"]) {
      const key={Missing:"notFound",Invalid:"invalid",Added:"registered",Present:"alreadyPresent"}[group];
      const values=data[key]; if(!Array.isArray(values))throw Error();
      const list=$(`bulkAttendance${group}`);
      list.replaceChildren(...values.map(item=>{
        const row=document.createElement("li");row.className="admin-row";
        const label=document.createElement("span");label.className="admin-person";
        label.textContent=typeof item==="string"?item:`${item.name} · ${item.email}`;
        row.append(label);return row;
      }));
      $(`bulkAttendance${group}Group`).hidden=!values.length;
    }
    const counts=[`${data.registered.length} registrada(s)`,`${data.alreadyPresent.length} já presente(s)`,
      `${data.notFound.length} não encontrado(s)`,`${data.invalid.length} inválido(s)`];
    if(data.duplicatesIgnored)counts.push(`${data.duplicatesIgnored} e-mail(s) repetido(s) ignorado(s)`);
    $("bulkAttendanceSummary").textContent=counts.join(" · ");
    $("bulkAttendanceResults").hidden=false;
    $("bulkAttendanceEmails").value="";
    message("bulkAttendanceMessage","Lista processada. Confira os resultados acima.");
    loadAttendees();loadAdmin();
  }catch{
    if(version===bulkAttendanceState.version)message("bulkAttendanceMessage","Não foi possível processar a lista. Tente novamente.",true);
  }finally{
    if(version===bulkAttendanceState.version){bulkAttendanceState.busy=false;$("bulkAttendanceSubmit").disabled=!$("adminActivity").value;}
  }
}

$("bulkAttendanceForm").addEventListener("submit",registerBulkAttendance);

function adminRow(person, detail, button) {
  const row = document.createElement("li"); row.className = "admin-row" + (person.present ? " present" : "");
  const info = document.createElement("div"); info.className = "admin-person";
  const name = document.createElement("strong"); name.textContent = person.name;
  const small = document.createElement("small"); small.textContent = detail;
  info.append(name, small); row.append(info);
  if (person.present && button.add) {
    const status = document.createElement("span"); status.className = "admin-status"; status.textContent = "✓ Presente"; row.append(status);
  }
  const action = document.createElement("button"); action.type = "button";
  action.className = "action-button" + (button.add ? "" : " secondary");
  action.textContent = button.label; action.disabled = adminState.busy;
  action.addEventListener("click", () => setAttendance(person, button.add));
  row.append(action);
  return row;
}

async function searchParticipants() {
  const version = ++adminState.searchVersion;
  const query = $("adminSearch").value.trim();
  const activity = $("adminActivity").value;
  if (!activity || query.length < 2) {
    $("adminResults").replaceChildren();
    message("adminMessage", query && activity ? "Digite pelo menos 2 letras." : "");
    return;
  }
  message("adminMessage", "Buscando...");
  try {
    const token = await accessToken();
    if (version !== adminState.searchVersion) return;
    const data = await request(`${adminPath}?action=search&activity=${encodeURIComponent(activity)}&q=${encodeURIComponent(query)}`, { token });
    if (version !== adminState.searchVersion) return;
    if (!Array.isArray(data?.participants)) throw Error();
    $("adminResults").replaceChildren(...data.participants.map(p => {
      const row = adminRow(p, p.email, p.present ? { add: false, label: "Remover presença" } : { add: true, label: "Registrar presença" });
      const multi = document.createElement("button"); multi.type = "button"; multi.className = "action-button secondary";
      multi.textContent = "Várias palestras"; multi.disabled = adminState.busy;
      multi.addEventListener("click", () => openMulti(p, p.present ? [] : [activity]));
      row.append(multi);
      return row;
    }));
    message("adminMessage", data.participants.length ? ""
      : `Ninguém encontrado com “${query}”. Use “Cadastrar participante na hora” logo abaixo.`);
  } catch {
    if (version === adminState.searchVersion) message("adminMessage", "Não foi possível buscar. Confira sua sessão e tente novamente.", true);
  }
}

async function loadAttendees() {
  const version = ++adminState.listVersion;
  const activity = $("adminActivity").value;
  $("adminAttendees").replaceChildren();
  $("adminCount").textContent = "";
  if (!activity || !state.session) { message("adminListMessage", activity ? "" : "Selecione uma atividade."); return; }
  message("adminListMessage", "Carregando presenças...");
  try {
    const token = await accessToken();
    if (version !== adminState.listVersion) return;
    const data = await request(`${adminPath}?action=list&activity=${encodeURIComponent(activity)}`, { token });
    if (version !== adminState.listVersion) return;
    if (!Array.isArray(data?.attendees)) throw Error();
    $("adminAttendees").replaceChildren(...data.attendees.map(p => {
      const time = new Date(p.recordedAt);
      return adminRow({ ...p, present: true }, `${p.email}${Number.isNaN(time.getTime()) ? "" : " · " + time.toLocaleString("pt-BR")}`,
        { add: false, label: "Remover" });
    }));
    $("adminCount").textContent = `${data.total} ${data.total === 1 ? "PRESENTE" : "PRESENTES"}`;
    message("adminListMessage", !data.total ? "Nenhuma presença registrada nesta atividade."
      : data.total > data.attendees.length ? `Mostrando os ${data.attendees.length} registros mais recentes.` : "");
  } catch {
    if (version === adminState.listVersion) message("adminListMessage", "Não foi possível carregar as presenças.", true);
  }
}

async function setAttendance(person, add) {
  const activity = $("adminActivity").value;
  if (adminState.busy || !activity || !state.session) return;
  if (!add && !confirm(`Remover a presença de ${person.name} nesta atividade?`)) return;
  const version = adminState.version;
  adminState.busy = true;
  try {
    const token = await accessToken();
    const data = await request(adminPath, { method: add ? "POST" : "DELETE", token, body: { activity, participant: person.id } });
    if (version !== adminState.version) return;
    message("adminMessage", add ? (data?.changed ? `Presença registrada: ${person.name}` : `${person.name} já estava presente.`)
      : `Presença removida: ${person.name}`);
    if (add) { $("adminSearch").value = ""; $("adminResults").replaceChildren(); $("adminSearch").focus(); }
    else await searchParticipants();
  } catch {
    if (version === adminState.version) message("adminMessage", "Não foi possível salvar. Confira sua sessão e tente novamente.", true);
  } finally {
    if (version === adminState.version) {
      adminState.busy = false;
      loadAttendees(); loadAdmin();
    }
  }
}

function openWalkin() {
  // Aproveita o que foi digitado na busca: e-mail vai para o e-mail, o resto para o nome.
  const typed = $("adminSearch").value.trim();
  $("walkinName").value = typed.includes("@") ? "" : typed;
  $("walkinEmail").value = typed.includes("@") ? typed : "";
  $("walkinForm").hidden = false; $("walkinToggle").hidden = true;
  (typed && !typed.includes("@") ? $("walkinEmail") : $("walkinName")).focus();
}

function closeWalkin() {
  $("walkinForm").hidden = true; $("walkinToggle").hidden = false;
  $("walkinName").value = ""; $("walkinEmail").value = ""; $("walkinSave").disabled = false;
}

async function registerWalkin() {
  const activity = $("adminActivity").value;
  const name = $("walkinName").value.trim();
  const email = $("walkinEmail").value.trim().toLowerCase();
  if (adminState.busy || !activity || !state.session) return;
  if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    message("adminMessage", "Informe o nome completo e um e-mail válido.", true);
    return;
  }
  const version = adminState.version;
  adminState.busy = true; $("walkinSave").disabled = true;
  try {
    const token = await accessToken();
    const data = await request("/functions/v1/passport/admin/participants", { method: "POST", token, body: { activity, name, email } });
    if (version !== adminState.version) return;
    const person = data?.participant;
    if (!person?.name) throw Error();
    message("adminMessage", data.created ? `✨ Cadastro criado: ${person.name} está presente! O selo aparece quando criar a conta com ${person.email}.`
      : data.changed ? `✅ ${person.email} já tinha cadastro como ${person.name}. Presença registrada.`
      : `${person.name} já estava presente nesta atividade.`);
    closeWalkin();
    $("adminSearch").value = ""; $("adminResults").replaceChildren();
    // Quem chega sem conta costuma ter assistido a outras palestras do dia.
    openMulti(person);
  } catch {
    if (version === adminState.version) message("adminMessage", "Não foi possível cadastrar. Confira os dados e tente novamente.", true);
  } finally {
    if (version === adminState.version) {
      adminState.busy = false; $("walkinSave").disabled = false;
      loadAttendees(); loadAdmin();
    }
  }
}

function closeMulti() {
  multiState.version++; multiState.person = null; multiState.busy = false;
  multiState.saved = new Set(); multiState.checked = new Set();
  $("multiPanel").hidden = true; $("multiDays").replaceChildren(); $("multiSave").disabled = true;
  message("multiMessage", "");
}

function multiChanges() {
  return { add: [...multiState.checked].filter(id => !multiState.saved.has(id)),
    remove: [...multiState.saved].filter(id => !multiState.checked.has(id)) };
}

function renderMulti() {
  const days = new Map();
  for (const activity of adminState.activities) {
    const key = activity.eventDate ?? "";
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(activity);
  }
  $("multiDays").replaceChildren(...[...days.keys()].sort((a, b) => (a || "9999").localeCompare(b || "9999")).map(day => {
    const activities = days.get(day);
    const group = document.createElement("div"); group.className = "multi-day";
    const head = document.createElement("div"); head.className = "multi-day-head";
    const title = document.createElement("strong"); title.textContent = day ? dayLabel(day) : "Sem data";
    const all = activities.every(a => multiState.checked.has(a.id));
    const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "account-switch";
    toggle.textContent = all ? "Desmarcar todas" : "Marcar todas"; toggle.disabled = multiState.busy;
    toggle.addEventListener("click", () => {
      for (const a of activities) all ? multiState.checked.delete(a.id) : multiState.checked.add(a.id);
      renderMulti();
    });
    head.append(title, toggle); group.append(head);
    for (const activity of activities) {
      const label = document.createElement("label"); label.className = "multi-option" + (multiState.saved.has(activity.id) ? " saved" : "");
      const box = document.createElement("input"); box.type = "checkbox"; box.checked = multiState.checked.has(activity.id);
      box.disabled = multiState.busy;
      box.addEventListener("change", () => {
        box.checked ? multiState.checked.add(activity.id) : multiState.checked.delete(activity.id);
        renderMulti();
      });
      const name = document.createElement("span"); name.textContent = activity.name;
      label.append(box, name); group.append(label);
    }
    return group;
  }));
  const { add, remove } = multiChanges();
  $("multiSave").disabled = multiState.busy || !(add.length + remove.length);
  $("multiSave").textContent = add.length || remove.length
    ? `Salvar (${[add.length ? `+${add.length}` : "", remove.length ? `−${remove.length}` : ""].filter(Boolean).join(" / ")})` : "Salvar";
}

async function openMulti(person, preselect = []) {
  if (!person?.id || !state.session) return;
  const version = ++multiState.version;
  multiState.person = person; multiState.busy = false;
  multiState.saved = new Set(); multiState.checked = new Set();
  $("multiTitle").textContent = `Presenças de ${person.name}`;
  $("multiEmail").textContent = person.email ?? "";
  $("multiDays").replaceChildren(); $("multiSave").disabled = true; $("multiSave").textContent = "Salvar";
  $("multiPanel").hidden = false;
  message("multiMessage", "Carregando presenças...");
  try {
    const token = await accessToken();
    if (version !== multiState.version) return;
    const data = await request(`${personPath}?participant=${encodeURIComponent(person.id)}`, { token });
    if (version !== multiState.version) return;
    if (!Array.isArray(data?.activities)) throw Error();
    multiState.saved = new Set(data.activities);
    multiState.checked = new Set([...data.activities, ...preselect.filter(id => adminState.activities.some(a => a.id === id))]);
    message("multiMessage", "");
    renderMulti();
    $("multiPanel").scrollIntoView?.({ block: "start", behavior: "smooth" });
  } catch {
    if (version === multiState.version) message("multiMessage", "Não foi possível carregar as presenças desta pessoa. Feche e tente de novo.", true);
  }
}

async function saveMulti() {
  const person = multiState.person;
  const { add, remove } = multiChanges();
  if (!person || multiState.busy || !(add.length + remove.length) || !state.session) return;
  if (remove.length && !confirm(`Remover ${remove.length} presença(s) de ${person.name}? O selo e a chance no sorteio dessas palestras também saem.`)) return;
  const version = multiState.version;
  multiState.busy = true; renderMulti();
  try {
    const token = await accessToken();
    const data = await request(personPath, { method: "POST", token, body: { participant: person.id, add, remove } });
    if (version !== multiState.version) return;
    const parts = [data.added ? `${data.added} ${data.added === 1 ? "presença registrada" : "presenças registradas"}` : "",
      data.removed ? `${data.removed} ${data.removed === 1 ? "removida" : "removidas"}` : ""].filter(Boolean);
    closeMulti();
    message("adminMessage", `✅ ${person.name}: ${parts.join(", ") || "nada mudou"}.`);
    $("adminSearch").value = ""; $("adminResults").replaceChildren(); $("adminSearch").focus();
    loadAttendees(); loadAdmin();
  } catch {
    if (version !== multiState.version) return;
    multiState.busy = false; renderMulti();
    message("multiMessage", "Não foi possível salvar. Nada foi alterado; tente de novo.", true);
  }
}

$("walkinToggle").addEventListener("click", openWalkin);
$("multiSave").addEventListener("click", saveMulti);
$("multiCancel").addEventListener("click", closeMulti);
$("walkinCancel").addEventListener("click", closeWalkin);
$("walkinForm").addEventListener("submit", event => { event.preventDefault(); return registerWalkin(); });
