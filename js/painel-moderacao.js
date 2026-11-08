// Painel: moderação de perfis (apelido, foto e bio).
const moderationState = { version:0, timer:null };
async function searchProfiles() {
  const version = ++moderationState.version;
  const query = $("moderationSearch").value.trim();
  $("moderationResults").replaceChildren();
  if (query.length < 2) { message("moderationMessage", query ? "Digite pelo menos 2 letras." : ""); return; }
  message("moderationMessage", "Buscando...");
  try {
    const token = await accessToken();
    const data = await request(`/functions/v1/passport/admin/profiles?q=${encodeURIComponent(query)}`, { token });
    if (version !== moderationState.version) return;
    if (!Array.isArray(data?.profiles)) throw Error();
    $("moderationResults").replaceChildren(...data.profiles.map(p => {
      const row = document.createElement("li"); row.className = "admin-row";
      const info = document.createElement("div"); info.className = "admin-person";
      const name = document.createElement("strong"); name.textContent = p.nickname ? `${p.name} (@${p.nickname})` : p.name;
      const detail = document.createElement("small"); detail.textContent = p.headline || (p.moderatedAt ? "Já moderado antes" : "");
      info.append(name, detail);
      row.append(avatarNode(p.nickname || p.name, p.photoUrl), info);
      for (const [action, label, has] of [["remove_photo", "Remover foto", !!p.photoUrl], ["remove_nickname", "Remover apelido", !!p.nickname]]) {
        if (!has) continue;
        const button = document.createElement("button"); button.type = "button"; button.className = "action-button secondary danger"; button.textContent = label;
        button.addEventListener("click", () => moderateProfile(p, action, label));
        row.append(button);
      }
      return row;
    }));
    message("moderationMessage", data.profiles.length ? "" : "Nenhum perfil com foto, apelido ou bio encontrado.");
  } catch { if (version === moderationState.version) message("moderationMessage", "Não foi possível buscar perfis.", true); }
}

async function moderateProfile(profile, action, label) {
  if (!confirm(`${label} de ${profile.name}? A pessoa poderá escolher outro depois.`)) return;
  try {
    const token = await accessToken();
    await request("/functions/v1/passport/admin/profiles", { method: "POST", token, body: { participant: profile.participantId, action } });
    await searchProfiles(); message("moderationMessage", `${label}: feito.`);
  } catch { message("moderationMessage", "Não foi possível moderar este perfil.", true); }
}

$("moderationSearch").addEventListener("input", () => { clearTimeout(moderationState.timer); moderationState.timer = setTimeout(searchProfiles, 300); });
