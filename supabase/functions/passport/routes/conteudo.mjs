// Rotas de conteúdo editado pela organização: palestras, patrocinadores e imagens do site.
import { validContent, publicContent } from '../activity-content.mjs';
import { validSponsor, publicSponsor, sponsorId } from '../sponsor-content.mjs';
import { imageType } from '../profile-content.mjs';
import { SITE_IMAGE_KINDS, MAX_SITE_IMAGE_BYTES, siteImageUrl } from '../site-images.mjs';
import { response, readJson } from '../http.mjs';

// Imagens públicas do site (palestrantes e patrocinadores), enviadas pela organização.
export async function siteImages({ request, url, supabaseUrl, adminRpc, storage }) {
  const kind = url.searchParams.get('kind');
  if (!SITE_IMAGE_KINDS.includes(kind)) return response(400, 'INVALID_IMAGE');
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > MAX_SITE_IMAGE_BYTES) return response(413, 'IMAGE_TOO_LARGE');
    const type = imageType(bytes);
    if (!type) return response(400, 'INVALID_IMAGE');
    // Só a organização envia imagens públicas do site.
    const { error } = await adminRpc('admin_check', {}, 'IMAGE_UNAVAILABLE');
    if (error) return error;
    const name = [...crypto.getRandomValues(new Uint8Array(8))].map(v => v.toString(16).padStart(2, '0')).join('');
    const path = `${kind}/${name}.${type}`;
    const uploaded = await storage(`object/site-images/${path}`, { method:'POST',
      headers:{ 'Content-Type':{ webp:'image/webp', jpg:'image/jpeg', png:'image/png' }[type], 'x-upsert':'false', 'Cache-Control':'31536000' }, body:bytes });
    if (!uploaded.ok) return response(503, 'IMAGE_UNAVAILABLE');
    return response(200, null, { url:siteImageUrl(supabaseUrl, path) });
  } catch { return response(503, 'IMAGE_UNAVAILABLE'); }
}

// Editor de patrocinadores.
export async function sponsors({ request, adminRpc }) {
  let input = {};
  try {
    if (request.method === 'POST') {
      input = await readJson(request, 32000);
      if (!input || !sponsorId(input.id) || !validSponsor(input.content) ||
        !(input.revision === null || (Number.isSafeInteger(input.revision) && input.revision > 0))) throw Error();
    }
  } catch { return response(400, 'INVALID_SPONSOR'); }
  try {
    const { data, error } = await adminRpc('admin_sponsors', request.method === 'POST'
      ? { p_id:input.id, p_content:{...input.content, name:input.content.name.trim(),
          contributions:input.content.contributions.map(c => c.trim())}, p_revision:input.revision }
      : {}, 'SPONSORS_UNAVAILABLE');
    if (error) return error;
    if (!Array.isArray(data?.sponsors)) return response(503, 'SPONSORS_UNAVAILABLE');
    return response(200, null, { sponsor:data.sponsor ? publicSponsor(data.sponsor) : null,
      sponsors:data.sponsors.map(publicSponsor) });
  } catch { return response(503, 'SPONSORS_UNAVAILABLE'); }
}

// Editor das palestras.
export async function activityContent({ request, url, adminRpc }) {
  let input;
  try{
    input=request.method==='GET'?Object.fromEntries(url.searchParams):await readJson(request,24000);
    if(!input||typeof input.activity!=='string'||input.activity.length>200||!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.activity))throw Error();
    if(request.method==='POST'&&(!validContent(input.content)||!Number.isSafeInteger(input.revision)||input.revision<0))throw Error();
  }catch{return response(400,'INVALID_ACTIVITY_CONTENT');}
  try{
    const {data,error}=await adminRpc('admin_activity_content',{p_activity:input.activity,
      p_content:request.method==='POST'?input.content:null,p_revision:request.method==='POST'?input.revision:null},'CONTENT_UNAVAILABLE');
    if(error)return error;
    if(!data?.activity?.id||!Number.isSafeInteger(data.activity.content_revision))return response(503,'CONTENT_UNAVAILABLE');
    return response(200,null,{activity:publicContent(data.activity)});
  }catch{return response(503,'CONTENT_UNAVAILABLE');}
}
