-- Fixtures transacionais; ROLLBACK preserva participantes, presenças e sorteios reais.
begin;
do $$
declare prefix text := 'draw-test-' || gen_random_uuid()::text;
begin
  perform set_config('test.draw_prefix',prefix,true);
  insert into private.admins(firebase_uid,note) values(prefix||'-admin','Fixture temporária');
  insert into public.participants(full_name,email,firebase_uid) values('Já cadastrada',prefix||'-old@example.invalid',prefix||'-old');
  insert into public.activities(id,name,description,category,event_date) values
    (prefix||'-1','Palestra 1','','Teste','2099-07-01'),
    (prefix||'-2','Palestra 2','','Teste','2099-07-01'),
    (prefix||'-3','Palestra 3','','Teste','2099-07-01');
end;
$$;
set local role service_role;
do $$
declare
  prefix text := current_setting('test.draw_prefix');
  admin text := prefix||'-admin'; data jsonb; walkin uuid; first_draw uuid; i int;
begin
  -- Cadastro na hora: cria participante sem conta e registra a presença.
  data := public.admin_register_participant(admin,prefix||'-1','  Nova Pessoa ',upper(prefix)||'-NEW@Example.invalid');
  if not (data->>'created')::boolean or not (data->>'changed')::boolean or (data->'participant'->>'linked')::boolean
    or data->'participant'->>'name' <> 'Nova Pessoa' or data->'participant'->>'email' <> prefix||'-new@example.invalid' then
    raise exception 'Cadastro na hora incorreto: %', data;
  end if;
  walkin := (data->'participant'->>'id')::uuid;
  data := public.admin_register_participant(admin,prefix||'-2','Outro nome',prefix||'-new@example.invalid');
  if (data->>'created')::boolean or not (data->>'changed')::boolean or data->'participant'->>'name' <> 'Nova Pessoa' then
    raise exception 'E-mail repetido criou cadastro ou trocou o nome';
  end if;
  data := public.admin_register_participant(admin,prefix||'-2','Nome forjado',prefix||'-old@example.invalid');
  if data->'participant'->>'name' <> 'Já cadastrada' or not (data->'participant'->>'linked')::boolean then
    raise exception 'Cadastro existente foi alterado';
  end if;
  data := public.admin_register_participant(admin,prefix||'-3','Já cadastrada',prefix||'-old@example.invalid');
  begin
    perform public.admin_register_participant(admin,prefix||'-1','Sem e-mail','invalido');
    raise exception 'E-mail inválido aceito';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_register_participant(prefix||'-old',prefix||'-1','X',prefix||'-x@example.invalid');
    raise exception 'Participante comum cadastrou';
  exception when insufficient_privilege then null;
  end;

  -- Já cadastrada tem 2 chances (palestras 2 e 3); Nova Pessoa tem 2 (1 e 2).
  data := public.admin_raffle_draw(admin,'list','2099-07-01');
  if (data->>'totalEntries')::int <> 4 or (data->>'remainingParticipants')::int <> 2 or jsonb_array_length(data->'draws') <> 0 then
    raise exception 'Estado inicial incorreto: %', data;
  end if;
  data := public.admin_raffle_draw(admin,'draw','2099-07-01','Caneca');
  first_draw := (data->>'drawnId')::uuid;
  if first_draw is null or jsonb_array_length(data->'draws') <> 1 or data->'draws'->0->>'prize' <> 'Caneca'
    or (data->'draws'->0->>'chances')::int <> 2 or jsonb_array_length(data->'reel') <> 2 then
    raise exception 'Primeiro sorteio incorreto: %', data;
  end if;
  data := public.admin_raffle_draw(admin,'draw','2099-07-01','');
  if jsonb_array_length(data->'draws') <> 2 or data->'draws'->0->>'name' = data->'draws'->1->>'name'
    or (data->>'remainingParticipants')::int <> 0 then
    raise exception 'Mesma pessoa sorteada duas vezes';
  end if;
  data := public.admin_raffle_draw(admin,'draw','2099-07-01','');
  if data->>'drawnId' is not null or jsonb_array_length(data->'draws') <> 2 then raise exception 'Sorteio sem participantes restantes'; end if;
  data := public.admin_raffle_draw(admin,'absent','2099-07-01',null,first_draw);
  if not exists(select 1 from jsonb_array_elements(data->'draws') d where (d->>'id')::uuid = first_draw and (d->>'absent')::boolean)
    or exists(select 1 from jsonb_array_elements(data->'draws') d where (d->>'id')::uuid <> first_draw and (d->>'absent')::boolean) then
    raise exception 'Ausência não registrada';
  end if;
  begin
    perform public.admin_raffle_draw(admin,'absent','2099-07-02',null,first_draw);
    raise exception 'Ausência em outro dia aceita';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_raffle_draw(admin,'delete','2099-07-02',null,first_draw);
    raise exception 'Apagar sorteio de outro dia aceito';
  exception when invalid_parameter_value then null;
  end;
  data := public.admin_raffle_draw(admin,'delete','2099-07-01',null,first_draw);
  if jsonb_array_length(data->'draws') <> 1 or (data->>'remainingParticipants')::int <> 1
    or exists(select 1 from jsonb_array_elements(data->'draws') d where (d->>'id')::uuid = first_draw) then
    raise exception 'Sorteio apagado continua valendo: %', data;
  end if;
  data := public.admin_raffle_draw(admin,'draw','2099-07-01','');
  if data->>'drawnId' is null or jsonb_array_length(data->'draws') <> 2 then raise exception 'Pessoa do sorteio apagado não voltou a concorrer'; end if;
  begin
    perform public.admin_raffle_draw(admin,'delete','2099-07-01',null,first_draw);
    raise exception 'Apagar duas vezes aceito';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_raffle_draw(admin,'draw','2099-07-01',repeat('x',121));
    raise exception 'Prêmio longo aceito';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_raffle_draw(prefix||'-old','list','2099-07-01');
    raise exception 'Participante comum listou sorteios';
  exception when insufficient_privilege then null;
  end;
  if data::text like '%@example.invalid%' then raise exception 'E-mail exposto no sorteio'; end if;
end;
$$;
reset role;

-- Ponderação: 3 chances contra 1 deve vencer perto de 75% das vezes.
do $$
declare
  prefix text := current_setting('test.draw_prefix') || '-w';
  heavy uuid; light uuid; wins int := 0; data jsonb; i int;
begin
  insert into private.admins(firebase_uid,note) values(prefix||'-admin','Fixture temporária');
  insert into public.participants(full_name,email) values('Três',prefix||'-a@example.invalid') returning id into heavy;
  insert into public.participants(full_name,email) values('Uma',prefix||'-b@example.invalid') returning id into light;
  insert into public.activities(id,name,description,category,event_date) values
    (prefix||'-1','A','','Teste','2099-08-01'),(prefix||'-2','B','','Teste','2099-08-01'),(prefix||'-3','C','','Teste','2099-08-01');
  insert into public.attendances(participant_id,activity_id) values
    (heavy,prefix||'-1'),(heavy,prefix||'-2'),(heavy,prefix||'-3'),(light,prefix||'-1');
  for i in 1..400 loop
    data := public.admin_raffle_draw(prefix||'-admin','draw','2099-08-01');
    if data->'draws'->0->>'name' = 'Três' then wins := wins + 1; end if;
    delete from public.raffle_draws where event_date = '2099-08-01';
  end loop;
  if wins not between 255 and 345 then raise exception 'Ponderação fora do esperado: % de 400', wins; end if;
end;
$$;

do $$
declare client text;
begin
  foreach client in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(client,'public.raffle_draws','select') or has_table_privilege(client,'public.raffle_draws','insert') then
      raise exception 'Acesso direto a raffle_draws: %', client;
    end if;
  end loop;
  foreach client in array array['anon','authenticated'] loop
    if has_function_privilege(client,'public.admin_raffle_draw(text,text,date,text,uuid,text)','execute')
      or has_function_privilege(client,'public.admin_register_participant(text,text,text,text)','execute') then
      raise exception 'Cliente executa função administrativa';
    end if;
  end loop;
end;
$$;
rollback;
