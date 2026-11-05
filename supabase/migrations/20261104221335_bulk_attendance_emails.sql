create or replace function public.admin_person_attendances(p_uid text, p_participant uuid,
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

create function public.admin_bulk_attendance(p_uid text,p_activity text,p_emails text[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  raw_email text; clean_email text;
  valid_emails text[] := '{}'; invalid_emails jsonb := '[]'::jsonb;
  added_ids uuid[] := '{}'; added jsonb := '[]'::jsonb;
  already_present jsonb := '[]'::jsonb; not_found jsonb := '[]'::jsonb;
  duplicates integer := 0;
begin
  if not private.is_admin(p_uid) then
    raise exception 'Acesso administrativo obrigatório.' using errcode = '42501';
  end if;
  if p_activity is null or not exists(select 1 from public.activities where id=p_activity and active) then
    raise exception 'Atividade inválida.' using errcode = '22023';
  end if;
  if p_emails is null or cardinality(p_emails) not between 1 and 100
    or exists(select 1 from unnest(p_emails) e where e is null or length(e)>1000) then
    raise exception 'Informe no máximo 100 e-mails.' using errcode = '22023';
  end if;
  foreach raw_email in array p_emails loop
    clean_email := lower(btrim(raw_email));
    if length(clean_email) between 3 and 254 and clean_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      valid_emails := array_append(valid_emails,clean_email);
    else
      invalid_emails := invalid_emails || jsonb_build_array(left(btrim(raw_email),254));
    end if;
  end loop;
  select coalesce(array_agg(distinct e order by e),'{}'::text[]) into p_emails
    from unnest(valid_emails) e;
  duplicates := cardinality(valid_emails)-cardinality(p_emails);
  valid_emails := p_emails;

  with matched as (
    select p.id,p.full_name,p.email from public.participants p where p.email=any(valid_emails)
  ), inserted as (
    insert into public.attendances(participant_id,activity_id,recorded_by)
      select m.id,p_activity,p_uid from matched m
    on conflict(participant_id,activity_id) do nothing
    returning participant_id
  )
  select coalesce(array_agg(i.participant_id),'{}'::uuid[]),
    coalesce(jsonb_agg(jsonb_build_object('name',m.full_name,'email',m.email) order by m.full_name,m.email),'[]'::jsonb)
  into added_ids,added
  from inserted i join matched m on m.id=i.participant_id;

  select coalesce(jsonb_agg(jsonb_build_object('name',p.full_name,'email',p.email) order by p.full_name,p.email),'[]'::jsonb)
  into already_present
  from public.participants p join public.attendances a on a.participant_id=p.id and a.activity_id=p_activity
  where p.email=any(valid_emails) and not (p.id=any(added_ids));

  select coalesce(jsonb_agg(e order by e),'[]'::jsonb) into not_found
  from unnest(valid_emails) e where not exists(select 1 from public.participants p where p.email=e);

  return jsonb_build_object('registered',added,'alreadyPresent',already_present,
    'notFound',not_found,'invalid',invalid_emails,'duplicatesIgnored',duplicates);
end;
$$;
revoke all on function public.admin_bulk_attendance(text,text,text[]) from public,anon,authenticated;
grant execute on function public.admin_bulk_attendance(text,text,text[]) to service_role;
comment on function public.admin_bulk_attendance(text,text,text[]) is
  'Backend somente; UID Firebase autenticado e ativo em private.admins. Até 100 e-mails. Registra somente participantes encontrados, sem cadastro automático.';
