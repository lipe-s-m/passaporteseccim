-- Patrocinadores: página pública, edição pelo painel da organização e brindes do sorteio.
-- Todos têm o mesmo destaque: não há cotas nem ordem manual, a página ordena pelo nome.
begin;

create table public.sponsors (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(id) <= 60),
  name text not null check (length(btrim(name)) between 1 and 120),
  tagline text not null default '' check (length(tagline) <= 240),
  about text not null default '' check (length(about) <= 2000),
  contributions jsonb not null default '[]'::jsonb check (jsonb_typeof(contributions) = 'array' and jsonb_array_length(contributions) <= 20),
  logo_url text check (logo_url is null or (length(logo_url) <= 2048 and (
    logo_url ~ '^https://res[.]cloudinary[.]com/[[:graph:]]+$'
    or logo_url ~ '^/fotos/patrocinadores/[a-z0-9]+(-[a-z0-9]+)*[.](webp|jpg|png)$'))),
  photos jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 12),
  links jsonb not null default '{}'::jsonb check (jsonb_typeof(links) = 'object' and length(links::text) <= 4000),
  -- Só aparece no site depois de publicado: permite revisar e mandar a prévia ao patrocinador antes.
  published boolean not null default false,
  content_revision integer not null default 0,
  updated_at timestamptz
);
alter table public.sponsors enable row level security;
revoke all on public.sponsors from public, anon, authenticated, service_role;
grant select on public.sponsors to anon, authenticated;
create policy sponsors_read_published on public.sponsors for select to anon, authenticated using (published);
comment on table public.sponsors is 'Patrocinadores. Leitura pública apenas dos publicados; escrita somente pela RPC admin_sponsors.';

-- Autoria das edições fica privada, como no editor das palestras.
create table private.sponsor_audit (
  sponsor_id text not null references public.sponsors(id) on delete cascade,
  revision integer not null check (revision > 0),
  updated_by text not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (sponsor_id, revision)
);
alter table private.sponsor_audit enable row level security;
revoke all on private.sponsor_audit from public, anon, authenticated, service_role;

create function private.sponsor_photo_ok(p_url text) returns boolean language sql immutable set search_path = ''
as $$ select p_url is not null and length(p_url) <= 2048 and (p_url ~ '^https://res[.]cloudinary[.]com/[[:graph:]]+$'
  or p_url ~ '^/fotos/patrocinadores/[a-z0-9]+(-[a-z0-9]+)*[.](webp|jpg|png)$') $$;
revoke all on function private.sponsor_photo_ok(text) from public, anon, authenticated;

-- Lista (sem p_content), cria (p_revision nulo) ou altera (p_revision igual ao atual).
create function public.admin_sponsors(p_uid text, p_id text default null, p_content jsonb default null, p_revision integer default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare sponsor public.sponsors%rowtype; item jsonb; key text; value jsonb;
begin
  if not private.is_admin(p_uid) then
    raise exception 'Acesso administrativo obrigatório.' using errcode = '42501';
  end if;
  if p_content is not null then
    if p_id is null or p_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_id) > 60 then
      raise exception 'Identificador inválido.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_content) <> 'object'
      or not (p_content ?& array['name','tagline','about','contributions','logo_url','photos','links','published'])
      or exists(select 1 from jsonb_object_keys(p_content) k where k not in ('name','tagline','about','contributions','logo_url','photos','links','published')) then
      raise exception 'Campos inválidos.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_content->'name') <> 'string' or jsonb_typeof(p_content->'tagline') <> 'string'
      or jsonb_typeof(p_content->'about') <> 'string' or jsonb_typeof(p_content->'published') <> 'boolean'
      or length(btrim(p_content->>'name')) not between 1 and 120 or length(p_content->>'tagline') > 240
      or length(p_content->>'about') > 2000 then
      raise exception 'Texto inválido.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_content->'logo_url') not in ('string','null')
      or (p_content->>'logo_url' is not null and not private.sponsor_photo_ok(p_content->>'logo_url')) then
      raise exception 'Logo inválido.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_content->'contributions') <> 'array' or jsonb_array_length(p_content->'contributions') > 20 then
      raise exception 'Entregas inválidas.' using errcode = '22023';
    end if;
    for item in select * from jsonb_array_elements(p_content->'contributions') loop
      if jsonb_typeof(item) <> 'string' or length(btrim(item#>>'{}')) not between 1 and 200 then
        raise exception 'Entrega inválida.' using errcode = '22023';
      end if;
    end loop;
    if jsonb_typeof(p_content->'photos') <> 'array' or jsonb_array_length(p_content->'photos') > 12 then
      raise exception 'Fotos inválidas.' using errcode = '22023';
    end if;
    for item in select * from jsonb_array_elements(p_content->'photos') loop
      if jsonb_typeof(item) <> 'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('url','caption'))
        or jsonb_typeof(item->'url') <> 'string' or not private.sponsor_photo_ok(item->>'url')
        or jsonb_typeof(coalesce(item->'caption','""'::jsonb)) <> 'string' or length(coalesce(item->>'caption','')) > 160 then
        raise exception 'Foto inválida.' using errcode = '22023';
      end if;
    end loop;
    if jsonb_typeof(p_content->'links') <> 'object' or length((p_content->'links')::text) > 4000 then
      raise exception 'Links inválidos.' using errcode = '22023';
    end if;
    for key, value in select * from jsonb_each(p_content->'links') loop
      if key not in ('site','linkedin','instagram','youtube','vagas') or jsonb_typeof(value) <> 'string'
        or (value#>>'{}') !~ '^https://[^[:space:]]+$' or length(value#>>'{}') > 2048 then
        raise exception 'Link inválido.' using errcode = '22023';
      end if;
    end loop;

    if p_revision is null then
      insert into public.sponsors(id,name,tagline,about,contributions,logo_url,photos,links,published,content_revision,updated_at)
      values(p_id,btrim(p_content->>'name'),p_content->>'tagline',p_content->>'about',p_content->'contributions',
        p_content->>'logo_url',p_content->'photos',p_content->'links',(p_content->>'published')::boolean,1,clock_timestamp())
      on conflict (id) do nothing returning * into sponsor;
      if not found then raise exception 'Já existe um patrocinador com esse identificador.' using errcode = '40001'; end if;
    else
      update public.sponsors set name=btrim(p_content->>'name'),tagline=p_content->>'tagline',about=p_content->>'about',
        contributions=p_content->'contributions',logo_url=p_content->>'logo_url',photos=p_content->'photos',links=p_content->'links',
        published=(p_content->>'published')::boolean,content_revision=content_revision+1,updated_at=clock_timestamp()
      where id = p_id and content_revision = p_revision returning * into sponsor;
      if not found then raise exception 'Patrocinador alterado por outra pessoa. Recarregue antes de salvar.' using errcode = '40001'; end if;
    end if;
    insert into private.sponsor_audit(sponsor_id,revision,updated_by) values(sponsor.id,sponsor.content_revision,p_uid);
  end if;
  return jsonb_build_object('sponsor',case when sponsor.id is null then null else to_jsonb(sponsor) end,
    'sponsors',coalesce((select jsonb_agg(to_jsonb(s) order by lower(s.name),s.id) from public.sponsors s),'[]'::jsonb));
end;
$$;
revoke all on function public.admin_sponsors(text,text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.admin_sponsors(text,text,jsonb,integer) to service_role;
comment on function public.admin_sponsors(text,text,jsonb,integer) is
  'Backend somente: lista, cria e altera patrocinadores com revisão otimista. Autorização em private.admins a cada chamada.';

-- Brinde do sorteio pode indicar quem o ofereceu.
alter table public.raffle_draws add column sponsor_id text references public.sponsors(id) on update cascade on delete set null;

drop function public.admin_raffle_draw(text,text,date,text,uuid);
create function public.admin_raffle_draw(p_uid text, p_action text, p_date date,
  p_prize text default '', p_draw uuid default null, p_sponsor text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare ticket uuid; winner uuid; drawn uuid; reel jsonb := '[]'::jsonb;
begin
  if not private.is_admin(p_uid) then
    raise exception 'Acesso administrativo obrigatório.' using errcode = '42501';
  end if;
  if p_date is null then raise exception 'Data inválida.' using errcode = '22023'; end if;
  -- Serializa sorteios do mesmo dia entre organizadores.
  perform pg_advisory_xact_lock(hashtext('seccim-raffle'), hashtext(p_date::text));
  if p_action = 'draw' then
    if length(coalesce(btrim(p_prize),'')) > 120 then raise exception 'Prêmio inválido.' using errcode = '22023'; end if;
    if p_sponsor is not null and not exists(select 1 from public.sponsors where id = p_sponsor) then
      raise exception 'Patrocinador inválido.' using errcode = '22023';
    end if;
    select e.id, e.participant_id into ticket, winner from public.raffle_entries e
    where e.event_date = p_date
      and not exists(select 1 from public.raffle_draws d where d.event_date = p_date and d.participant_id = e.participant_id)
    order by gen_random_uuid() limit 1;
    if found then
      insert into public.raffle_draws(event_date,participant_id,ticket_id,prize,drawn_by,sponsor_id)
      values(p_date,winner,ticket,coalesce(btrim(p_prize),''),p_uid,p_sponsor) returning id into drawn;
      select coalesce(jsonb_agg(full_name),'[]'::jsonb) into reel from (
        select p.full_name from public.participants p
        where exists(select 1 from public.raffle_entries e where e.event_date = p_date and e.participant_id = p.id)
        order by gen_random_uuid() limit 40) sample;
    end if;
  elsif p_action = 'absent' then
    update public.raffle_draws set absent = true where id = p_draw and event_date = p_date;
    if not found then raise exception 'Sorteio inexistente.' using errcode = '22023'; end if;
  elsif p_action = 'delete' then
    -- Desfaz sorteios de teste ou feitos por engano: a pessoa volta a concorrer no dia.
    delete from public.raffle_draws where id = p_draw and event_date = p_date;
    if not found then raise exception 'Sorteio inexistente.' using errcode = '22023'; end if;
  elsif p_action is distinct from 'list' then
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'drawnId',drawn,
    'reel',reel,
    'draws',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',p.full_name,'prize',d.prize,'absent',d.absent,
      'sponsor',s.name,'drawnAt',d.drawn_at,
      'chances',(select count(*) from public.raffle_entries e where e.event_date = p_date and e.participant_id = d.participant_id))
      order by d.drawn_at,d.id) from public.raffle_draws d join public.participants p on p.id = d.participant_id
      left join public.sponsors s on s.id = d.sponsor_id
      where d.event_date = p_date),'[]'::jsonb),
    'remainingParticipants',(select count(distinct e.participant_id) from public.raffle_entries e where e.event_date = p_date
      and not exists(select 1 from public.raffle_draws d where d.event_date = p_date and d.participant_id = e.participant_id)),
    'totalEntries',(select count(*) from public.raffle_entries e where e.event_date = p_date));
end;
$$;
revoke all on function public.admin_raffle_draw(text,text,date,text,uuid,text) from public, anon, authenticated;
grant execute on function public.admin_raffle_draw(text,text,date,text,uuid,text) to service_role;
comment on function public.admin_raffle_draw(text,text,date,text,uuid,text) is
  'Backend somente: lista, sorteia (ponderado pelas chances do dia), marca ausentes e apaga sorteios; o brinde pode indicar o patrocinador. Autorização em private.admins a cada chamada.';
commit;
