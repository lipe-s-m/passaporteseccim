// Imagens públicas enviadas pelo painel (foto do palestrante, logo e fotos dos patrocinadores).
// Mesmo padrão de private.site_image_ok no banco.
export const SITE_IMAGE_KINDS = ['speakers', 'sponsors'];
export const MAX_SITE_IMAGE_BYTES = 1536 * 1024;
export const siteImageUrl = (supabaseUrl, path) => `${supabaseUrl}/storage/v1/object/public/site-images/${path}`;
export const siteImage = value => typeof value === 'string' &&
  /^https:\/\/mqparqbuhstkdpcgbbsa\.supabase\.co\/storage\/v1\/object\/public\/site-images\/(speakers|sponsors)\/[0-9a-f]{16}\.(webp|jpg|png)$/.test(value);
