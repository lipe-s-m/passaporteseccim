-- Fixtures transacionais; ROLLBACK preserva participantes e presenças reais.
begin;
do $$
declare prefix text := 'admin-test-' || gen_random_uuid()::text;
begin
  perform set_config('test.admin_prefix',prefix,true);
  insert into private.admins(firebase_uid,note) values(prefix||'-admin','Fixture temporária');
  insert into public.participants(full_name,email,firebase_uid) values
    ('Ana 100% Teste',prefix||'-ana@example.invalid',prefix||'-ana'),
    ('Bruno Teste',prefix||'-bruno@example.invalid',null);
  insert into public.activities(id,name,description,category,event_date) values
    (prefix||'-1','Palestra 1','','Teste','2099-06-01'),
    (prefix||'-off','Inativa','','Teste','2099-06-01');
  update public.activities set active = false where id = prefix||'-off';
end;
$$;
set local role service_role;
do $$
declare
  prefix text := current_setting('test.admin_prefix');
  admin text := prefix||'-admin'; ana uuid; data jsonb;
begin
  data := public.admin_attendance(admin,'search',prefix||'-1',null,'100%');
  if jsonb_array_length(data->'participants') <> 1 then raise exception 'Busca literal falhou'; end if;
  ana := (data->'participants'->0->>'id')::uuid;
  if (data->'participants'->0->>'present')::boolean then raise exception 'Presença inexistente marcada'; end if;
  data := public.admin_attendance(admin,'search',prefix||'-1',null,upper(prefix||'-BRUNO'));
  if jsonb_array_length(data->'participants') <> 1 then raise exception 'Busca por e-mail falhou'; end if;

  if not (public.admin_attendance(admin,'add',prefix||'-1',ana)->>'changed')::boolean then raise exception 'Registro falhou'; end if;
  if (public.admin_attendance(admin,'add',prefix||'-1',ana)->>'changed')::boolean then raise exception 'Registro duplicado'; end if;
  if (select recorded_by from public.attendances where participant_id = ana and activity_id = prefix||'-1') <> admin then
    raise exception 'Autor do registro ausente';
  end if;
  if (select count(*) from public.raffle_entries where participant_id = ana and event_date = '2099-06-01') <> 1 then
    raise exception 'Chance de sorteio não criada';
  end if;
  data := public.admin_attendance(admin,'list',prefix||'-1');
  if (data->>'total')::int <> 1 or data->'attendees'->0->>'name' <> 'Ana 100% Teste' then raise exception 'Lista incorreta'; end if;
  data := public.admin_attendance(admin,'overview');
  if not exists(select 1 from jsonb_array_elements(data->'activities') a where a->>'id' = prefix||'-1' and (a->>'attendances')::int = 1)
    or exists(select 1 from jsonb_array_elements(data->'activities') a where a->>'id' = prefix||'-off') then
    raise exception 'Visão geral incorreta';
  end if;

  if not (public.admin_attendance(admin,'remove',prefix||'-1',ana)->>'changed')::boolean then raise exception 'Remoção falhou'; end if;
  if exists(select 1 from public.raffle_entries where participant_id = ana and activity_id = prefix||'-1') then
    raise exception 'Chance não removida';
  end if;

  begin
    perform public.admin_attendance(admin,'add',prefix||'-off',ana);
    raise exception 'Atividade inativa aceita';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_attendance(admin,'add',prefix||'-1',gen_random_uuid());
    raise exception 'Participante inexistente aceito';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_attendance(admin,'search',prefix||'-1',null,'a');
    raise exception 'Busca curta aceita';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_attendance(prefix||'-ana','add',prefix||'-1',ana);
    raise exception 'Participante comum registrou presença';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
update private.admins set active = false where firebase_uid = current_setting('test.admin_prefix')||'-admin';
set local role service_role;
do $$
begin
  begin
    perform public.admin_attendance(current_setting('test.admin_prefix')||'-admin','overview');
    raise exception 'Revogação ignorada';
  exception when insufficient_privilege then null;
  end;
  if has_table_privilege('service_role','private.admins','insert')
    or has_table_privilege('service_role','public.raffle_entries','insert') then raise exception 'Backend com escrita indevida'; end if;
end;
$$;
reset role;
do $$
declare client text;
begin
  foreach client in array array['anon','authenticated'] loop
    if has_function_privilege(client,'public.admin_attendance(text,text,text,uuid,text)','execute')
      or has_function_privilege(client,'private.is_admin(text)','execute') then raise exception 'Cliente com permissão indevida'; end if;
  end loop;
end;
$$;
rollback;
