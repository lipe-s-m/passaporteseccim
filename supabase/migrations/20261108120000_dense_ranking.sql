-- Ranking sem pular posições depois de empates (antes: 1, 2, 2, 2, 5; agora: 1, 2, 2, 2, 3).
begin;
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
    -- Numeração densa: empates dividem a posição e o próximo vem logo em seguida (1, 2, 2, 2, 3).
    select *, dense_rank() over (order by badge_count desc) as position
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
commit;
