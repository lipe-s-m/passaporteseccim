-- Executada apenas pelo backend após validar a identidade no Firebase.
create function public.get_badge_ranking(p_uid text)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare result jsonb;
begin
  if p_uid is null or not exists (select 1 from public.participants where firebase_uid = p_uid) then
    raise exception 'Participante não encontrado.' using errcode = '42501';
  end if;
  with counts as (
    select p.id, p.full_name, p.firebase_uid,
      count(activity.id)::integer as badge_count
    from public.participants p
    left join public.attendances a on a.participant_id = p.id
    left join public.activities activity on activity.id = a.activity_id and activity.active
    group by p.id
  ), ranked as (
    select *, rank() over (order by badge_count desc) as position
    from counts where badge_count > 0
  ), leaders as (
    select * from ranked order by badge_count desc, full_name, id limit 20
  )
  select jsonb_build_object(
    'entries', coalesce((select jsonb_agg(jsonb_build_object(
      'position',position,'name',full_name,'badgeCount',badge_count,
      'isMe',coalesce(firebase_uid = p_uid,false)) order by badge_count desc,full_name,id)
      from leaders),'[]'::jsonb),
    'mine', (select jsonb_build_object('position',(select r.position from ranked r where r.id = c.id),
      'badgeCount',c.badge_count) from counts c where c.firebase_uid = p_uid)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_badge_ranking(text) from public, anon, authenticated;
grant execute on function public.get_badge_ranking(text) to service_role;
comment on function public.get_badge_ranking(text) is
  'Ranking somente para backend autenticado. Não retorna e-mails nem identificadores internos. Conta apenas atividades ativas.';
