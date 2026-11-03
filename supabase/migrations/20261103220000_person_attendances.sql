-- Presenças de uma pessoa em várias atividades numa única chamada.
-- O painel envia apenas o que mudou (adicionar/remover), e não a lista final,
-- para não apagar uma presença registrada por outro organizador ao mesmo tempo.
begin;
create function public.admin_person_attendances(p_uid text, p_participant uuid,
  p_add text[] default '{}', p_remove text[] default '{}')
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare person public.participants%rowtype; added integer := 0; removed integer := 0;
begin
  if not private.is_admin(p_uid) then
    raise exception 'Acesso administrativo obrigatório.' using errcode = '42501';
  end if;
  select * into person from public.participants where id = p_participant;
  if not found then raise exception 'Participante inválido.' using errcode = '22023'; end if;
  p_add := coalesce(p_add,'{}'); p_remove := coalesce(p_remove,'{}');
  if cardinality(p_add) + cardinality(p_remove) > 50 or p_add && p_remove
    or exists(select 1 from unnest(p_add || p_remove) as requested(id)
      where not exists(select 1 from public.activities a where a.id = requested.id and a.active)) then
    raise exception 'Atividades inválidas.' using errcode = '22023';
  end if;
  -- Repetir uma presença não duplica selo nem chance de sorteio.
  insert into public.attendances(participant_id,activity_id,recorded_by)
    select person.id, requested.id, p_uid from unnest(p_add) as requested(id)
  on conflict(participant_id,activity_id) do nothing;
  get diagnostics added = row_count;
  delete from public.attendances where participant_id = person.id and activity_id = any(p_remove);
  get diagnostics removed = row_count;
  return jsonb_build_object('added',added,'removed',removed,
    'participant',jsonb_build_object('id',person.id,'name',person.full_name,'email',person.email),
    'activities',coalesce((select jsonb_agg(t.activity_id order by a.sort_order,a.id) from public.attendances t
      join public.activities a on a.id = t.activity_id and a.active where t.participant_id = person.id),'[]'::jsonb));
end;
$$;
revoke all on function public.admin_person_attendances(text,uuid,text[],text[]) from public, anon, authenticated;
grant execute on function public.admin_person_attendances(text,uuid,text[],text[]) to service_role;
comment on function public.admin_person_attendances(text,uuid,text[],text[]) is
  'Backend somente: lê e altera presenças de uma pessoa em várias atividades de uma vez. Autorização em private.admins a cada chamada.';
commit;
