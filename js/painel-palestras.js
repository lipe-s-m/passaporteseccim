// Painel: editor das palestras (textos, palestrante, foto e links).
const editorState = {version:0,activity:null,revision:null,busy:false,ready:false,dirty:false};
const editorPath = "/functions/v1/passport/admin/activity-content";
const editorTextFields={name:"editorName",category:"editorCategory",short_description:"editorSummary",description:"editorDescription",speaker_name:"editorSpeaker",speaker_bio:"editorBio"};

function resetEditor(){
  editorState.version++;Object.assign(editorState,{activity:null,revision:null,busy:false,ready:false,dirty:false});
  $("editorForm").hidden=true;$("editorFields").disabled=false;$("editorSave").disabled=true;
  $("editorPreview").disabled=false;
  $("editorActivity").value="";$("editorPreviewFrame").hidden=true;$("editorPreviewFrame").removeAttribute?.("src");
  $("editorPhotoPreview").hidden=true;
  for(const id of [...Object.values(editorTextFields),"editorDate","editorStart","editorEnd","editorPhoto","editorSlides","editorInstagram","editorLinkedin","editorYoutube","editorWebsite"])$(id).value="";editorBioCount();
  try{sessionStorage.removeItem("seccim.content.preview");}catch{}
  message("editorMessage","");
}
// Foto publicada com o site (/fotos/...) ou link https do Cloudinary, as mesmas regras do backend.
function editorPhotoUrl(raw){
  if(/^\/fotos\/[a-z0-9]+(-[a-z0-9]+)*\.(webp|jpg|png)$/.test(raw)||siteImagePattern.test(raw))return raw;
  try{const u=new URL(raw);if(u.protocol==='https:'&&u.hostname==='res.cloudinary.com'&&!u.username&&!u.password)return u.href;}catch{}
  return "";
}
function editorPhoto(){
  const url=editorPhotoUrl($("editorPhoto").value.trim());const img=$("editorPhotoPreview");img.hidden=!url;
  if(url)img.src=url;
}
function editorTime(value){
  if(!value||!Number.isFinite(Date.parse(value)))return "";
  return new Intl.DateTimeFormat("en-GB",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(value));
}
function fillEditor(data){
  for(const [key,id] of Object.entries(editorTextFields))$(id).value=typeof data[key]==="string"?data[key]:"";
  $("editorDate").value=data.event_date??"";$("editorStart").value=editorTime(data.starts_at);$("editorEnd").value=editorTime(data.ends_at);
  $("editorPhoto").value=data.speaker_photo_url??"";$("editorSlides").value=data.slides_url??"";
  for(const [key,id] of Object.entries({instagram:"editorInstagram",linkedin:"editorLinkedin",youtube:"editorYoutube",website:"editorWebsite"}))$(id).value=data.speaker_socials?.[key]??"";
  editorPhoto();editorBioCount();$("editorForm").hidden=false;editorState.dirty=false;
}
async function loadEditor(){
  const activity=$("editorActivity").value;const version=++editorState.version;
  Object.assign(editorState,{activity,ready:false,revision:null,busy:true,dirty:false});
  $("editorFields").disabled=false;$("editorPreview").disabled=false;
  $("editorForm").hidden=true;$("editorSave").disabled=true;$("editorPreviewFrame").hidden=true;
  if(!activity||!state.session){editorState.busy=false;message("editorMessage","");return;}
  message("editorMessage","Carregando informações...");
  try{
    const token=await accessToken();if(version!==editorState.version)return;
    const data=await request(`${editorPath}?activity=${encodeURIComponent(activity)}`,{token});
    if(version!==editorState.version)return;
    if(!data?.activity?.id||!Number.isSafeInteger(data.activity.content_revision))throw Error();
    editorState.revision=data.activity.content_revision;editorState.ready=true;fillEditor(data.activity);
    $("editorSave").disabled=false;message("editorMessage","");
  }catch(error){
    if(version!==editorState.version)return;
    if(error.status===401||error.status===403){message("editorMessage","Entre novamente com uma conta da organização para editar.",true);return;}
    // A preparação local permite revisar o formulário sem publicar a nova API.
    const local=["localhost","127.0.0.1","::1","[::1]"].includes(typeof location!=="undefined"?location.hostname:"");
    const existing=state.badges.find(row=>row.id===activity);
    if(local&&existing){fillEditor(existing);message("editorMessage","Você pode editar e pré-visualizar. O salvamento ficará disponível quando o editor for habilitado no servidor.");}
    else message("editorMessage","Não foi possível carregar o editor. Tente recarregar as informações.",true);
  }finally{if(version===editorState.version)editorState.busy=false;}
}
// Mesmas regras do backend: domínio oficial ou subdomínio dele (br.linkedin.com, m.youtube.com).
const editorSocials={instagram:{id:"editorInstagram",label:"Instagram",hosts:["instagram.com"]},
  linkedin:{id:"editorLinkedin",label:"LinkedIn",hosts:["linkedin.com"]},
  youtube:{id:"editorYoutube",label:"YouTube",hosts:["youtube.com","youtu.be"]},
  website:{id:"editorWebsite",label:"Site",hosts:null}};
function editorBioCount(){$("editorBioCount").textContent=`${$("editorBio").value.length} / 4000 caracteres`;}
function readEditor(){
  const data=Object.fromEntries(Object.entries(editorTextFields).map(([key,id])=>[key,$(id).value.trim()]));
  data.event_date=$("editorDate").value||null;
  const start=$("editorStart").value,end=$("editorEnd").value;
  if((start&&!data.event_date)||(end&&!start))throw Error("Preencha a data e o horário de início.");
  // Programação da SECCIM no Brasil, horário de Brasília (UTC-03).
  data.starts_at=start?`${data.event_date}T${start}:00-03:00`:null;
  data.ends_at=end?`${data.event_date}T${end}:00-03:00`:null;
  if(data.ends_at&&Date.parse(data.ends_at)<=Date.parse(data.starts_at))throw Error("O término precisa ser depois do início.");
  data.speaker_photo_url=$("editorPhoto").value.trim()||null;data.slides_url=$("editorSlides").value.trim()||null;
  if(data.speaker_photo_url&&!editorPhotoUrl(data.speaker_photo_url))throw Error("Foto: use /fotos/nome.webp (imagem publicada com o site) ou um link https do Cloudinary.");
  data.speaker_socials={};
  for(const [key,{id,label,hosts}] of Object.entries(editorSocials)){
    const url=editorLink($(id).value);if(!url)continue;
    let valid=false;try{const u=new URL(url);valid=u.protocol==='https:'&&!u.username&&!u.password&&(!hosts||hosts.some(d=>u.hostname===d||u.hostname.endsWith("."+d)));}catch{}
    if(!valid)throw Error(hosts?`O link do ${label} precisa ser um endereço https do ${hosts.join(" ou ")}.`:`O link do ${label} precisa começar com https://.`);
    $(id).value=url;data.speaker_socials[key]=url;
  }
  if(data.slides_url){data.slides_url=editorLink(data.slides_url);let valid=false;try{const u=new URL(data.slides_url);valid=u.protocol==='https:'&&!u.username&&!u.password;}catch{}if(!valid)throw Error("O link dos slides precisa começar com https://.");$("editorSlides").value=data.slides_url;}
  return data;
}
async function saveEditor(event){
  event.preventDefault();if(editorState.busy||!editorState.ready||!state.session||!$("editorForm").reportValidity())return;
  let content;try{content=readEditor();}catch(error){message("editorMessage",error.message,true);return;}
  const version=editorState.version,activity=editorState.activity;
  editorState.busy=true;$("editorSave").disabled=true;$("editorFields").disabled=true;$("editorPreview").disabled=true;
  message("editorMessage","Salvando informações...");
  try{
    const token=await accessToken();if(version!==editorState.version)return;
    const data=await request(editorPath,{method:"POST",token,body:{activity,content,revision:editorState.revision}});
    if(version!==editorState.version)return;
    if(!data?.activity?.id||!Number.isSafeInteger(data.activity.content_revision))throw Error();
    editorState.revision=data.activity.content_revision;fillEditor(data.activity);
    const badge=state.badges.find(row=>row.id===activity);if(badge)Object.assign(badge,data.activity);
    renderBadges(true);loadAdmin();message("editorMessage","Informações salvas.");
  }catch(error){
    if(version!==editorState.version)return;
    if(error.status===409){editorState.ready=false;message("editorMessage","Outra pessoa alterou esta palestra. Copie suas alterações e recarregue as informações antes de salvar.",true);}
    else message("editorMessage",error.status===403?"Sua conta não tem permissão para salvar.":error.status===400?"Confira os textos, horários e links antes de salvar.":"Não foi possível salvar. Seus campos foram mantidos para tentar novamente.",true);
  }finally{if(version===editorState.version){editorState.busy=false;$("editorFields").disabled=false;$("editorPreview").disabled=false;$("editorSave").disabled=!editorState.ready;}}
}
$("editorForm").addEventListener("submit",saveEditor);
$("editorForm").addEventListener("input",()=>{editorState.dirty=true;});
$("editorActivity").addEventListener("change",()=>{
  if(editorState.dirty&&!confirm("Descartar as alterações ainda não salvas?")){$("editorActivity").value=editorState.activity;return;}
  loadEditor();
});
$("editorReload").addEventListener("click",()=>{if(!editorState.dirty||confirm("Descartar as alterações e recarregar?"))loadEditor();});
$("editorPhoto").addEventListener("input",editorPhoto);
$("editorBio").addEventListener("input",editorBioCount);
$("editorPhotoPreview").addEventListener("error",()=>{$("editorPhotoPreview").hidden=true;});
$("editorPreview").addEventListener("click",()=>{
  if(editorState.busy||!$("editorForm").reportValidity())return;
  try{
    const data={...readEditor(),id:editorState.activity};sessionStorage.setItem("seccim.content.preview",JSON.stringify(data));
    $("editorPreviewFrame").src=`palestra.html?id=${encodeURIComponent(editorState.activity)}&preview=1&v=${Date.now()}`;
    $("editorPreviewFrame").hidden=false;
  }catch(error){message("editorMessage",error.message||"Não foi possível abrir a prévia nesta aba.",true);}
});
async function uploadSpeakerPhoto(file) {
  message("editorMessage", "Enviando foto...");
  try {
    const url = await uploadSiteImage(await prepareImage(file, { maxSide: 480, square: true, maxBytes: 400 * 1024 }), "speakers");
    $("editorPhoto").value = url; editorPhoto(); editorState.dirty = true;
    message("editorMessage", "Foto enviada. Salve as informações para publicar.");
  } catch (error) { message("editorMessage", imageError(error), true); }
  finally { $("editorPhotoFile").value = ""; }
}

$("editorPhotoFile").addEventListener("change", () => { const file = $("editorPhotoFile").files?.[0]; if (file) uploadSpeakerPhoto(file); });
$("editorPhotoClear").addEventListener("click", () => { $("editorPhoto").value = ""; editorPhoto(); editorState.dirty = true; });
