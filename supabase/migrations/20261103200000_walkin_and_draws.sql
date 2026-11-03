-- Cadastro pela organização e sorteio de ganhadores no painel.
begin;

-- A pessoa recebe o selo agora e vincula a conta depois, ao entrar com o mesmo e-mail
-- (get_firebase_passport vincula cadastros sem firebase_uid pelo e-mail verificado).
create function public.admin_register_participant(p_uid text, p_activity text, p_name text, p_email text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  person public.participants%rowtype;
  v_name text := btrim(p_name);
  v_email text := lower(btrim(p_email));
  created boolean := false;
  changed boolean;
begin
  if not private.is_admin(p_uid) then
    raise exception 'Acesso administrativo obrigatório.' using errcode = '42501';
  end if;
  if p_activity is null or not exists(select 1 from public.activities where id = p_activity and active) then
    raise exception 'Atividade inválida.' using errcode = '22023';
  end if;
  if v_name is null or length(v_name) not between 1 and 120 or v_email is null
    or length(v_email) not between 3 and 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Nome ou e-mail inválido.' using errcode = '22023';
  end if;
  -- Cadastro existente mantém o nome atual; nunca é sobrescrito pelo painel.
  insert into public.participants(full_name,email) values(v_name,v_email)
  on conflict(email) do nothing returning * into person;
  created := found;
  if not created then select * into person from public.participants where email = v_email; end if;
  insert into public.attendances(participant_id,activity_id,recorded_by) values(person.id,p_activity,p_uid)
  on conflict(participant_id,activity_id) do nothing;
  changed := found;
  return jsonb_build_object('created',created,'changed',changed,'participant',jsonb_build_object(
    'id',person.id,'name',person.full_name,'email',person.email,'linked',person.firebase_uid is not null));
end;
$$;
revoke all on function public.admin_register_participant(text,text,text,text) from public, anon, authenticated;
grant execute on function public.admin_register_participant(text,text,text,text) to service_role;
comment on function public.admin_register_participant(text,text,text,text) is
  'Backend somente: organização cadastra participante sem conta e registra a presença. Não altera cadastros existentes.';

create table public.raffle_draws (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  participant_id uuid not null references public.participants(id) on delete cascade,
  ticket_id uuid not null,
  prize text not null default '' check (length(prize) <= 120),
  absent boolean not null default false,
  drawn_by text not null check (length(drawn_by) between 1 and 128),
  drawn_at timestamptz not null default clock_timestamp(),
  unique (event_date, participant_id)
);
create index raffle_draws_day_idx on public.raffle_draws(event_date, drawn_at);
alter table public.raffle_draws enable row level security;
revoke all on public.raffle_draws from public, anon, authenticated, service_role;
comment on table public.raffle_draws is 'Ganhadores sorteados no painel. Uma vitória por pessoa e dia; ausentes continuam fora do dia.';

-- O ganhador é escolhido no banco: o navegador só anima o resultado.
-- gen_random_uuid() usa gerador criptográfico; ordenar as chances por ele
-- dá probabilidade proporcional ao número de presenças de cada pessoa no dia.
create function public.admin_raffle_draw(p_uid text, p_action text, p_date date,
  p_prize text default '', p_draw uuid default null)
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
    select e.id, e.participant_id into ticket, winner from public.raffle_entries e
    where e.event_date = p_date
      and not exists(select 1 from public.raffle_draws d where d.event_date = p_date and d.participant_id = e.participant_id)
    order by gen_random_uuid() limit 1;
    if found then
      insert into public.raffle_draws(event_date,participant_id,ticket_id,prize,drawn_by)
      values(p_date,winner,ticket,coalesce(btrim(p_prize),''),p_uid) returning id into drawn;
      select coalesce(jsonb_agg(full_name),'[]'::jsonb) into reel from (
        select p.full_name from public.participants p
        where exists(select 1 from public.raffle_entries e where e.event_date = p_date and e.participant_id = p.id)
        order by gen_random_uuid() limit 40) sample;
    end if;
  elsif p_action = 'absent' then
    update public.raffle_draws set absent = true where id = p_draw and event_date = p_date;
    if not found then raise exception 'Sorteio inexistente.' using errcode = '22023'; end if;
  elsif p_action is distinct from 'list' then
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'drawnId',drawn,
    'reel',reel,
    'draws',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',p.full_name,'prize',d.prize,'absent',d.absent,
      'drawnAt',d.drawn_at,'chances',(select count(*) from public.raffle_entries e where e.event_date = p_date and e.participant_id = d.participant_id))
      order by d.drawn_at,d.id) from public.raffle_draws d join public.participants p on p.id = d.participant_id
      where d.event_date = p_date),'[]'::jsonb),
    'remainingParticipants',(select count(distinct e.participant_id) from public.raffle_entries e where e.event_date = p_date
      and not exists(select 1 from public.raffle_draws d where d.event_date = p_date and d.participant_id = e.participant_id)),
    'totalEntries',(select count(*) from public.raffle_entries e where e.event_date = p_date));
end;
$$;
revoke all on function public.admin_raffle_draw(text,text,date,text,uuid) from public, anon, authenticated;
grant execute on function public.admin_raffle_draw(text,text,date,text,uuid) to service_role;
comment on function public.admin_raffle_draw(text,text,date,text,uuid) is
  'Backend somente: lista, sorteia (ponderado pelas chances do dia) e marca ausentes. Autorização em private.admins a cada chamada.';
commit;
