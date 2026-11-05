-- Fotos dos palestrantes também podem ser servidas pelo próprio site (pasta fotos/ na Vercel).
-- Aceita o caminho relativo /fotos/<nome>.webp|jpg|png além de links https do Cloudinary.
begin;
alter table public.activities drop constraint activities_speaker_photo_cloudinary;
alter table public.activities add constraint activities_speaker_photo_source check (
  speaker_photo_url is null or (length(speaker_photo_url) <= 2048 and (
    speaker_photo_url ~ '^https://res[.]cloudinary[.]com/[[:graph:]]+$'
    or speaker_photo_url ~ '^/fotos/[a-z0-9]+(-[a-z0-9]+)*[.](webp|jpg|png)$'))
);
comment on column public.activities.speaker_photo_url is 'Foto pública: link https do res.cloudinary.com ou caminho /fotos/<nome> publicado com o site.';

-- Mesma função do editor; somente a validação da foto aceita o caminho do site.
create or replace function public.admin_activity_content(p_uid text,p_activity text,p_content jsonb default null,p_revision integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare activity public.activities%rowtype; key text; value jsonb;
  day date; starts timestamptz; ends timestamptz;
begin
  if not private.is_admin(p_uid) then raise exception 'Acesso administrativo obrigatório.' using errcode='42501'; end if;
  if p_content is null then
    select * into activity from public.activities where id=p_activity and active;
  else
    select * into activity from public.activities where id=p_activity and active for update;
  end if;
  if not found then raise exception 'Atividade inválida.' using errcode='22023'; end if;
  if p_content is not null then
    if p_revision is null or p_revision<>activity.content_revision then
      raise exception 'Conteúdo alterado por outra pessoa. Recarregue antes de salvar.' using errcode='40001';
    end if;
    if jsonb_typeof(p_content)<>'object' or not (p_content ?& array['name','category','description','short_description','speaker_name','speaker_photo_url','speaker_bio','event_date','starts_at','ends_at','speaker_socials','slides_url'])
      or exists(select 1 from jsonb_object_keys(p_content) k where k not in ('name','category','description','short_description','speaker_name','speaker_photo_url','speaker_bio','event_date','starts_at','ends_at','speaker_socials','slides_url')) then
      raise exception 'Campos inválidos.' using errcode='22023';
    end if;
    foreach key in array array['name','category','description','short_description','speaker_name','speaker_bio'] loop
      if jsonb_typeof(p_content->key)<>'string' then raise exception 'Texto inválido.' using errcode='22023'; end if;
    end loop;
    if length(btrim(p_content->>'name')) not between 1 and 200 or length(btrim(p_content->>'category')) not between 1 and 120
      or length(p_content->>'description')>8000 or length(p_content->>'short_description')>800
      or length(p_content->>'speaker_name')>160 or length(p_content->>'speaker_bio')>4000 then
      raise exception 'Texto fora do limite.' using errcode='22023';
    end if;
    foreach key in array array['speaker_photo_url','slides_url','event_date','starts_at','ends_at'] loop
      if jsonb_typeof(p_content->key) not in ('string','null') then raise exception 'Formato inválido.' using errcode='22023'; end if;
    end loop;
    if p_content->>'speaker_photo_url' is not null and (length(p_content->>'speaker_photo_url')>2048 or (p_content->>'speaker_photo_url' !~ '^https://res[.]cloudinary[.]com/[[:graph:]]+$'
      and p_content->>'speaker_photo_url' !~ '^/fotos/[a-z0-9]+(-[a-z0-9]+)*[.](webp|jpg|png)$')) then
      raise exception 'Foto inválida.' using errcode='22023';
    end if;
    if p_content->>'slides_url' is not null and (length(p_content->>'slides_url')>2048 or p_content->>'slides_url' !~ '^https://[^[:space:]]+$') then
      raise exception 'Link inválido.' using errcode='22023';
    end if;
    if jsonb_typeof(p_content->'speaker_socials')<>'object' or length((p_content->'speaker_socials')::text)>2000 then
      raise exception 'Redes inválidas.' using errcode='22023';
    end if;
    for key,value in select * from jsonb_each(p_content->'speaker_socials') loop
      if key not in ('instagram','linkedin','youtube','website') or jsonb_typeof(value)<>'string'
        or (value#>>'{}') !~ '^https://[^[:space:]]+$' or length(value#>>'{}')>2048 then
        raise exception 'Rede inválida.' using errcode='22023';
      end if;
    end loop;
    begin
      if p_content->>'event_date' is not null and p_content->>'event_date' !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' then raise exception 'Data inválida'; end if;
      day:=(p_content->>'event_date')::date;
      starts:=(p_content->>'starts_at')::timestamptz;
      ends:=(p_content->>'ends_at')::timestamptz;
      if (starts is not null and not isfinite(starts)) or (ends is not null and not isfinite(ends)) then raise exception 'Horário inválido'; end if;
      if (starts is not null and (day is null or (starts at time zone 'America/Sao_Paulo')::date<>day))
        or (ends is not null and (starts is null or ends<=starts)) then raise exception 'Horário inválido'; end if;
    exception when others then raise exception 'Data ou horário inválido.' using errcode='22023'; end;
    update public.activities set
      name=btrim(p_content->>'name'),category=btrim(p_content->>'category'),description=p_content->>'description',
      short_description=p_content->>'short_description',speaker_name=btrim(p_content->>'speaker_name'),speaker_bio=p_content->>'speaker_bio',
      speaker_photo_url=p_content->>'speaker_photo_url',slides_url=p_content->>'slides_url',
      speaker_socials=p_content->'speaker_socials',event_date=day,starts_at=starts,ends_at=ends,
      content_revision=content_revision+1,content_updated_at=clock_timestamp()
    where id=p_activity returning * into activity;
    insert into private.activity_content_audit(activity_id,revision,updated_by)
      values(activity.id,activity.content_revision,p_uid);
  end if;
  return jsonb_build_object('activity',to_jsonb(activity));
end;
$$;
commit;
