-- Não deixa dados de teste persistidos.
begin;
do $$
declare activity text; question uuid; answer jsonb;
begin
  select id into activity from public.activities where active limit 1;
  if activity is null then raise exception 'Catálogo necessário para o teste'; end if;
  insert into public.participants(full_name,email,firebase_uid) values
    ('Autor FAQ teste','faq-test-a@example.invalid','faq-test-a'),
    ('Leitor FAQ teste','faq-test-b@example.invalid','faq-test-b');
  answer := public.manage_faq('faq-test-a','create',activity,null,'Pergunta anônima',true);
  question := (answer->>'id')::uuid;
  answer := public.manage_faq('faq-test-b','list',activity);
  if not exists(select 1 from jsonb_array_elements(answer->'questions') q
    where q->>'id'=question::text and q->>'author'='Anônimo' and q->>'mine'='false'
      and not q ? 'participant_id' and not q ? 'email') then
    raise exception 'Anonimato falhou';
  end if;
  begin
    perform public.manage_faq('faq-test-b','update',activity,question,'Ataque',false);
    raise exception 'Edição indevida permitida';
  exception when insufficient_privilege then null; end;
  begin
    perform public.manage_faq('faq-test-b','delete',activity,question);
    raise exception 'Exclusão indevida permitida';
  exception when insufficient_privilege then null; end;
  perform public.manage_faq('faq-test-a','update',activity,question,'Pergunta identificada',false);
  answer := public.manage_faq('faq-test-b','list',activity);
  if not exists(select 1 from jsonb_array_elements(answer->'questions') q
    where q->>'id'=question::text and q->>'author'='Autor FAQ teste' and q->>'body'='Pergunta identificada') then
    raise exception 'Edição pelo autor falhou'; end if;
  begin
    perform public.manage_faq('faq-test-a','create',activity,null,'   ',true);
    raise exception 'Pergunta vazia permitida';
  exception when invalid_parameter_value then null; end;
  perform public.manage_faq('faq-test-a','delete',activity,question);
  if exists(select 1 from public.questions where id=question) then raise exception 'Exclusão falhou'; end if;
  if has_table_privilege('anon','public.questions','SELECT') or
    has_table_privilege('authenticated','public.questions','UPDATE') or
    has_function_privilege('anon','public.manage_faq(text,text,text,uuid,text,boolean,integer)','EXECUTE') then
    raise exception 'Grants públicos indevidos'; end if;
end $$;
rollback;
