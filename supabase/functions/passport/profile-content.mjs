// Mesmas regras de manage_profile: o backend recusa antes de chamar o banco.
export const profileFields = ['nickname','showNickname','headline','bio','course','period','links'];
export const profilePeriods = ['','1','2','3','4','5','6','7','8','9','10','formado','nao-aluno'];
const linkHosts = { linkedin: 'linkedin.com', github: 'github.com' };
export const MAX_PHOTO_BYTES = 300 * 1024;

function officialLink(key, value) {
  if (typeof value !== 'string' || value.length > 2048 || !Object.hasOwn(linkHosts, key)) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (u.hostname === linkHosts[key] || u.hostname.endsWith('.' + linkHosts[key]));
  } catch { return false; }
}

export function validProfile(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const keys = Object.keys(data);
  if (keys.length !== profileFields.length || !profileFields.every(k => keys.includes(k))) return false;
  if (data.nickname !== null && (typeof data.nickname !== 'string' ||
    (data.nickname.trim() && !/^[a-z0-9_.]{3,20}$/.test(data.nickname.trim().toLowerCase())))) return false;
  if (typeof data.showNickname !== 'boolean') return false;
  for (const [key, max] of [['headline', 120], ['bio', 160], ['course', 80]])
    if (typeof data[key] !== 'string' || data[key].trim().length > max) return false;
  if (!profilePeriods.includes(data.period)) return false;
  if (!data.links || typeof data.links !== 'object' || Array.isArray(data.links)) return false;
  return Object.entries(data.links).every(([key, value]) => officialLink(key, value));
}

// Tipo real da imagem pelos primeiros bytes (a extensão ou o Content-Type enviados não bastam).
export function imageType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ascii = (start, end) => String.fromCharCode(...b.slice(start, end));
  if (b.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return 'png';
  return null;
}
