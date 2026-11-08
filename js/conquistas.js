// Gamificação do passaporte: emblema por área, nível e XP, conquistas e aviso de selo novo.
// Tudo é calculado no aparelho a partir dos selos; nada disso é gravado no servidor.

// Níveis proporcionais ao total de selos, para continuar fazendo sentido se a programação mudar.
const levelSteps = [["🌱", "Visitante", () => 0], ["🐣", "Calouro(a)", () => 1], ["🧭", "Explorador(a)", t => Math.ceil(t * .2)],
  ["⚔️", "Veterano(a)", t => Math.ceil(t * .4)], ["🧙", "Mestre", t => Math.ceil(t * .7)], ["👑", "Lenda da SECCIM", t => t]];
function levelFor(earned, total) {
  const levels = [];
  for (const [icon, name, minFor] of levelSteps) {
    const min = Math.min(minFor(total), total);
    // Com poucos selos, dois níveis podem pedir o mesmo número: fica o mais alto.
    if (levels.length && min <= levels.at(-1).min) {
      if (levels.length === 1) continue;
      levels.pop();
    }
    levels.push({ icon, name, min });
  }
  const index = levels.findLastIndex(level => earned >= level.min);
  const next = levels[index + 1] ?? null;
  return { ...levels[index], number: index + 1, next, missing: next ? next.min - earned : 0 };
}

const sameDay = badges => {
  const days = new Map();
  for (const badge of badges) if (badge.event_date) days.set(badge.event_date, [...(days.get(badge.event_date) ?? []), badge]);
  return days;
};
function achievementsFor(badges) {
  const earned = badges.filter(b => b.earned), total = badges.length, days = sameDay(badges);
  const areas = new Set(earned.map(b => b.category).filter(Boolean)).size;
  const fullDays = [...days.values()].filter(list => list.length >= 2);
  const bestDay = fullDays.map(list => [list.filter(b => b.earned).length, list.length])
    .sort((a, b) => b[0] / b[1] - a[0] / a[1] || b[1] - a[1])[0] ?? [0, 0];
  const daysPresent = [...days.values()].filter(list => list.some(b => b.earned)).length;
  return [
    { icon: "👣", name: "Primeiro passo", description: "Conquiste seu primeiro selo.", value: earned.length, goal: 1 },
    { icon: "🧩", name: "Curiosidade em alta", description: "Selos de 3 áreas diferentes.", value: areas, goal: 3 },
    { icon: "🏃", name: "Maratona", description: "Todas as atividades de um mesmo dia.", value: bestDay[0], goal: bestDay[1] },
    { icon: "📅", name: "Presença garantida", description: "Pelo menos um selo em cada dia do evento.", value: daysPresent, goal: days.size },
    { icon: "🌗", name: "Meio caminho", description: "Metade da coleção.", value: earned.length, goal: Math.ceil(total / 2) },
    { icon: "👑", name: "Lenda da SECCIM", description: "Todos os selos da coleção.", value: earned.length, goal: total }
  ].filter(a => a.goal > 0).map(a => ({ ...a, value: Math.min(a.value, a.goal), unlocked: a.value >= a.goal }));
}

// Nível, XP e conquistas; escondidos para quem não entrou.
function renderGame(privateLoaded) {
  $("levelRow").hidden = !privateLoaded; $("achievements").hidden = !privateLoaded;
  if (!privateLoaded) { $("achievementList").replaceChildren(); return; }
  const total = state.badges.length, earned = state.badges.filter(b => b.earned).length;
  const achievements = achievementsFor(state.badges), unlocked = achievements.filter(a => a.unlocked).length;
  const level = levelFor(earned, total);
  $("levelIcon").textContent = level.icon;
  $("levelName").textContent = `Nível ${level.number} · ${level.name}`;
  $("levelNext").textContent = level.next
    ? `Falta${level.missing === 1 ? "" : "m"} ${level.missing} ${level.missing === 1 ? "selo" : "selos"} para ${level.next.name}`
    : total ? "Nível máximo. Coleção completa!" : "";
  // 100 XP por selo e 50 por conquista.
  $("xpValue").textContent = `${(earned * 100 + unlocked * 50).toLocaleString("pt-BR")} XP`;
  $("achievementsMeta").textContent = `${unlocked} / ${achievements.length} DESBLOQUEADAS`;
  $("achievementList").replaceChildren(...achievements.map((a, index) => {
    const item = document.createElement("li"); item.className = `achievement ${a.unlocked ? "unlocked" : "locked"}`;
    item.style.animationDelay = `${Math.min(index, 12) * 40}ms`;
    const icon = document.createElement("span"); icon.className = "achievement-icon"; icon.textContent = a.unlocked ? a.icon : "🔒";
    icon.setAttribute("aria-hidden", "true");
    const info = document.createElement("div"); info.className = "achievement-info";
    const name = document.createElement("strong"); name.textContent = a.name;
    const description = document.createElement("small"); description.textContent = a.description;
    const bar = document.createElement("div"); bar.className = "achievement-bar";
    const fill = document.createElement("span"); fill.style.width = `${Math.round(a.value / a.goal * 100)}%`; bar.append(fill);
    const status = document.createElement("small"); status.className = "achievement-status";
    status.textContent = a.unlocked ? "Desbloqueada" : `${a.value} / ${a.goal}`;
    info.append(name, description, bar, status);
    item.setAttribute("aria-label", `${a.name}: ${a.unlocked ? "desbloqueada" : `${a.value} de ${a.goal}`}. ${a.description}`);
    item.append(icon, info);
    return item;
  }));
}

// Selo novo desde a última visita neste aparelho: aviso e destaque no cartão. Na primeira visita só registra.
function markNewBadges(participantId) {
  const key = `seccim-selos-${participantId}`, earned = state.badges.filter(b => b.earned).map(b => b.id);
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { seen = null; }
  try { localStorage.setItem(key, JSON.stringify(earned)); } catch { /* Sem armazenamento, apenas não avisa. */ }
  if (!Array.isArray(seen)) return [];
  const fresh = state.badges.filter(b => b.earned && !seen.includes(b.id));
  for (const badge of fresh) badge.fresh = true;
  if (fresh.length) showToast(fresh.length === 1 ? `🎉 Selo novo: ${fresh[0].name}` : `🎉 ${fresh.length} selos novos na sua coleção!`);
  return fresh;
}

let toastTimer = null;
function showToast(textValue) {
  $("toast").textContent = textValue; $("toast").hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $("toast").hidden = true; }, 5000);
}
function hideToast() { clearTimeout(toastTimer); $("toast").hidden = true; $("toast").textContent = ""; }
