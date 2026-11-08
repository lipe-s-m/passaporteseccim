// Faixa de patrocinadores no rodapé.
// Mesmas regras do banco: imagens do site em /fotos/patrocinadores/ ou do Cloudinary.
function sponsorImage(raw) {
  if (/^\/fotos\/patrocinadores\/[a-z0-9]+(-[a-z0-9]+)*\.(webp|jpg|png)$/.test(raw) || siteImagePattern.test(raw)) return raw;
  try { const u = new URL(raw); return u.protocol === "https:" && u.hostname === "res.cloudinary.com" && !u.username && !u.password ? u.href : ""; } catch { return ""; }
}
function sponsorLogoNode(sponsor) {
  const src = sponsorImage(typeof sponsor.logo_url === "string" ? sponsor.logo_url.trim() : "");
  if (!src) { const name = document.createElement("span"); name.textContent = sponsor.name; return name; }
  const img = document.createElement("img"); img.src = src; img.alt = sponsor.name; img.loading = "lazy";
  return img;
}

async function loadSponsorStrip() {
  if (!configured()) return;
  try {
    const rows = await request("/rest/v1/sponsors?select=id,name,logo_url&published=eq.true");
    if (!Array.isArray(rows)) return;
    const sponsors = rows.filter(s => typeof s?.name === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id ?? ""))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
    $("sponsorLogos").replaceChildren(...sponsors.map(s => {
      const link = document.createElement("a"); link.className = "sponsor-logo"; link.href = `patrocinadores.html#${s.id}`;
      link.setAttribute("aria-label", s.name); link.append(sponsorLogoNode(s));
      const item = document.createElement("li"); item.append(link); return item;
    }));
    $("sponsorStrip").hidden = !sponsors.length; $("sponsorNav").hidden = !sponsors.length;
  } catch { /* Sem a faixa, o restante do site continua funcionando. */ }
}
