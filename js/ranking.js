// Ranking de selos.
const rankingState = { version:0 };
async function loadRanking() {
  if (!faqState.ready || !state.session) return;
  const version = ++rankingState.version;
  $("rankingRefresh").disabled = true;
  $("rankingList").replaceChildren();
  $("rankingSummary").textContent = "";
  message("rankingMessage", "Carregando ranking...");
  try {
    const token = await accessToken();
    if (version !== rankingState.version) return;
    const data = await request("/functions/v1/passport/ranking", {token});
    if (version !== rankingState.version) return;
    if (!Array.isArray(data.entries)) throw Error();
    for (const entry of data.entries) {
      const podium = entry.position <= 3 ? ` place-${entry.position}` : "";
      const row = document.createElement("li"); row.className = "ranking-row" + podium + (entry.isMe ? " mine" : "");
      const position = document.createElement("span"); position.className = "ranking-position";
      position.textContent = ["🥇", "🥈", "🥉"][entry.position - 1] ?? `${entry.position}º`;
      position.setAttribute("aria-label", `${entry.position}º lugar`);
      const name = document.createElement("span"); name.className = "ranking-name"; name.textContent = entry.name + (entry.isMe ? " (você)" : "");
      const count = document.createElement("span"); count.className = "ranking-count"; count.textContent = `${entry.badgeCount} ${entry.badgeCount === 1 ? "selo" : "selos"}`;
      row.append(position,avatarNode(entry.name,entry.photoUrl),name,count); $("rankingList").append(row);
    }
    $("rankingSummary").textContent = data.mine?.position
      ? `Sua posição: ${data.mine.position}º · ${data.mine.badgeCount} ${data.mine.badgeCount === 1 ? "selo" : "selos"}`
      : "Conquiste seu primeiro selo para entrar no ranking!";
    message("rankingMessage", data.entries.length ? "Os 20 primeiros participantes. Empates compartilham a mesma posição." : "O ranking começa com as primeiras presenças confirmadas.");
  } catch {
    if (version === rankingState.version) message("rankingMessage", "Não foi possível carregar o ranking. Tente atualizar novamente.", true);
  } finally { if (version === rankingState.version) $("rankingRefresh").disabled = false; }
}

$("rankingRefresh").addEventListener("click", loadRanking);
