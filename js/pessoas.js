// Perfis de outros participantes: busca na aba Ranking e perfil com selos e brindes.
const peoplePath = "/functions/v1/passport/people";
const peopleState = { version:0, timer:null, personVersion:0, focus:null };
const periodLabel = period => /^\d+$/.test(period ?? "") ? `${period}º período`
  : ({ formado: "Formado(a)", "nao-aluno": "Não é aluno(a) da UFRRJ" })[period] ?? "";

function resetPeople() {
  peopleState.version++; clearTimeout(peopleState.timer);
  $("peopleSearch").value = ""; $("peopleResults").replaceChildren(); message("peopleMessage", "");
  closePerson();
}

async function searchPeople() {
  const version = ++peopleState.version;
  const query = $("peopleSearch").value.trim();
  $("peopleResults").replaceChildren();
  if (query.replace(/^@/, "").length < 2) { message("peopleMessage", query ? "Digite pelo menos 2 letras." : ""); return; }
  message("peopleMessage", "Buscando...");
  try {
    const data = await request(`${peoplePath}?q=${encodeURIComponent(query)}`, { token: await accessToken() });
    if (version !== peopleState.version) return;
    if (!Array.isArray(data?.people)) throw Error();
    $("peopleResults").replaceChildren(...data.people.map(p => {
      const row = document.createElement("li");
      const button = document.createElement("button"); button.type = "button"; button.className = "person-result";
      button.setAttribute("aria-label", `Ver perfil de ${p.name}`);
      const info = document.createElement("span"); info.className = "person-result-info";
      const name = document.createElement("strong"); name.textContent = p.name;
      const detail = document.createElement("small");
      detail.textContent = [p.nickname ? `@${p.nickname}` : "", p.headline, `${p.badgeCount} ${p.badgeCount === 1 ? "selo" : "selos"}`].filter(Boolean).join(" · ");
      info.append(name, detail);
      button.append(avatarNode(p.nickname || p.name, p.photoUrl), info);
      button.addEventListener("click", () => openPerson(p.id));
      row.append(button);
      return row;
    }));
    message("peopleMessage", data.people.length ? "" : "Ninguém encontrado com esse nome ou apelido.");
  } catch { if (version === peopleState.version) message("peopleMessage", "Não foi possível buscar agora. Tente novamente.", true); }
}

async function openPerson(id) {
  if (!id || !state.session) return;
  const version = ++peopleState.personVersion;
  if (!$("personBackdrop").classList.contains("open")) peopleState.focus = document.activeElement;
  $("personBackdrop").classList.add("open"); $("pageContent").inert = true; document.body.style.overflow = "hidden";
  $("personDetails").hidden = true; $("personAvatar").replaceChildren(); $("personName").textContent = "Carregando perfil...";
  message("personMessage", "");
  $("personClose").focus();
  try {
    const data = await request(`${peoplePath}?id=${encodeURIComponent(id)}`, { token: await accessToken() });
    if (version !== peopleState.personVersion) return;
    if (!data?.person || !Array.isArray(data.person.badges) || !Array.isArray(data.person.prizes)) throw Error();
    renderPerson(data.person);
  } catch (error) {
    if (version !== peopleState.personVersion) return;
    $("personName").textContent = "Perfil";
    message("personMessage", error.status === 404 ? "Este perfil não está disponível." : "Não foi possível abrir o perfil. Tente novamente.", true);
  }
}

function renderPerson(p) {
  const show = (id, value) => { $(id).textContent = value; $(id).hidden = !value; };
  $("personName").textContent = p.name;
  $("personAvatar").replaceChildren(avatarNode(p.nickname || p.name, p.photoUrl, "avatar avatar-large"));
  show("personNickname", [p.nickname ? `@${p.nickname}` : "", p.isMe ? "você" : ""].filter(Boolean).join(" · "));
  show("personHeadline", p.headline); show("personStudy", [p.course, periodLabel(p.period)].filter(Boolean).join(" · "));
  show("personBio", p.bio);
  const links = [["linkedin", "LinkedIn"], ["github", "GitHub"]].filter(([key]) => p.links?.[key]).map(([key, label]) => {
    const link = document.createElement("a"); link.className = "social-link"; link.href = p.links[key];
    link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = label;
    return link;
  });
  $("personLinks").replaceChildren(...links); $("personLinks").hidden = !links.length;
  $("personBadgesTitle").textContent = `Selos (${p.badges.length})`;
  $("personBadges").replaceChildren(...(p.badges.length ? p.badges.map(b => {
    const item = document.createElement("li"); item.className = "person-badge";
    const name = document.createElement("strong"); name.textContent = b.name;
    const when = document.createElement("small"); when.textContent = [b.category, b.eventDate ? shortDate(b.eventDate) : ""].filter(Boolean).join(" · ");
    item.append(name, when);
    return item;
  }) : [Object.assign(document.createElement("li"), { className: "person-empty", textContent: "Nenhum selo ainda." })]));
  $("personPrizesTitle").textContent = `Brindes (${p.prizes.length})`;
  $("personPrizes").replaceChildren(...(p.prizes.length ? p.prizes.map(prize => {
    const item = document.createElement("li"); item.className = "person-prize";
    item.textContent = [`🎁 ${prize.prize || "Brinde do sorteio"}`, prize.sponsor ? `oferecido por ${prize.sponsor}` : "",
      prize.date ? `sorteio de ${shortDate(prize.date)}` : ""].filter(Boolean).join(" · ");
    return item;
  }) : [Object.assign(document.createElement("li"), { className: "person-empty", textContent: "Nenhum brinde ainda." })]));
  $("personDetails").hidden = false;
}

function closePerson() {
  peopleState.personVersion++;
  const wasOpen = $("personBackdrop").classList.contains("open");
  $("personBackdrop").classList.remove("open");
  if (wasOpen) { $("pageContent").inert = false; document.body.style.overflow = ""; if (peopleState.focus?.isConnected) peopleState.focus.focus(); }
  peopleState.focus = null;
}

$("peopleSearch").addEventListener("input", () => { clearTimeout(peopleState.timer); peopleState.timer = setTimeout(searchPeople, 300); });
$("personClose").addEventListener("click", closePerson);
$("personBackdrop").addEventListener("click", event => { if (event.target === $("personBackdrop")) closePerson(); });
$("profilePreview").addEventListener("click", () => openPerson(state.participantId));
