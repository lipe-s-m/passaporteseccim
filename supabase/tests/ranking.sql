-- Fixtures isoladas e revertidas ao final; não altera presenças reais.
begin;
do $$
declare
  prefix text := 'ranking-test-' || gen_random_uuid()::text;
  a uuid; b uuid; c uuid; z uuid;
  result jsonb; pos_a integer; pos_b integer; pos_c integer;
begin
  insert into public.activities(id,name,description,category,sort_order,active) values
    (prefix||'-1','Teste 1','Teste','Teste',9001,true),
    (prefix||'-2','Teste 2','Teste','Teste',9002,true),
    (prefix||'-off','Inativa','Teste','Teste',9003,false);
  insert into public.participants(full_name,email,firebase_uid) values('Teste A',prefix||'a@example.invalid',prefix||'-a') returning id into a;
  insert into public.participants(full_name,email,firebase_uid) values('Teste B',prefix||'b@example.invalid',prefix||'-b') returning id into b;
  insert into public.participants(full_name,email,firebase_uid) values('Teste C',prefix||'c@example.invalid',prefix||'-c') returning id into c;
  insert into public.participants(full_name,email,firebase_uid) values('Teste zero',prefix||'z@example.invalid',prefix||'-z') returning id into z;
  insert into public.attendances(participant_id,activity_id) values
    (a,prefix||'-1'),(a,prefix||'-2'),(a,prefix||'-off'),
    (b,prefix||'-1'),(b,prefix||'-2'),(c,prefix||'-1');
  result := public.get_badge_ranking(prefix||'-a');
  pos_a := (result->'mine'->>'position')::integer;
  if (result->'mine'->>'badgeCount')::integer <> 2 then raise exception 'Conta atividade inativa'; end if;
  -- O id do participante aparece para abrir o perfil (20261108160000); e-mail e UID do Firebase nunca.
  if result::text like '%@example.invalid%' or result::text like '%'||prefix||'%' then raise exception 'Dados privados expostos'; end if;
  result := public.get_badge_ranking(prefix||'-b'); pos_b := (result->'mine'->>'position')::integer;
  result := public.get_badge_ranking(prefix||'-c'); pos_c := (result->'mine'->>'position')::integer;
  -- Empate divide a posição e o próximo vem logo em seguida, sem pular (1, 1, 2).
  if pos_a <> pos_b or pos_c <> pos_a + 1 then raise exception 'Empate incorreto: % % %', pos_a, pos_b, pos_c; end if;
  result := public.get_badge_ranking(prefix||'-z');
  if result->'mine'->'position' <> 'null'::jsonb or (result->'mine'->>'badgeCount')::integer <> 0 then raise exception 'Zero incorreto'; end if;
  begin
    perform public.get_badge_ranking(prefix||'-missing');
    raise exception 'Identidade inexistente aceita';
  exception when insufficient_privilege then null;
  end;
  if has_function_privilege('anon','public.get_badge_ranking(text)','execute')
    or has_function_privilege('authenticated','public.get_badge_ranking(text)','execute')
    or not has_function_privilege('service_role','public.get_badge_ranking(text)','execute') then
    raise exception 'Grants incorretos';
  end if;
end;
$$;
rollback;
