-- Permite à organização apagar sorteios de teste ou feitos por engano.
-- Mesma função anterior, com a ação 'delete'.
begin;
create or replace function public.admin_raffle_draw(p_uid text, p_action text, p_date date,
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
  'Backend somente: lista, sorteia (ponderado pelas chances do dia), marca ausentes e apaga sorteios. Autorização em private.admins a cada chamada.';
commit;
