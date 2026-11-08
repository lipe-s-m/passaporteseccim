// Painel da organização: lista de palestras, busca e atualização geral.
const adminState = { version:0, listVersion:0, searchVersion:0, activities:[], undated:0, busy:false, timer:null };
const adminPath = "/functions/v1/passport/admin/attendance";
function resetAdmin() {
  resetEditor();
  closeScanner();
  adminState.version++; adminState.listVersion++; adminState.searchVersion++;
  adminState.activities = []; adminState.busy = false;
  clearTimeout(adminState.timer);
  $("adminTab").hidden = true; $("adminPanel").hidden = true;
  clearBulkAttendance();
  $("adminSearch").value = ""; $("adminSearch").disabled = true;
  for (const id of ["adminResults","adminAttendees"]) $(id).replaceChildren();
  $("adminCount").textContent = "";
  for (const id of ["adminMessage","adminListMessage","raffleMessage"]) message(id, "");
  $("raffleExport").disabled = true;
  closeWalkin();
  $("walkinToggle").disabled = true;
  raffleState.version++; raffleState.date = ""; raffleState.remaining = 0; raffleState.spinning = false;
  $("raffleWinners").replaceChildren(); $("confetti").replaceChildren();
  $("raffleStats").textContent = ""; $("rafflePrize").value = ""; $("raffleSponsor").value = "";
  $("raffleName").textContent = "Quem será?"; $("rafflePrizeLabel").textContent = "";
  $("raffleReel").classList.remove("winner", "spinning");
  $("raffleDraw").disabled = true;
  closeMulti();
  resetSponsors();
  moderationState.version++; $("moderationSearch").value = ""; $("moderationResults").replaceChildren(); message("moderationMessage", "");
}

async function loadAdmin() {
  if (!faqState.ready || !state.session) return;
  const version = ++adminState.version;
  try {
    const token = await accessToken();
    if (version !== adminState.version) return;
    const data = await request(`${adminPath}?action=overview`, { token });
    if (version !== adminState.version) return;
    if (!Array.isArray(data?.activities)) throw Error();
    adminState.activities = data.activities;
    $("adminTab").hidden = false;
    renderAdminActivities();
    if (!sponsorState.loaded) loadSponsorsAdmin();
  } catch (error) {
    if (version !== adminState.version) return;
    // 403: conta sem permissão. Outras falhas mantêm a aba para nova tentativa.
    if (error.status === 403 || $("adminTab").hidden) { $("adminTab").hidden = true; $("adminPanel").hidden = true; }
    else message("adminMessage", "Não foi possível atualizar as atividades. Tente novamente.", true);
  }
}

function renderAdminActivities() {
  const editorSelected=$("editorActivity").value;
  const editorOptions=adminState.activities.map(activity=>{const option=document.createElement("option");option.value=activity.id;option.textContent=activity.name;return option;});
  const editorPlaceholder=document.createElement("option");editorPlaceholder.value="";editorPlaceholder.textContent="Selecione uma palestra";
  $("editorActivity").replaceChildren(editorPlaceholder,...editorOptions);
  $("editorActivity").value=adminState.activities.some(a=>a.id===editorSelected)?editorSelected:"";
  const selected = $("adminActivity").value;
  const option = (value, label) => { const node = document.createElement("option"); node.value = value; node.textContent = label; return node; };
  $("adminActivity").replaceChildren(option("", "Selecione uma atividade"),
    ...adminState.activities.map(a => option(a.id, `${shortDate(a.eventDate)} · ${a.name} (${a.attendances})`)));
  $("adminActivity").value = adminState.activities.some(a => a.id === selected) ? selected : "";
  $("adminSearch").disabled = !$("adminActivity").value;
  $("walkinToggle").disabled = !$("adminActivity").value;
  $("scanOpen").disabled = !$("adminActivity").value;
  const dates = [...new Set(adminState.activities.filter(a => a.raffleEligible && a.eventDate).map(a => a.eventDate))].sort();
  const day = $("raffleDate").value;
  $("raffleDate").replaceChildren(...dates.map(date => option(date, dayLabel(date))));
  $("raffleDate").value = dates.includes(day) ? day : dates.find(date => date >= new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })) ?? dates.at(-1) ?? "";
  $("raffleExport").disabled = !dates.length;
  adminState.undated = adminState.activities.filter(a => a.raffleEligible && !a.eventDate).length;
  if (!dates.length) { $("raffleStats").textContent = "Nenhuma atividade tem data configurada ainda."; $("raffleDraw").disabled = true; }
  else if ($("raffleDate").value !== raffleState.date) loadDraws();
}

$("adminActivity").addEventListener("change", () => {
  closeScanner();
  closeWalkin();
  clearBulkAttendance();
  $("bulkAttendanceEmails").disabled=!$("adminActivity").value;
  $("bulkAttendanceSubmit").disabled=!$("adminActivity").value;
  $("adminSearch").disabled = !$("adminActivity").value;
  $("walkinToggle").disabled = !$("adminActivity").value;
  $("scanOpen").disabled = !$("adminActivity").value;
  $("adminSearch").value = ""; $("adminResults").replaceChildren(); message("adminMessage", "");
  loadAttendees();
  if ($("adminActivity").value) $("adminSearch").focus();
});
$("adminSearch").addEventListener("input", () => { clearTimeout(adminState.timer); adminState.timer = setTimeout(searchParticipants, 300); });
$("adminRefresh").addEventListener("click", () => { loadAdmin(); loadAttendees(); loadDraws(); });
