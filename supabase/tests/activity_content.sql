-- Fixtures isoladas; o rollback final preserva todos os dados reais.
begin;
do $$
declare prefix text := 'content-test-'||gen_random_uuid()::text;
  data jsonb; result jsonb;
begin
  insert into private.admins(firebase_uid,note) values(prefix,'Teste transacional');
  insert into public.activities(id,name,category,description,event_date)
    values(prefix,'Original','Teste','','2099-01-01');
  result:=public.admin_activity_content(prefix,prefix);
  if (result->'activity'->>'content_revision')::integer<>0 then raise exception 'Revisão inicial inválida'; end if;
  data:=jsonb_build_object('name','Editada','category','Teste','description','Texto',
    'short_description','Resumo','speaker_name','Ana','speaker_bio','Mini bio',
    'speaker_photo_url','https://res.cloudinary.com/demo/image/upload/a.jpg',
    'event_date','2099-01-01','starts_at','2099-01-01T14:00:00-03:00','ends_at','2099-01-01T15:00:00-03:00',
    'speaker_socials',jsonb_build_object('website','https://example.org'),'slides_url','https://example.org/slides');
  result:=public.admin_activity_content(prefix,prefix,data,0);
  if result->'activity'->>'name'<>'Editada' or (result->'activity'->>'content_revision')::integer<>1 then raise exception 'Gravação falhou'; end if;
  if not exists(select 1 from private.activity_content_audit where activity_id=prefix and revision=1 and updated_by=prefix) then raise exception 'Auditoria ausente'; end if;
  begin
    perform public.admin_activity_content(prefix,prefix,data,0);
    raise exception 'Conflito ignorado';
  exception when serialization_failure then null; end;
  begin
    perform public.admin_activity_content(prefix||'-nao-admin',prefix);
    raise exception 'Conta comum autorizada';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_activity_content(prefix,prefix,jsonb_set(data,'{speaker_photo_url}','"javascript:alert(1)"'),1);
    raise exception 'Foto insegura aceita';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.admin_activity_content(prefix,prefix,jsonb_set(data,'{event_date}','"2099-02-30"'),1);
    raise exception 'Data inválida aceita';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.admin_activity_content(prefix,prefix,data||'{"active":false}'::jsonb,1);
    raise exception 'Campo não editorial aceito';
  exception when invalid_parameter_value then null; end;
  if has_function_privilege('anon','public.admin_activity_content(text,text,jsonb,integer)','execute')
    or has_function_privilege('authenticated','public.admin_activity_content(text,text,jsonb,integer)','execute')
    or not has_function_privilege('service_role','public.admin_activity_content(text,text,jsonb,integer)','execute')
    or has_table_privilege('anon','private.activity_content_audit','select') then raise exception 'Privilégios incorretos'; end if;
end;
$$;
rollback;
