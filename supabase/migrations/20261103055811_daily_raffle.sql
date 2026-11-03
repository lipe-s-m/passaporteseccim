-- Datas são do evento (calendário de São Paulo), nunca da digitação da presença.
alter table public.activities add column event_date date;
alter table public.activities add column raffle_eligible boolean not null default true;
comment on column public.activities.event_date is 'Dia real da atividade, no calendário America/Sao_Paulo. Configurar antes do sorteio.';
comment on column public.activities.raffle_eligible is 'Define se a presença nesta atividade gera uma chance no sorteio do dia.';

create table private.raffle_admins (
  firebase_uid text primary key check (length(firebase_uid) between 1 and 128),
  active boolean not null default true,
  note text not null default '' check (length(note) <= 200),
  created_at timestamptz not null default now()
);
alter table private.raffle_admins enable row level security;
revoke all on private.raffle_admins from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant select on private.raffle_admins to service_role;
comment on table private.raffle_admins is 'Permissão de leitura de sorteios. Somente o dono do banco pode conceder/revogar; nunca por metadados do usuário.';

create table public.raffle_entries (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null,
  activity_id text not null,
  event_date date not null,
  created_at timestamptz not null default now(),
  unique (participant_id, activity_id),
  foreign key (participant_id,activity_id) references public.attendances(participant_id,activity_id)
    on delete cascade on update cascade
);
create index raffle_entries_day_id_idx on public.raffle_entries(event_date,id);
create index raffle_entries_activity_id_idx on public.raffle_entries(activity_id);
alter table public.raffle_entries enable row level security;
revoke all on public.raffle_entries from public, anon, authenticated, service_role;
grant select on public.raffle_entries to service_role;
comment on table public.raffle_entries is 'Uma chance por presença elegível. Sincronização transacional por triggers; clientes não podem ler nem escrever diretamente.';

create function private.sync_attendance_raffle()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare activity public.activities%rowtype;
begin
  select * into activity from public.activities where id = new.activity_id for share;
  if activity.active and activity.raffle_eligible and activity.event_date is not null then
    insert into public.raffle_entries(participant_id,activity_id,event_date)
      values(new.participant_id,new.activity_id,activity.event_date)
    on conflict(participant_id,activity_id) do update set event_date = excluded.event_date
      where public.raffle_entries.event_date is distinct from excluded.event_date;
  else
    delete from public.raffle_entries where participant_id = new.participant_id and activity_id = new.activity_id;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_attendance_raffle() from public,anon,authenticated,service_role;
create trigger attendance_raffle_sync after insert or update on public.attendances
  for each row execute function private.sync_attendance_raffle();

create function private.sync_activity_raffle()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.active and new.raffle_eligible and new.event_date is not null then
    insert into public.raffle_entries(participant_id,activity_id,event_date)
      select participant_id,activity_id,new.event_date from public.attendances where activity_id = new.id
    on conflict(participant_id,activity_id) do update set event_date = excluded.event_date
      where public.raffle_entries.event_date is distinct from excluded.event_date;
  else
    delete from public.raffle_entries where activity_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_activity_raffle() from public,anon,authenticated,service_role;
create trigger activity_raffle_sync after update of event_date,raffle_eligible,active on public.activities
  for each row execute function private.sync_activity_raffle();

-- Também cobre presenças preexistentes com data conhecida, sem inventar datas.
insert into public.raffle_entries(participant_id,activity_id,event_date)
  select a.participant_id,a.activity_id,b.event_date from public.attendances a
  join public.activities b on b.id = a.activity_id
  where b.active and b.raffle_eligible and b.event_date is not null
on conflict(participant_id,activity_id) do nothing;

create function public.get_daily_raffle(p_uid text,p_date date,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare result jsonb;
begin
  -- Consulta a permissão atual em cada GET: revogação tem efeito imediato.
  if p_uid is null or not exists(select 1 from private.raffle_admins where firebase_uid = p_uid and active) then
    raise exception 'Acesso administrativo obrigatório.' using errcode = '42501';
  end if;
  if p_date is null or p_offset is null or p_offset < 0 then
    raise exception 'Data ou paginação inválida.' using errcode = '22023';
  end if;
  with eligible as (
    select e.id,e.participant_id,e.activity_id,p.full_name,a.name as activity_name
    from public.raffle_entries e
    join public.participants p on p.id = e.participant_id
    join public.activities a on a.id = e.activity_id
    where e.event_date = p_date
  ), page as (select * from eligible order by id limit 1000 offset p_offset)
  select jsonb_build_object(
    'date',p_date,'timezone','America/Sao_Paulo','offset',p_offset,'pageSize',1000,
    'totalEntries',(select count(*) from eligible),
    'uniqueParticipants',(select count(distinct participant_id) from eligible),
    'hasMore',(select count(*) > p_offset::bigint + 1000 from eligible),
    'nextOffset',case when (select count(*) > p_offset::bigint + 1000 from eligible) then p_offset + 1000 else null end,
    'entries',coalesce((select jsonb_agg(jsonb_build_object('ticketId',id,'participantId',participant_id,
      'name',full_name,'activityId',activity_id,'activityName',activity_name) order by id) from page),'[]'::jsonb),
    'unconfiguredActivities',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by sort_order,id)
      from public.activities where active and raffle_eligible and event_date is null),'[]'::jsonb),
    'pendingAttendances',(select count(*) from public.attendances t join public.activities a on a.id = t.activity_id
      where a.active and a.raffle_eligible and a.event_date is null)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_daily_raffle(text,date,integer) from public,anon,authenticated;
grant execute on function public.get_daily_raffle(text,date,integer) to service_role;
comment on function public.get_daily_raffle(text,date,integer) is 'Backend somente: UID validado no Firebase e autorizado em private.raffle_admins. Exportação de chances do dia, não executa sorteio.';
