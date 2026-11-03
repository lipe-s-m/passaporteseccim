-- Executar como postgres após as duas migrações e o seed. Fixtures revertidas.
begin;
insert into public.participants(email,full_name) values ('seccim-security-a@example.invalid','Nome importado');
set local role service_role;
do $$ declare result jsonb; begin
  result := public.get_firebase_passport('firebase-test-a','seccim-security-a@example.invalid','Nome novo');
  if result->'participant'->>'full_name' <> 'Nome importado' then raise exception 'FALHA: nome importado alterado'; end if;
  perform public.get_firebase_passport('firebase-test-b','seccim-security-b@example.invalid','Pessoa B');
  begin
    perform public.get_firebase_passport('firebase-test-c','seccim-security-a@example.invalid','Outra pessoa');
    raise exception 'FALHA: reivindicou cadastro de outra identidade';
  exception when unique_violation then null; end;
  begin
    perform public.get_firebase_passport('', 'a@example.invalid', 'Nome');
    raise exception 'FALHA: identidade vazia';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
insert into public.attendances(participant_id,activity_id)
select id,'mesa-redonda' from public.participants where firebase_uid = 'firebase-test-a';
insert into public.attendances(participant_id,activity_id)
select id,'kafka-alem-das-filas' from public.participants where firebase_uid = 'firebase-test-b';
set local role service_role;
do $$ declare a jsonb; b jsonb; begin
  a := public.get_firebase_passport('firebase-test-a','seccim-security-a@example.invalid','Nome');
  b := public.get_firebase_passport('firebase-test-b','seccim-security-b@example.invalid','Nome');
  if a->'earnedBadges' <> '["mesa-redonda"]'::jsonb or b->'earnedBadges' <> '["kafka-alem-das-filas"]'::jsonb then
    raise exception 'FALHA: presenças misturadas'; end if;
  if a->'participant'->>'id' = b->'participant'->>'id' then raise exception 'FALHA: identidade misturada'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  if not exists(select 1 from public.activities) or not exists(select 1 from public.site_content) then raise exception 'FALHA: catálogo inacessível'; end if;
  begin
    perform * from public.participants;
    raise exception 'FALHA: visitante leu dados privados';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_firebase_passport('firebase-test-a','seccim-security-a@example.invalid','Nome');
    raise exception 'FALHA: visitante chamou RPC administrativa';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform * from public.participants;
    raise exception 'FALHA: cliente leu cadastro fora do backend';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.attendances;
    raise exception 'FALHA: cliente leu presenças fora do backend';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_firebase_passport('firebase-test-b','seccim-security-b@example.invalid','Nome');
    raise exception 'FALHA: cliente escolheu outra identidade';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare t text; r text; privilege text; begin
  foreach t in array array['site_content','activities','participants','attendances'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'FALHA: RLS desativado em %',t; end if;
    foreach r in array array['anon','authenticated'] loop
      foreach privilege in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        if has_table_privilege(r, 'public.' || t, privilege) then raise exception 'FALHA: % tem % em %',r,privilege,t; end if;
      end loop;
    end loop;
  end loop;
end $$;
rollback;
select 'Testes Firebase/Supabase concluídos; fixtures revertidas.' as resultado;
