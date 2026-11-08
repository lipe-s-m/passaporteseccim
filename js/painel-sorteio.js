// Painel: sorteio do dia, exportação e histórico.
const raffleState = { version:0, date:"", remaining:0, spinning:false };
const raffleError = text => Object.assign(new Error(text), { visible: true });

async function exportRaffle() {
  const date = $("raffleDate").value;
  if (!date || !state.session) return;
  const version = adminState.version;
  $("raffleExport").disabled = true;
  message("raffleMessage", "Gerando lista...");
  try {
    const entries = []; let offset = 0; let first;
    for (;;) {
      const page = await request(`/functions/v1/passport/admin/raffle?date=${date}&offset=${offset}`, { token: await accessToken() });
      if (version !== adminState.version) return;
      first ??= page;
      if (page.pendingAttendances) throw raffleError("Há presenças em atividades sem data. Configure as datas antes de sortear.");
      if (page.totalEntries !== first.totalEntries) throw raffleError("As presenças mudaram durante a geração. Pause os registros e tente novamente.");
      entries.push(...page.entries);
      if (!page.hasMore) break;
      offset = page.nextOffset;
    }
    if (entries.length !== first.totalEntries || new Set(entries.map(e => e.ticketId)).size !== entries.length) {
      throw raffleError("As presenças mudaram durante a geração. Pause os registros e tente novamente.");
    }
    // Uma linha por chance: quem assistiu a três palestras aparece três vezes.
    download(`sorteio-${date}.txt`, entries.map(e => e.name.trim().split(/\s+/).join(" ") + "\n").join(""), "text/plain;charset=utf-8");
    download(`sorteio-${date}.json`, JSON.stringify({ date, totalEntries: first.totalEntries,
      uniqueParticipants: first.uniqueParticipants, entries }, null, 2), "application/json");
    message("raffleMessage", `${first.totalEntries} chances de ${first.uniqueParticipants} participantes. Arquivos baixados.`);
  } catch (error) {
    if (version === adminState.version) message("raffleMessage", error.visible
      ? error.message : "Não foi possível gerar a lista. Tente novamente.", true);
  } finally { if (version === adminState.version) $("raffleExport").disabled = !$("raffleDate").value; }
}

const drawsPath = "/functions/v1/passport/admin/draws";
function renderDraws(data) {
  raffleState.remaining = data.remainingParticipants;
  const undated = adminState.undated ? ` · ${adminState.undated} atividade(s) sem data ainda não contam` : "";
  $("raffleStats").textContent = data.totalEntries
    ? `${data.totalEntries} ${data.totalEntries === 1 ? "chance" : "chances"} no dia · ${data.remainingParticipants} ${data.remainingParticipants === 1 ? "pessoa ainda pode" : "pessoas ainda podem"} ganhar${undated}`
    : `Ainda não há chances neste dia. Registre presenças nas palestras do dia${undated}.`;
  $("raffleDraw").disabled = raffleState.spinning || !data.remainingParticipants;
  $("raffleWinners").replaceChildren(...data.draws.map((draw, index) => ({ draw, number: index + 1 })).reverse().map(({ draw, number }) => {
    const row = document.createElement("li"); row.className = "admin-row winner-row" + (draw.absent ? " absent" : " present");
    const info = document.createElement("div"); info.className = "admin-person";
    const name = document.createElement("strong"); name.textContent = `🏆 ${number}º · ${draw.name}`;
    const time = new Date(draw.drawnAt);
    const detail = document.createElement("small");
    detail.textContent = [(draw.prize || "Brinde") + (draw.sponsor ? ` (${draw.sponsor})` : ""), `${draw.chances} ${draw.chances === 1 ? "chance" : "chances"}`,
      Number.isNaN(time.getTime()) ? "" : time.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      draw.absent ? "ausente" : ""].filter(Boolean).join(" · ");
    info.append(name, detail); row.append(info);
    const actions = document.createElement("div"); actions.className = "faq-controls winner-actions";
    if (!draw.absent) {
      const absent = document.createElement("button"); absent.type = "button"; absent.className = "action-button secondary";
      absent.textContent = "Ausente"; absent.disabled = raffleState.spinning;
      absent.addEventListener("click", () => markAbsent(draw));
      actions.append(absent);
    }
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "action-button secondary danger";
    remove.textContent = "Apagar"; remove.disabled = raffleState.spinning;
    remove.addEventListener("click", () => deleteDraw(draw));
    actions.append(remove);
    row.append(actions);
    return row;
  }));
}

async function loadDraws() {
  const date = $("raffleDate").value;
  const version = ++raffleState.version;
  raffleState.date = date;
  raffleState.spinning = false;
  $("raffleWinners").replaceChildren();
  $("raffleDraw").disabled = true;
  $("raffleName").textContent = "Quem será?"; $("rafflePrizeLabel").textContent = "";
  $("raffleReel").classList.remove("winner", "spinning");
  message("raffleMessage", "");
  if (!date || !state.session) return;
  try {
    const token = await accessToken();
    if (version !== raffleState.version) return;
    const data = await request(`${drawsPath}?date=${date}`, { token });
    if (version !== raffleState.version) return;
    if (!Array.isArray(data?.draws)) throw Error();
    renderDraws(data);
  } catch {
    if (version === raffleState.version) $("raffleStats").textContent = "Não foi possível carregar o sorteio. Use “Atualizar lista” para tentar de novo.";
  }
}

function spin(names, winner) {
  // Animação apenas: o ganhador já foi escolhido e gravado pelo banco.
  if (reducedMotion()) return Promise.resolve();
  const pool = names.length ? names : [winner];
  $("raffleReel").classList.add("spinning");
  return new Promise(resolve => {
    let step = 0;
    const steps = 30;
    const tick = () => {
      $("raffleName").textContent = pool[step % pool.length];
      if (++step >= steps) { $("raffleReel").classList.remove("spinning"); resolve(); return; }
      setTimeout(tick, 45 + Math.pow(step / steps, 3) * 380);
    };
    tick();
  });
}

function celebrate() {
  if (reducedMotion()) return;
  const colors = ["#7964f5", "#22e39a", "#d7d2ff", "#ffd166", "#ff7eb6"];
  $("confetti").replaceChildren(...Array.from({ length: 90 }, (_, index) => {
    const piece = document.createElement("i");
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[index % colors.length];
    piece.style.animationDuration = `${1.8 + Math.random() * 1.8}s`;
    piece.style.animationDelay = `${Math.random() * .5}s`;
    return piece;
  }));
  setTimeout(() => $("confetti").replaceChildren(), 4500);
}

async function drawWinner() {
  const date = $("raffleDate").value;
  if (!date || raffleState.spinning || !state.session) return;
  const version = raffleState.version;
  raffleState.spinning = true;
  $("raffleDraw").disabled = true;
  $("raffleReel").classList.remove("winner");
  $("raffleName").textContent = "🎲 Sorteando..."; $("rafflePrizeLabel").textContent = "";
  message("raffleMessage", "");
  try {
    const token = await accessToken();
    const data = await request(drawsPath, { method: "POST", token, body: { date, prize: $("rafflePrize").value.trim(), sponsor: $("raffleSponsor").value || null } });
    if (version !== raffleState.version) return;
    const winner = data?.draws?.find(draw => draw.id === data.drawnId);
    if (!data?.drawnId || !winner) {
      $("raffleName").textContent = "Fim das chances!";
      message("raffleMessage", "Todo mundo com chance neste dia já foi sorteado. 🎉");
      raffleState.spinning = false;
      if (Array.isArray(data?.draws)) renderDraws(data);
      return;
    }
    await spin(data.reel, winner.name);
    if (version !== raffleState.version) return;
    $("raffleName").textContent = winner.name;
    $("rafflePrizeLabel").textContent = winner.prize || winner.sponsor
      ? `🎁 ${winner.prize || "Brinde"}${winner.sponsor ? ` · oferecido por ${winner.sponsor}` : ""}` : "🎉 Parabéns!";
    $("raffleReel").classList.add("winner");
    message("raffleMessage", `🏆 ${winner.name} ganhou${winner.prize ? ` ${winner.prize}` : ""}! Tinha ${winner.chances} ${winner.chances === 1 ? "chance" : "chances"} no dia.`);
    $("rafflePrize").value = ""; $("raffleSponsor").value = "";
    celebrate();
    raffleState.spinning = false;
    renderDraws(data);
  } catch {
    if (version !== raffleState.version) return;
    $("raffleName").textContent = "Quem será?";
    message("raffleMessage", "Não foi possível sortear agora. Confira a conexão e tente novamente.", true);
  } finally {
    if (version === raffleState.version) {
      raffleState.spinning = false;
      $("raffleDraw").disabled = !raffleState.remaining;
    }
  }
}

async function markAbsent(draw) {
  const date = $("raffleDate").value;
  if (!date || raffleState.spinning || !state.session) return;
  if (!confirm(`${draw.name} não está aqui? A pessoa sai do sorteio de hoje e você pode sortear de novo.`)) return;
  const version = raffleState.version;
  try {
    const token = await accessToken();
    const data = await request(drawsPath, { method: "PATCH", token, body: { date, id: draw.id } });
    if (version !== raffleState.version) return;
    renderDraws(data);
    message("raffleMessage", `${draw.name} marcado(a) como ausente. Bora sortear de novo! 🎲`);
  } catch {
    if (version === raffleState.version) message("raffleMessage", "Não foi possível marcar a ausência. Tente novamente.", true);
  }
}

async function deleteDraw(draw) {
  const date = $("raffleDate").value;
  if (!date || raffleState.spinning || !state.session) return;
  if (!confirm(`Apagar o sorteio de ${draw.name}? Use para sorteios de teste ou feitos por engano. A pessoa volta a concorrer hoje e o registro some do histórico.`)) return;
  const version = raffleState.version;
  try {
    const token = await accessToken();
    const data = await request(drawsPath, { method: "DELETE", token, body: { date, id: draw.id } });
    if (version !== raffleState.version) return;
    if (!Array.isArray(data?.draws)) throw Error();
    renderDraws(data);
    if ($("raffleName").textContent === draw.name) {
      $("raffleName").textContent = "Quem será?"; $("rafflePrizeLabel").textContent = "";
      $("raffleReel").classList.remove("winner");
    }
    message("raffleMessage", `Sorteio de ${draw.name} apagado. A pessoa voltou a concorrer.`);
  } catch {
    if (version === raffleState.version) message("raffleMessage", "Não foi possível apagar o sorteio. Tente novamente.", true);
  }
}

$("raffleDate").addEventListener("change", loadDraws);
$("raffleDraw").addEventListener("click", drawWinner);
$("raffleFullscreen").hidden = !document.fullscreenEnabled;
$("raffleFullscreen").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else $("raffleStage").requestFullscreen?.().catch(() => {});
});
document.addEventListener("fullscreenchange", () => {
  $("raffleFullscreen").textContent = document.fullscreenElement ? "Sair do telão" : "⛶ Modo telão";
});

$("raffleExport").addEventListener("click", exportRaffle);
