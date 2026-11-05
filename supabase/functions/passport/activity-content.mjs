export const contentFields = ['name','category','description','short_description','speaker_name','speaker_photo_url','speaker_bio','event_date','starts_at','ends_at','speaker_socials','slides_url'];
const limits={name:200,category:120,description:8000,short_description:800,speaker_name:160,speaker_bio:4000};
export function httpsUrl(value, hosts=null) {
  if (typeof value !== 'string' || value.length>2048) return false;
  try { const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!hosts||hosts.includes(u.hostname)); }catch{return false;}
}
export function validContent(data) {
  if (!data || typeof data!=='object' || Array.isArray(data) || Object.keys(data).some(k=>!contentFields.includes(k)))return false;
  for (const [key,max] of Object.entries(limits)) if(typeof data[key]!=='string'||data[key].length>max)return false;
  if(!data.name.trim()||!data.category.trim())return false;
  for(const key of ['speaker_photo_url','slides_url'])if(data[key]!==null&&!httpsUrl(data[key],key==='speaker_photo_url'?['res.cloudinary.com']:null))return false;
  const date=data.event_date;
  if(date!==null&&(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))return false;
  for(const key of ['starts_at','ends_at'])if(data[key]!==null&&(typeof data[key]!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(data[key])||!Number.isFinite(Date.parse(data[key]))))return false;
  if(data.starts_at && (!date || new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(data.starts_at))!==date))return false;
  if(data.ends_at&&(!data.starts_at||Date.parse(data.ends_at)<=Date.parse(data.starts_at)))return false;
  if(!data.speaker_socials||typeof data.speaker_socials!=='object'||Array.isArray(data.speaker_socials)||JSON.stringify(data.speaker_socials).length>2000)return false;
  const hosts={instagram:['instagram.com','www.instagram.com'],linkedin:['linkedin.com','www.linkedin.com'],youtube:['youtube.com','www.youtube.com','youtu.be'],website:null};
  return Object.entries(data.speaker_socials).every(([key,url])=>Object.hasOwn(hosts,key)&&httpsUrl(url,hosts[key]));
}
export function publicContent(data) {
  return Object.fromEntries(['id',...contentFields,'content_revision'].map(key=>[key,data[key]]));
}
