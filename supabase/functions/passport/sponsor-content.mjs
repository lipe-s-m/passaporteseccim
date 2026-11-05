// Mesmas regras de admin_sponsors: o backend recusa antes de chamar o banco.
export const sponsorFields=['name','tagline','about','contributions','logo_url','photos','links','published'];
export const sponsorLinkKeys=['site','linkedin','instagram','youtube','vagas'];
export const sponsorId=value=>typeof value==='string'&&value.length<=60&&/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
export function sponsorImage(value){
  if(typeof value!=='string'||value.length>2048)return false;
  if(/^\/fotos\/patrocinadores\/[a-z0-9]+(-[a-z0-9]+)*\.(webp|jpg|png)$/.test(value))return true;
  try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='res.cloudinary.com'&&!u.username&&!u.password;}catch{return false;}
}
const httpsLink=value=>{
  if(typeof value!=='string'||value.length>2048)return false;
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}
};
export function validSponsor(data){
  if(!data||typeof data!=='object'||Array.isArray(data))return false;
  const keys=Object.keys(data);
  if(keys.length!==sponsorFields.length||!sponsorFields.every(k=>keys.includes(k)))return false;
  if(typeof data.name!=='string'||!data.name.trim()||data.name.trim().length>120)return false;
  if(typeof data.tagline!=='string'||data.tagline.length>240||typeof data.about!=='string'||data.about.length>2000)return false;
  if(typeof data.published!=='boolean')return false;
  if(data.logo_url!==null&&!sponsorImage(data.logo_url))return false;
  if(!Array.isArray(data.contributions)||data.contributions.length>20||
    !data.contributions.every(c=>typeof c==='string'&&c.trim()&&c.trim().length<=200))return false;
  if(!Array.isArray(data.photos)||data.photos.length>12||!data.photos.every(p=>p&&typeof p==='object'&&!Array.isArray(p)&&
    Object.keys(p).every(k=>k==='url'||k==='caption')&&sponsorImage(p.url)&&
    (p.caption===undefined||(typeof p.caption==='string'&&p.caption.length<=160))))return false;
  if(!data.links||typeof data.links!=='object'||Array.isArray(data.links)||JSON.stringify(data.links).length>4000)return false;
  return Object.entries(data.links).every(([k,v])=>sponsorLinkKeys.includes(k)&&httpsLink(v));
}
export function publicSponsor(row){
  return Object.fromEntries(['id',...sponsorFields,'content_revision'].map(key=>[key,row[key]]));
}
