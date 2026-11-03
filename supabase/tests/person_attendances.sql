-- Fixtures transacionais; ROLLBACK preserva participantes e presenças reais.
begin;
do $$
declare prefix text := 'person-test-' || gen_random_uuid()::text;
begin
  perform set_config('test.person_prefix',prefix,true);
  insert into private.admins(firebase_uid,note) values(prefix||'-admin','Fixture temporária');
  insert into public.participants(full_name,email,firebase_uid) values('Pessoa Teste',prefix||'@example.invalid',prefix||'-user');
  insert into public.activities(id,name,description,category,event_date,sort_order) values
    (prefix||'-1','Palestra 1','','Teste','2099-09-01',1),
    (prefix||'-2','Palestra 2','','Teste','2099-09-01',2),
    (prefix||'-3','Palestra 3','','Teste','2099-09-01',3),
    (prefix||'-4','Outro dia','','Teste','2099-09-02',4),
    (prefix||'-off','Inativa','','Teste','2099-09-01',5);
  update public.activities set active = false where id = prefix||'-off';
end;
$$;
set local role service_role;
do $$
declare
  prefix text := current_setting('test.person_prefix');
  admin text := prefix||'-admin'; person uuid; data jsonb;
begin
  select id into person from public.participants where email = prefix||'@example.invalid';
  data := public.admin_person_attendances(admin,person);
  if jsonb_array_length(data->'activities') <> 0 or (data->>'added')::int <> 0 then raise exception 'Leitura inicial incorreta: %', data; end if;

  data := public.admin_person_attendances(admin,person,array[prefix||'-1',prefix||'-2',prefix||'-3']);
  if (data->>'added')::int <> 3 or data->'activities' <> jsonb_build_array(prefix||'-1',prefix||'-2',prefix||'-3') then
    raise exception 'Registro em lote incorreto: %', data;
  end if;
  if (select count(*) from public.raffle_entries where participant_id = person and event_date = '2099-09-01') <> 3 then
    raise exception 'Chances do sorteio não acompanharam o lote';
  end if;
  if (select count(*) from public.attendances where participant_id = person and recorded_by = admin) <> 3 then
    raise exception 'Autor do registro ausente';
  end if;

  -- Repetir o mesmo lote não duplica; adicionar e remover juntos aplica só a diferença.
  data := public.admin_person_attendances(admin,person,array[prefix||'-1',prefix||'-4'],array[prefix||'-2']);
  if (data->>'added')::int <> 1 or (data->>'removed')::int <> 1
    or data->'activities' <> jsonb_build_array(prefix||'-1',prefix||'-3',prefix||'-4') then
    raise exception 'Diferença aplicada incorretamente: %', data;
  end if;
  if exists(select 1 from public.raffle_entries where participant_id = person and activity_id = prefix||'-2') then
    raise exception 'Chance não removida';
  end if;

  begin
    perform public.admin_person_attendances(admin,person,array[prefix||'-1',prefix||'-off']);
    raise exception 'Atividade inativa aceita';
  exception when invalid_parameter_value then null;
  end;
  if (select count(*) from public.attendances where participant_id = person) <> 3 then raise exception 'Lote inválido aplicado parcialmente'; end if;
  begin
    perform public.admin_person_attendances(admin,person,array[prefix||'-1'],array[prefix||'-1']);
    raise exception 'Adicionar e remover a mesma atividade aceito';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_person_attendances(admin,person,array[prefix||'-inexistente']);
    raise exception 'Atividade inexistente aceita';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_person_attendances(admin,gen_random_uuid());
    raise exception 'Participante inexistente aceito';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_person_attendances(prefix||'-user',person,array[prefix||'-2']);
    raise exception 'Participante comum registrou presença';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
do $$
declare client text;
begin
  foreach client in array array['anon','authenticated'] loop
    if has_function_privilege(client,'public.admin_person_attendances(text,uuid,text[],text[])','execute') then
      raise exception 'Cliente executa função administrativa';
    end if;
  end loop;
end;
$$;
rollback;
