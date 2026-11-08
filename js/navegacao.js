// Abas da página (passaporte, FAQ, ranking, perfil e painel).
function switchSection(faq) {
  let section = ["ranking","admin","profile"].includes(faq) ? faq : faq ? "faq" : "passport";
  if (section === "admin" && $("adminTab").hidden) section = "passport";
  if (!faqState.ready) {
    $("passportPanel").hidden = true; $("faqPanel").hidden = true; $("rankingPanel").hidden = true; $("adminPanel").hidden = true; $("profilePanel").hidden = true;
    return;
  }
  if (section !== "admin") closeScanner();
  for (const name of ["passport","faq","ranking","admin","profile"]) {
    $(name + "Panel").hidden = section !== name;
    $(name + "Tab").setAttribute("aria-pressed", String(section === name));
  }
  if (section === "faq" && !faqState.busy) loadQuestions();
  if (section === "ranking") loadRanking();
  if (section === "profile") loadProfile();
  if (section === "admin") { loadAdmin(); loadAttendees(); loadDraws(); }
}

$("rankingTab").addEventListener("click", () => switchSection("ranking"));

$("adminTab").addEventListener("click", () => switchSection("admin"));
$("profileTab").addEventListener("click", () => switchSection("profile"));
$("passportTab").addEventListener("click", () => switchSection(false));
$("faqTab").addEventListener("click", () => switchSection(true));
