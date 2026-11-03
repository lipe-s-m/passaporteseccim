-- Painel da organização: registro de presenças pelo backend.
-- A permissão é consultada a cada chamada; revogar tem efeito imediato.
begin;

-- A mesma lista passa a autorizar presenças e sorteios.
alter table private.raffle_admins rename to admins;
comment on table private.admins is 'Contas da organização: registram presenças e exportam sorteios. Somente o dono do banco concede/revoga; nunca por metadados do usuário.';

alter table public.attendances add column recorded_by text check (length(recorded_by) between 1 and 128);
comment on column public.attendances.recorded_by is 'UID Firebase da conta da organização que registrou pelo painel; nulo para baixas pelo Dashboard ou importação.';

create function private.is_admin(p_uid text)
returns boolean language sql stable security invoker set search_path = ''
as $$ select p_uid is not null and exists(select 1 from private.admins where firebase_uid = p_uid and active) $$;
revoke all on function private.is_admin(text) from public, anon, authenticated;
grant execute on function private.is_admin(text) to service_role;

-- Mesmo comportamento anterior; somente a verificação aponta para a lista renomeada.
create or replace function public.get_daily_raffle(p_uid text,p_date date,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare result jsonb;
begin
  if not private.is_admin(p_uid) then
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

-- SECURITY DEFINER: o backend continua sem grants de escrita em presenças e chances.
-- A função só age após confirmar a conta em private.admins.
create function public.admin_attendance(p_uid text, p_action text, p_activity text default null,
  p_participant uuid default null, p_query text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare result jsonb; term text; changed boolean;
begin
  if not private.is_admin(p_uid) then
    raise exception 'Acesso administrativo obrigatório.' using errcode = '42501';
  end if;
  if p_action = 'overview' then
    return jsonb_build_object(
      'participants',(select count(*) from public.participants),
      'activities',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'eventDate',a.event_date,
        'raffleEligible',a.raffle_eligible,
        'attendances',(select count(*) from public.attendances t where t.activity_id = a.id))
        order by a.sort_order,a.id) from public.activities a where a.active),'[]'::jsonb));
  end if;
  if p_activity is null or not exists(select 1 from public.activities where id = p_activity and active) then
    raise exception 'Atividade inválida.' using errcode = '22023';
  end if;
  if p_action = 'search' then
    term := lower(btrim(p_query));
    if term is null or length(term) not between 2 and 120 then
      raise exception 'Busca inválida.' using errcode = '22023';
    end if;
    -- position() evita tratar % e _ digitados como curingas.
    select coalesce(jsonb_agg(row_data order by full_name,id),'[]'::jsonb) into result from (
      select p.id,p.full_name,jsonb_build_object('id',p.id,'name',p.full_name,'email',p.email,
        'present',exists(select 1 from public.attendances t where t.participant_id = p.id and t.activity_id = p_activity)) as row_data
      from public.participants p
      where position(term in lower(p.full_name)) > 0 or position(term in p.email) > 0
      order by p.full_name,p.id limit 20) matches;
    return jsonb_build_object('participants',result);
  elsif p_action = 'list' then
    select coalesce(jsonb_agg(row_data order by recorded_at desc,id),'[]'::jsonb) into result from (
      select p.id,t.recorded_at,jsonb_build_object('id',p.id,'name',p.full_name,'email',p.email,'recordedAt',t.recorded_at) as row_data
      from public.attendances t join public.participants p on p.id = t.participant_id
      where t.activity_id = p_activity order by t.recorded_at desc,p.id limit 1000) recent;
    return jsonb_build_object('total',(select count(*) from public.attendances where activity_id = p_activity),
      'attendees',result);
  elsif p_action in ('add','remove') then
    if p_participant is null or not exists(select 1 from public.participants where id = p_participant) then
      raise exception 'Participante inválido.' using errcode = '22023';
    end if;
    if p_action = 'add' then
      -- Repetir a baixa não duplica selo nem chance de sorteio.
      insert into public.attendances(participant_id,activity_id,recorded_by) values(p_participant,p_activity,p_uid)
      on conflict(participant_id,activity_id) do nothing;
    else
      delete from public.attendances where participant_id = p_participant and activity_id = p_activity;
    end if;
    changed := found;
    return jsonb_build_object('changed',changed);
  end if;
  raise exception 'Ação inválida.' using errcode = '22023';
end;
$$;
revoke all on function public.admin_attendance(text,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.admin_attendance(text,text,text,uuid,text) to service_role;
comment on function public.admin_attendance(text,text,text,uuid,text) is
  'Backend somente: UID validado no Firebase e autorizado em private.admins. Lista, busca, registra e remove presenças.';
commit;
