-- Fixtures transacionais; ROLLBACK preserva participantes, presenças e avaliações reais.
begin;
do $$
declare prefix text := 'feedback-test-' || gen_random_uuid()::text; ana uuid; bia uuid;
begin
  perform set_config('test.feedback_prefix',prefix,true);
  insert into private.admins(firebase_uid,note) values(prefix||'-admin','Fixture temporária');
  insert into public.participants(full_name,email,firebase_uid) values('Ana Avaliadora',prefix||'-ana@example.invalid',prefix||'-ana') returning id into ana;
  insert into public.participants(full_name,email,firebase_uid) values('Bia Ausente',prefix||'-bia@example.invalid',prefix||'-bia') returning id into bia;
  insert into public.activities(id,name,description,category,event_date,sort_order) values
    (prefix||'-1','Palestra 1','','Teste','2099-07-01',1),(prefix||'-2','Palestra 2','','Teste','2099-07-02',2);
  insert into public.attendances(participant_id,activity_id) values(ana,prefix||'-1'),(ana,prefix||'-2'),(bia,prefix||'-2');
end;
$$;
set local role service_role;
do $$
declare prefix text := current_setting('test.feedback_prefix'); data jsonb; mine jsonb; n int;
begin
  -- Lista as palestras assistidas, ainda sem avaliação.
  data := public.manage_feedback(prefix||'-ana');
  if jsonb_array_length(data->'items') <> 2 or data->'items'->0->>'activityId' <> prefix||'-1' or data->'items'->0->'rating' <> 'null'::jsonb then
    raise exception 'Lista inicial incorreta: %', data;
  end if;
  data := public.manage_feedback(prefix||'-ana',prefix||'-1',5,'  Ótima palestra!  ');
  mine := (select i from jsonb_array_elements(data->'items') i where i->>'activityId' = prefix||'-1');
  if (mine->>'rating')::int <> 5 or mine->>'comment' <> 'Ótima palestra!' then raise exception 'Avaliação não salva: %', data; end if;
  -- Mudar a avaliação substitui a anterior.
  data := public.manage_feedback(prefix||'-ana',prefix||'-1',4,'');
  mine := (select i from jsonb_array_elements(data->'items') i where i->>'activityId' = prefix||'-1');
  if jsonb_array_length(data->'items') <> 2 or (mine->>'rating')::int <> 4 or mine->>'comment' <> '' then raise exception 'Avaliação não atualizada: %', data; end if;
  data := public.manage_feedback(prefix||'-bia',prefix||'-2',2,'Som ruim');
  begin
    perform public.manage_feedback(prefix||'-bia',prefix||'-1',5,'Não assisti');
    raise exception 'Avaliou palestra sem presença';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.manage_feedback(prefix||'-desconhecido',prefix||'-1',5,'');
    raise exception 'Conta sem cadastro avaliou';
  exception when insufficient_privilege then null;
  end;
  foreach n in array array[0,6] loop
    begin
      perform public.manage_feedback(prefix||'-ana',prefix||'-1',n,'');
      raise exception 'Nota fora de 1 a 5 aceita: %', n;
    exception when invalid_parameter_value then null;
    end;
  end loop;
  begin
    perform public.manage_feedback(prefix||'-ana',prefix||'-1',3,repeat('x',1001));
    raise exception 'Comentário longo aceito';
  exception when invalid_parameter_value then null;
  end;

  -- Organização: resumo por palestra e respostas sem identificar quem respondeu.
  data := public.admin_feedback(prefix||'-admin');
  mine := (select a from jsonb_array_elements(data->'activities') a where a->>'id' = prefix||'-2');
  if (mine->>'responses')::int <> 1 or (mine->>'attendances')::int <> 2 or (mine->>'average')::numeric <> 2
    or mine->'distribution' <> '[0,1,0,0,0]'::jsonb then
    raise exception 'Resumo incorreto: %', mine;
  end if;
  if (select count(*) from jsonb_array_elements(data->'responses') r where r->>'activityId' like prefix||'%') <> 2 then
    raise exception 'Respostas incompletas: %', data->'responses';
  end if;
  if data::text like '%Ana Avaliadora%' or data::text like '%Bia Ausente%' or data::text like '%example.invalid%'
    or data::text like '%'||prefix||'-ana%' or data::text ~ '[0-9]{2}:[0-9]{2}' then
    raise exception 'Resposta identifica quem avaliou: %', data;
  end if;
  begin
    perform public.admin_feedback(prefix||'-ana');
    raise exception 'Participante comum leu as avaliações';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Uma avaliação por pessoa e palestra; remover a presença remove a avaliação daquela palestra.
do $$
declare prefix text := current_setting('test.feedback_prefix');
begin
  if (select count(*) from public.activity_feedback where activity_id = prefix||'-1') <> 1 then raise exception 'Avaliação duplicada'; end if;
  delete from public.attendances where activity_id = prefix||'-2' and participant_id = (select id from public.participants where firebase_uid = prefix||'-bia');
  if exists(select 1 from public.activity_feedback f join public.participants p on p.id = f.participant_id where p.firebase_uid = prefix||'-bia') then
    raise exception 'Avaliação ficou sem presença';
  end if;
end;
$$;

do $$
declare client text;
begin
  foreach client in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(client,'public.activity_feedback','select') or has_table_privilege(client,'public.activity_feedback','insert') then
      raise exception 'Acesso direto a activity_feedback: %', client;
    end if;
  end loop;
  foreach client in array array['anon','authenticated'] loop
    if has_function_privilege(client,'public.manage_feedback(text,text,integer,text)','execute')
      or has_function_privilege(client,'public.admin_feedback(text)','execute') then
      raise exception 'Cliente executa função da pesquisa: %', client;
    end if;
  end loop;
end;
$$;
rollback;
