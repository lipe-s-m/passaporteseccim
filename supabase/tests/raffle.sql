-- Fixtures transacionais; ROLLBACK preserva participantes e presenças reais.
begin;
do $$
declare
  prefix text := 'raffle-test-' || gen_random_uuid()::text;
  a uuid; b uuid; data jsonb; ticket uuid;
begin
  perform set_config('test.raffle_prefix',prefix,true);
  insert into private.raffle_admins(firebase_uid,note) values(prefix||'-admin','Fixture temporária');
  insert into public.participants(full_name,email) values('Três chances',prefix||'a@example.invalid') returning id into a;
  insert into public.participants(full_name,email) values('Uma chance',prefix||'b@example.invalid') returning id into b;
  insert into public.activities(id,name,description,category,event_date,raffle_eligible) values
    (prefix||'-1','Palestra 1','','Teste','2099-05-05',true),
    (prefix||'-2','Palestra 2','','Teste','2099-05-05',true),
    (prefix||'-3','Palestra 3','','Teste','2099-05-05',true),
    (prefix||'-4','Outro dia','','Teste','2099-05-06',true),
    (prefix||'-off','Não elegível','','Teste','2099-05-05',false),
    (prefix||'-pending','Sem data','','Teste',null,true);
  insert into public.attendances(participant_id,activity_id,recorded_at) values
    (a,prefix||'-1','2099-05-07T02:00:00Z'),(a,prefix||'-2',now()),(a,prefix||'-3',now()),
    (b,prefix||'-1',now()),(a,prefix||'-4',now()),(a,prefix||'-off',now()),(a,prefix||'-pending',now());
  if (select count(*) from public.raffle_entries where participant_id = a and event_date = '2099-05-05') <> 3
    or (select count(*) from public.raffle_entries where participant_id = b and event_date = '2099-05-05') <> 1 then
    raise exception 'Proporção 3:1 incorreta';
  end if;
  if (select count(*) from public.raffle_entries where participant_id = a and event_date = '2099-05-06') <> 1 then raise exception 'Dias misturados'; end if;
  select id into ticket from public.raffle_entries where participant_id = a and activity_id = prefix||'-1';
  insert into public.attendances(participant_id,activity_id) values(a,prefix||'-1') on conflict do nothing;
  update public.attendances set recorded_at = now() where participant_id = a and activity_id = prefix||'-1';
  if (select id from public.raffle_entries where participant_id = a and activity_id = prefix||'-1') <> ticket then raise exception 'Chance duplicada ou recriada sem motivo'; end if;
  delete from public.attendances where participant_id = a and activity_id = prefix||'-3';
  if exists(select 1 from public.raffle_entries where participant_id = a and activity_id = prefix||'-3') then raise exception 'Remoção não propagada'; end if;
  update public.activities set event_date = '2099-05-06' where id = prefix||'-2';
  if (select event_date from public.raffle_entries where participant_id = a and activity_id = prefix||'-2') <> '2099-05-06' then raise exception 'Correção de data falhou'; end if;
  update public.activities set event_date = '2099-05-05' where id = prefix||'-pending';
  if not exists(select 1 from public.raffle_entries where participant_id = a and activity_id = prefix||'-pending') then raise exception 'Backfill de data falhou'; end if;
  update public.activities set active = false where id = prefix||'-1';
  if exists(select 1 from public.raffle_entries where activity_id = prefix||'-1') then raise exception 'Atividade inativa gera chance'; end if;
  update public.activities set active = true where id = prefix||'-1';
  if (select count(*) from public.raffle_entries where activity_id = prefix||'-1') <> 2 then raise exception 'Reativação não sincronizou'; end if;
  update public.activities set raffle_eligible = true where id = prefix||'-off';
  if not exists(select 1 from public.raffle_entries where activity_id = prefix||'-off') then raise exception 'Elegibilidade não sincronizou'; end if;
  update public.activities set event_date = null where id = prefix||'-pending';
  if exists(select 1 from public.raffle_entries where activity_id = prefix||'-pending') then raise exception 'Data removida não sincronizou'; end if;
  -- 1001 chances para verificar limite/paginação sem depender de dados reais.
  insert into public.participants(full_name,email)
    select 'Página '||i,prefix||'-page-'||i||'@example.invalid' from generate_series(1,1001) i;
  insert into public.activities(id,name,description,category,event_date) values(prefix||'-page','Paginação','','Teste','2099-05-08');
  insert into public.attendances(participant_id,activity_id)
    select id,prefix||'-page' from public.participants where email like prefix||'-page-%@example.invalid';
end;
$$;
set local role service_role;
do $$
declare prefix text := current_setting('test.raffle_prefix'); data jsonb;
begin
  data := public.get_daily_raffle(prefix||'-admin','2099-05-08',0);
  if jsonb_array_length(data->'entries') <> 1000 or not (data->>'hasMore')::boolean
    or (data->>'totalEntries')::integer < 1001 then raise exception 'Primeira página inválida'; end if;
  data := public.get_daily_raffle(prefix||'-admin','2099-05-08',1000);
  if jsonb_array_length(data->'entries') < 1 then raise exception 'Segunda página vazia'; end if;
  if data::text like '%@example.invalid%' then raise exception 'E-mail exposto'; end if;
  begin
    perform public.get_daily_raffle(prefix||'-participant','2099-05-05');
    raise exception 'Participante comum autorizado';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
update private.raffle_admins set active = false where firebase_uid = current_setting('test.raffle_prefix')||'-admin';
set local role service_role;
do $$
begin
  begin
    perform public.get_daily_raffle(current_setting('test.raffle_prefix')||'-admin','2099-05-05');
    raise exception 'Revogação ignorada';
  exception when insufficient_privilege then null;
  end;
  if has_table_privilege('service_role','private.raffle_admins','insert')
    or has_table_privilege('service_role','private.raffle_admins','update')
    or has_table_privilege('service_role','public.raffle_entries','insert') then raise exception 'Backend com escrita desnecessária'; end if;
end;
$$;
reset role;
do $$
declare client text;
begin
  foreach client in array array['anon','authenticated'] loop
    if has_function_privilege(client,'public.get_daily_raffle(text,date,integer)','execute')
      or has_table_privilege(client,'public.raffle_entries','select')
      or has_table_privilege(client,'public.raffle_entries','insert')
      or has_table_privilege(client,'private.raffle_admins','insert') then raise exception 'Cliente com permissão indevida'; end if;
  end loop;
end;
$$;
rollback;
