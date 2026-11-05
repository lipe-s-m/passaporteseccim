-- Perfil do participante: apelido, foto, cargo/área/empresa, bio, curso, período e links.
-- O nome oficial (participants.full_name) não muda pelo perfil: é o que vai nos certificados.
begin;

create table public.participant_profiles (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  -- Apelido em minúsculas; único entre todos os participantes.
  nickname text check (nickname is null or nickname ~ '^[a-z0-9_.]{3,20}$'),
  -- Escolha da pessoa: mostrar o apelido no lugar do nome no ranking e no FAQ.
  show_nickname boolean not null default true,
  headline text not null default '' check (length(headline) <= 120),
  bio text not null default '' check (length(bio) <= 160),
  course text not null default '' check (length(course) <= 80),
  period text not null default '' check (period in ('','1','2','3','4','5','6','7','8','9','10','formado','nao-aluno')),
  links jsonb not null default '{}'::jsonb check (jsonb_typeof(links) = 'object' and length(links::text) <= 1200),
  -- Arquivo no bucket privado "avatars"; a leitura é sempre por link assinado e temporário.
  photo_path text check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[0-9a-f]{16}[.](webp|jpg|png)$'),
  moderated_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index participant_profiles_nickname_key on public.participant_profiles(nickname) where nickname is not null;
alter table public.participant_profiles enable row level security;
revoke all on public.participant_profiles from public, anon, authenticated, service_role;
grant select, insert, update on public.participant_profiles to service_role;
comment on table public.participant_profiles is 'Perfil opcional. Acesso só pelo backend autenticado; fotos visíveis apenas a participantes logados.';

-- Nome exibido ao público do passaporte (ranking, FAQ): apelido quando a pessoa escolheu mostrá-lo.
create function private.display_name(p_full_name text, p_nickname text, p_show boolean)
returns text language sql immutable set search_path = ''
as $$ select case when coalesce(p_show, true) and p_nickname is not null then '@' || p_nickname else p_full_name end $$;
revoke all on function private.display_name(text,text,boolean) from public, anon, authenticated;
grant execute on function private.display_name(text,text,boolean) to service_role;

-- Lê (p_profile nulo) ou grava o perfil da própria conta, identificada pelo UID verificado no Firebase.
create function public.manage_profile(p_uid text, p_profile jsonb default null)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare me uuid; v_name text; v_nick text; key text; value jsonb; profile public.participant_profiles%rowtype;
begin
  select p.id, p.full_name into me, v_name from public.participants p where p.firebase_uid = p_uid;
  if me is null then raise exception 'Participante não encontrado.' using errcode = '42501'; end if;
  if p_profile is not null then
    if jsonb_typeof(p_profile) <> 'object'
      or not (p_profile ?& array['nickname','showNickname','headline','bio','course','period','links'])
      or exists(select 1 from jsonb_object_keys(p_profile) k where k not in ('nickname','showNickname','headline','bio','course','period','links'))
      or jsonb_typeof(p_profile->'nickname') not in ('string','null') or jsonb_typeof(p_profile->'showNickname') <> 'boolean'
      or jsonb_typeof(p_profile->'headline') <> 'string' or jsonb_typeof(p_profile->'bio') <> 'string'
      or jsonb_typeof(p_profile->'course') <> 'string' or jsonb_typeof(p_profile->'period') <> 'string'
      or jsonb_typeof(p_profile->'links') <> 'object' then
      raise exception 'Perfil inválido.' using errcode = '22023';
    end if;
    for key, value in select * from jsonb_each(p_profile->'links') loop
      if key not in ('linkedin','github') or jsonb_typeof(value) <> 'string' or (value#>>'{}') !~ '^https://[^[:space:]]+$' then
        raise exception 'Link inválido.' using errcode = '22023';
      end if;
    end loop;
    v_nick := nullif(lower(btrim(p_profile->>'nickname')), '');
    -- Nomes que poderiam se passar pela organização ficam indisponíveis, como se já estivessem em uso.
    if v_nick in ('admin','administrador','adm','seccim','organizacao','organizador','org','suporte','root','moderador','moderacao','ufrrj','staff') then
      raise exception 'Apelido indisponível.' using errcode = '23505';
    end if;
    insert into public.participant_profiles(participant_id,nickname,show_nickname,headline,bio,course,period,links,updated_at)
    values(me,v_nick,(p_profile->>'showNickname')::boolean,btrim(p_profile->>'headline'),btrim(p_profile->>'bio'),
      btrim(p_profile->>'course'),p_profile->>'period',p_profile->'links',now())
    on conflict (participant_id) do update set nickname=excluded.nickname,show_nickname=excluded.show_nickname,
      headline=excluded.headline,bio=excluded.bio,course=excluded.course,period=excluded.period,links=excluded.links,updated_at=now();
  end if;
  select * into profile from public.participant_profiles where participant_id = me;
  return jsonb_build_object('name',v_name,'profile',jsonb_build_object(
    'nickname',profile.nickname,'showNickname',coalesce(profile.show_nickname,true),'headline',coalesce(profile.headline,''),
    'bio',coalesce(profile.bio,''),'course',coalesce(profile.course,''),'period',coalesce(profile.period,''),
    'links',coalesce(profile.links,'{}'::jsonb),'photoPath',profile.photo_path));
end;
$$;
revoke all on function public.manage_profile(text,jsonb) from public, anon, authenticated;
grant execute on function public.manage_profile(text,jsonb) to service_role;

-- Troca ou remove a foto da própria conta; devolve o caminho anterior para o backend apagar o arquivo.
create function public.set_profile_photo(p_uid text, p_path text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare me uuid; previous text;
begin
  select id into me from public.participants where firebase_uid = p_uid;
  if me is null then raise exception 'Participante não encontrado.' using errcode = '42501'; end if;
  if p_path is not null and p_path !~ ('^' || me::text || '/[0-9a-f]{16}[.](webp|jpg|png)$') then
    raise exception 'Caminho inválido.' using errcode = '22023';
  end if;
  select photo_path into previous from public.participant_profiles where participant_id = me;
  insert into public.participant_profiles(participant_id,photo_path,updated_at) values(me,p_path,now())
  on conflict (participant_id) do update set photo_path=excluded.photo_path,updated_at=now();
  return jsonb_build_object('participantId',me,'previous',previous,'photoPath',p_path);
end;
$$;
revoke all on function public.set_profile_photo(text,text) from public, anon, authenticated;
grant execute on function public.set_profile_photo(text,text) to service_role;

-- Dados do perfil mostrados ao organizador na leitura do QR (apelido e foto para conferir o rosto).
create function public.profile_card(p_uid text, p_participant uuid)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
begin
  if not private.is_admin(p_uid) then raise exception 'Acesso administrativo obrigatório.' using errcode = '42501'; end if;
  return (select jsonb_build_object('nickname',pr.nickname,'photoPath',pr.photo_path)
    from public.participant_profiles pr where pr.participant_id = p_participant);
end;
$$;
revoke all on function public.profile_card(text,uuid) from public, anon, authenticated;
grant execute on function public.profile_card(text,uuid) to service_role;

-- Moderação pela organização: busca perfis e remove foto ou apelido.
create function public.admin_profiles(p_uid text, p_query text default null, p_participant uuid default null, p_action text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare term text; removed text;
begin
  if not private.is_admin(p_uid) then raise exception 'Acesso administrativo obrigatório.' using errcode = '42501'; end if;
  if p_action is not null then
    if p_action = 'remove_photo' then
      -- Guarda o caminho antes de limpar, para o backend apagar o arquivo do Storage.
      select photo_path into removed from public.participant_profiles where participant_id = p_participant;
      update public.participant_profiles set photo_path = null, moderated_at = now(), updated_at = now()
      where participant_id = p_participant and photo_path is not null;
    elsif p_action = 'remove_nickname' then
      update public.participant_profiles set nickname = null, moderated_at = now(), updated_at = now()
      where participant_id = p_participant and nickname is not null;
    else raise exception 'Ação inválida.' using errcode = '22023';
    end if;
    if not found then raise exception 'Nada para remover.' using errcode = '22023'; end if;
    return jsonb_build_object('removedPhoto',removed);
  end if;
  term := lower(btrim(p_query));
  if term is null or length(term) not between 2 and 120 then raise exception 'Busca inválida.' using errcode = '22023'; end if;
  return jsonb_build_object('profiles',coalesce((select jsonb_agg(row_data order by full_name,id) from (
    select p.id,p.full_name,jsonb_build_object('participantId',p.id,'name',p.full_name,'nickname',pr.nickname,
      'headline',pr.headline,'photoPath',pr.photo_path,'moderatedAt',pr.moderated_at) as row_data
    from public.participant_profiles pr join public.participants p on p.id = pr.participant_id
    where (pr.nickname is not null or pr.photo_path is not null or pr.headline <> '' or pr.bio <> '')
      and (position(term in lower(p.full_name)) > 0 or position(term in p.email) > 0 or position(term in coalesce(pr.nickname,'')) > 0)
    order by p.full_name,p.id limit 20) matches),'[]'::jsonb));
end;
$$;
revoke all on function public.admin_profiles(text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.admin_profiles(text,text,uuid,text) to service_role;

-- Ranking: apelido no lugar do nome quando a pessoa escolheu, e a foto para quem está logado.
create or replace function public.get_badge_ranking(p_uid text)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare result jsonb;
begin
  if p_uid is null or not exists (select 1 from public.participants where firebase_uid = p_uid) then
    raise exception 'Participante não encontrado.' using errcode = '42501';
  end if;
  with counts as (
    select p.id, p.full_name, p.firebase_uid, pr.nickname, pr.show_nickname, pr.photo_path,
      count(activity.id)::integer as badge_count
    from public.participants p
    left join public.participant_profiles pr on pr.participant_id = p.id
    left join public.attendances a on a.participant_id = p.id
    left join public.activities activity on activity.id = a.activity_id and activity.active
    group by p.id, pr.participant_id
  ), ranked as (
    select *, rank() over (order by badge_count desc) as position
    from counts where badge_count > 0
  ), leaders as (
    select * from ranked order by badge_count desc, full_name, id limit 20
  )
  select jsonb_build_object(
    'entries', coalesce((select jsonb_agg(jsonb_build_object(
      'position',position,'name',private.display_name(full_name,nickname,show_nickname),'badgeCount',badge_count,
      'photoPath',photo_path,'isMe',coalesce(firebase_uid = p_uid,false)) order by badge_count desc,full_name,id)
      from leaders),'[]'::jsonb),
    'mine', (select jsonb_build_object('position',(select r.position from ranked r where r.id = c.id),
      'badgeCount',c.badge_count) from counts c where c.firebase_uid = p_uid)
  ) into result;
  return result;
end;
$$;

-- FAQ: o autor (quando não anônimo) segue a mesma escolha de apelido.
create or replace function public.manage_faq(p_uid text, p_action text, p_activity text,
  p_id uuid default null, p_body text default null, p_anonymous boolean default false,
  p_offset integer default 0)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare author uuid; affected uuid; result jsonb;
begin
  select id into author from public.participants where firebase_uid = p_uid;
  if author is null then raise exception 'Autor inválido' using errcode = '42501'; end if;
  if not exists(select 1 from public.activities where id = p_activity and active) then
    raise exception 'Atividade inválida' using errcode = '22023';
  end if;
  if p_action = 'list' then
    if p_offset is null or p_offset < 0 or p_offset > 100000 then
      raise exception 'Página inválida' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(row_data order by created_at desc, id desc), '[]'::jsonb) into result
    from (select q.id, q.created_at, jsonb_build_object(
      'id',q.id,'body',q.body,'anonymous',q.anonymous,
      'author',case when q.anonymous then 'Anônimo' else private.display_name(p.full_name,pr.nickname,pr.show_nickname) end,
      'mine',q.participant_id = author,'createdAt',q.created_at,'updatedAt',q.updated_at) as row_data
      from public.questions q join public.participants p on p.id = q.participant_id
      left join public.participant_profiles pr on pr.participant_id = p.id
      where q.activity_id = p_activity order by q.created_at desc, q.id desc limit 50 offset p_offset) page;
    return jsonb_build_object('questions',result,'hasMore',jsonb_array_length(result) = 50);
  elsif p_action in ('create','update') then
    if p_body is null or length(btrim(p_body)) not between 1 and 2000 or p_anonymous is null then
      raise exception 'Pergunta inválida' using errcode = '22023';
    end if;
    if p_action = 'create' then
      insert into public.questions(activity_id, participant_id, body, anonymous)
      values(p_activity,author,btrim(p_body),p_anonymous) returning id into affected;
    else
      update public.questions set body=btrim(p_body),anonymous=p_anonymous,updated_at=clock_timestamp()
      where id=p_id and participant_id=author and activity_id=p_activity returning id into affected;
    end if;
  elsif p_action = 'delete' then
    delete from public.questions where id=p_id and participant_id=author and activity_id=p_activity
    returning id into affected;
  else raise exception 'Ação inválida' using errcode = '22023';
  end if;
  if affected is null then raise exception 'Pergunta indisponível' using errcode = '42501'; end if;
  return jsonb_build_object('id',affected);
end;
$$;

-- Fotos de perfil: bucket privado, sem acesso direto de clientes; o backend envia e assina os links.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
    values('avatars','avatars',false,307200,array['image/webp','image/jpeg','image/png'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end;
$$;
commit;
