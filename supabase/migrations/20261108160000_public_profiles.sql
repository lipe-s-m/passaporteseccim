-- Perfis visíveis para outros participantes logados: busca por nome ou apelido, perfil com selos e brindes,
-- e o ranking passa a abrir o perfil. Cada pessoa pode esconder o próprio perfil em "Meu perfil".
begin;

alter table public.participant_profiles add column public_profile boolean not null default true;
comment on column public.participant_profiles.public_profile is 'Falso esconde o perfil da busca e do ranking clicável. Sem linha de perfil, vale verdadeiro.';

-- Igual à versão de 20261105090000_profiles.sql, com a chave opcional publicProfile.
create or replace function public.manage_profile(p_uid text, p_profile jsonb default null)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare me uuid; v_name text; v_nick text; v_public boolean; key text; value jsonb; profile public.participant_profiles%rowtype;
begin
  select p.id, p.full_name into me, v_name from public.participants p where p.firebase_uid = p_uid;
  if me is null then raise exception 'Participante não encontrado.' using errcode = '42501'; end if;
  if p_profile is not null then
    if jsonb_typeof(p_profile) <> 'object'
      or not (p_profile ?& array['nickname','showNickname','headline','bio','course','period','links'])
      or exists(select 1 from jsonb_object_keys(p_profile) k where k not in ('nickname','showNickname','headline','bio','course','period','links','publicProfile'))
      or jsonb_typeof(p_profile->'nickname') not in ('string','null') or jsonb_typeof(p_profile->'showNickname') <> 'boolean'
      or jsonb_typeof(p_profile->'headline') <> 'string' or jsonb_typeof(p_profile->'bio') <> 'string'
      or jsonb_typeof(p_profile->'course') <> 'string' or jsonb_typeof(p_profile->'period') <> 'string'
      or jsonb_typeof(p_profile->'links') <> 'object'
      or (p_profile ? 'publicProfile' and jsonb_typeof(p_profile->'publicProfile') <> 'boolean') then
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
    -- Sem a chave (versão anterior do site), a escolha de visibilidade já gravada continua valendo.
    v_public := case when p_profile ? 'publicProfile' then (p_profile->>'publicProfile')::boolean end;
    insert into public.participant_profiles(participant_id,nickname,show_nickname,headline,bio,course,period,links,public_profile,updated_at)
    values(me,v_nick,(p_profile->>'showNickname')::boolean,btrim(p_profile->>'headline'),btrim(p_profile->>'bio'),
      btrim(p_profile->>'course'),p_profile->>'period',p_profile->'links',coalesce(v_public,true),now())
    on conflict (participant_id) do update set nickname=excluded.nickname,show_nickname=excluded.show_nickname,
      headline=excluded.headline,bio=excluded.bio,course=excluded.course,period=excluded.period,links=excluded.links,
      public_profile=coalesce(v_public,public.participant_profiles.public_profile),updated_at=now();
  end if;
  select * into profile from public.participant_profiles where participant_id = me;
  return jsonb_build_object('name',v_name,'profile',jsonb_build_object(
    'nickname',profile.nickname,'showNickname',coalesce(profile.show_nickname,true),'headline',coalesce(profile.headline,''),
    'bio',coalesce(profile.bio,''),'course',coalesce(profile.course,''),'period',coalesce(profile.period,''),
    'links',coalesce(profile.links,'{}'::jsonb),'photoPath',profile.photo_path,'publicProfile',coalesce(profile.public_profile,true)));
end;
$$;

-- Ranking: igual a 20261108120000_dense_ranking.sql, com o id de quem tem perfil visível (para abrir o perfil).
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
      coalesce(pr.public_profile,true) as public_profile, count(activity.id)::integer as badge_count
    from public.participants p
    left join public.participant_profiles pr on pr.participant_id = p.id
    left join public.attendances a on a.participant_id = p.id
    left join public.activities activity on activity.id = a.activity_id and activity.active
    group by p.id, pr.participant_id
  ), ranked as (
    -- Numeração densa: empates dividem a posição e o próximo vem logo em seguida (1, 2, 2, 2, 3).
    select *, dense_rank() over (order by badge_count desc) as position
    from counts where badge_count > 0
  ), leaders as (
    select * from ranked order by badge_count desc, full_name, id limit 20
  )
  select jsonb_build_object(
    'entries', coalesce((select jsonb_agg(jsonb_build_object(
      'position',position,'name',private.display_name(full_name,nickname,show_nickname),'badgeCount',badge_count,
      'photoPath',photo_path,'isMe',coalesce(firebase_uid = p_uid,false),
      'id',case when public_profile or firebase_uid = p_uid then id end) order by badge_count desc,full_name,id)
      from leaders),'[]'::jsonb),
    'mine', (select jsonb_build_object('position',(select r.position from ranked r where r.id = c.id),
      'badgeCount',c.badge_count) from counts c where c.firebase_uid = p_uid)
  ) into result;
  return result;
end;
$$;

-- Busca de participantes por nome ou apelido, para quem está logado. Nunca devolve e-mail.
create function public.search_people(p_uid text, p_query text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare term text := lower(btrim(coalesce(p_query,'')));
begin
  if p_uid is null or not exists(select 1 from public.participants where firebase_uid = p_uid) then
    raise exception 'Participante não encontrado.' using errcode = '42501';
  end if;
  term := ltrim(term, '@');
  if length(term) not between 2 and 60 then raise exception 'Busca inválida.' using errcode = '22023'; end if;
  return jsonb_build_object('people',coalesce((select jsonb_agg(jsonb_build_object('participantId',m.id,'name',m.full_name,
      'nickname',m.nickname,'headline',m.headline,'photoPath',m.photo_path,'badgeCount',m.badges) order by m.badges desc,m.full_name,m.id)
    from (select p.id,p.full_name,pr.nickname,coalesce(pr.headline,'') as headline,pr.photo_path,
        (select count(*) from public.attendances a join public.activities ac on ac.id = a.activity_id and ac.active
          where a.participant_id = p.id)::integer as badges
      from public.participants p left join public.participant_profiles pr on pr.participant_id = p.id
      where coalesce(pr.public_profile,true)
        and (position(term in lower(p.full_name)) > 0 or position(term in coalesce(pr.nickname,'')) > 0)
      order by badges desc,p.full_name,p.id limit 20) m),'[]'::jsonb));
end;
$$;
revoke all on function public.search_people(text,text) from public, anon, authenticated;
grant execute on function public.search_people(text,text) to service_role;

-- Perfil de um participante para quem está logado: dados do perfil, selos e brindes recebidos
-- (sorteios em que a pessoa estava presente). Perfil escondido só aparece para a própria pessoa.
create function public.person_profile(p_uid text, p_participant uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare me uuid; person public.participants%rowtype; profile public.participant_profiles%rowtype;
begin
  select id into me from public.participants where firebase_uid = p_uid;
  if me is null then raise exception 'Participante não encontrado.' using errcode = '42501'; end if;
  select * into person from public.participants where id = p_participant;
  select * into profile from public.participant_profiles where participant_id = p_participant;
  if person.id is null or (not coalesce(profile.public_profile,true) and person.id <> me) then
    raise exception 'Perfil não encontrado.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('participantId',person.id,'name',person.full_name,'isMe',person.id = me,
    'nickname',profile.nickname,'headline',coalesce(profile.headline,''),'bio',coalesce(profile.bio,''),
    'course',coalesce(profile.course,''),'period',coalesce(profile.period,''),'links',coalesce(profile.links,'{}'::jsonb),
    'photoPath',profile.photo_path,
    'badges',coalesce((select jsonb_agg(jsonb_build_object('id',ac.id,'name',ac.name,'category',ac.category,'eventDate',ac.event_date)
        order by ac.event_date nulls last,ac.sort_order,ac.id)
      from public.attendances a join public.activities ac on ac.id = a.activity_id and ac.active
      where a.participant_id = person.id),'[]'::jsonb),
    'prizes',coalesce((select jsonb_agg(jsonb_build_object('prize',d.prize,'date',d.event_date,'sponsor',s.name) order by d.event_date,d.drawn_at)
      from public.raffle_draws d left join public.sponsors s on s.id = d.sponsor_id and s.published
      where d.participant_id = person.id and not d.absent),'[]'::jsonb));
end;
$$;
revoke all on function public.person_profile(text,uuid) from public, anon, authenticated;
grant execute on function public.person_profile(text,uuid) to service_role;

commit;
