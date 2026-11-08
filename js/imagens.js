// Envio de imagens: redução no próprio aparelho e upload pelo backend (palestrantes, patrocinadores e perfil).
// A imagem é reduzida no aparelho e enviada ao bucket público "site-images" pelo backend da organização.
const siteImagePattern = /^https:\/\/mqparqbuhstkdpcgbbsa\.supabase\.co\/storage\/v1\/object\/public\/site-images\/(speakers|sponsors)\/[0-9a-f]{16}\.(webp|jpg|png)$/;

// Reduz a imagem: quadrada (recorte no centro) ou mantendo a proporção; logos preservam a transparência.
async function prepareImage(file, { maxSide, square = false, transparent = false, maxBytes }) {
  if (!file || !/^image\//.test(file.type)) throw Error("Escolha um arquivo de imagem.");
  if (file.size > 25 * 1024 * 1024) throw Error("Imagem muito grande. Escolha uma de até 25 MB.");
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const scale = Math.min(1, maxSide / (square ? side : Math.max(bitmap.width, bitmap.height)));
  const width = Math.max(1, Math.round((square ? side : bitmap.width) * scale)), height = Math.max(1, Math.round((square ? side : bitmap.height) * scale));
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (square) context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, width, height);
  else context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const encode = (type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));
  // Alguns Safari não geram WebP e devolvem PNG: aí usamos JPEG, ou PNG quando a transparência importa (logos).
  let blob = await encode("image/webp", .85);
  if (!blob || blob.type !== "image/webp") blob = await encode(transparent ? "image/png" : "image/jpeg", .85);
  for (let quality = .75; blob && blob.size > maxBytes && quality > .3; quality -= .15)
    blob = await encode(blob.type === "image/png" ? "image/png" : blob.type, quality);
  if (!blob || blob.size > maxBytes) throw Error("Não foi possível reduzir a imagem o suficiente. Tente outra.");
  return blob;
}

// Recorta no centro e reduz para 400×400 no próprio aparelho: a foto original nunca sai do celular.
async function prepareAvatar(file) {
  return prepareImage(file, { maxSide: 400, square: true, maxBytes: 290 * 1024 });
}

async function uploadSiteImage(blob, kind) {
  const token = await accessToken();
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/passport/admin/images?kind=${kind}`, { method: "PUT", body: blob,
      signal: controller.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": blob.type || "application/octet-stream" } });
    const data = await response.json().catch(() => null);
    if (!response.ok || typeof data?.url !== "string") throw Object.assign(Error(), { status: response.status });
    return data.url;
  } finally { clearTimeout(timer); }
}

const imageError = error => error.status === 413 ? "Imagem grande demais mesmo depois de reduzida. Tente outra."
  : error.status === 400 ? "Esse arquivo não é uma imagem válida (use JPG, PNG ou WebP)."
  : error.status === 403 ? "Sua conta não tem permissão para enviar imagens." : error.message || "Não foi possível enviar a imagem.";
