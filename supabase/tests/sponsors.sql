-- Fixtures transacionais; ROLLBACK preserva patrocinadores e sorteios reais.
begin;
do $$
declare prefix text := 'sponsor-test-' || substr(md5(gen_random_uuid()::text),1,8);
begin
  perform set_config('test.sponsor_prefix',prefix,true);
  insert into private.admins(firebase_uid,note) values(prefix||'-admin','Fixture temporária');
  insert into public.participants(full_name,email,firebase_uid) values('Pessoa Comum',prefix||'@example.invalid',prefix||'-user');
  insert into public.activities(id,name,description,category,event_date) values(prefix||'-1','Palestra','','Teste','2099-10-01');
  insert into public.attendances(participant_id,activity_id) select id,prefix||'-1' from public.participants where email = prefix||'@example.invalid';
end;
$$;
set local role service_role;
do $$
declare
  prefix text := current_setting('test.sponsor_prefix');
  admin text := prefix||'-admin'; data jsonb; content jsonb; rev integer;
begin
  content := jsonb_build_object('name','  Empresa Teste ','tagline','Tecnologia para todos','about','Sobre a empresa',
    'contributions',jsonb_build_array('Coffee break','Canecas para o sorteio'),'logo_url','/fotos/patrocinadores/'||prefix||'.png',
    'photos',jsonb_build_array(jsonb_build_object('url','/fotos/patrocinadores/'||prefix||'-1.webp','caption','Estande')),
    'links',jsonb_build_object('site','https://empresa.example','vagas','https://empresa.example/vagas'),'published',false);
  data := public.admin_sponsors(admin,prefix,content);
  rev := (data->'sponsor'->>'content_revision')::int;
  if data->'sponsor'->>'name' <> 'Empresa Teste' or rev <> 1 or (data->'sponsor'->>'published')::boolean then
    raise exception 'Criação incorreta: %', data;
  end if;
  begin
    perform public.admin_sponsors(admin,prefix,content);
    raise exception 'Identificador repetido aceito';
  exception when serialization_failure then null;
  end;
  data := public.admin_sponsors(admin,prefix,content || '{"published":true}',rev);
  if (data->'sponsor'->>'content_revision')::int <> 2 or not (data->'sponsor'->>'published')::boolean then raise exception 'Publicação falhou'; end if;
  begin
    perform public.admin_sponsors(admin,prefix,content,rev);
    raise exception 'Revisão antiga sobrescreveu';
  exception when serialization_failure then null;
  end;
  -- Conteúdo inválido não é gravado.
  foreach data in array array[
    content || '{"logo_url":"https://evil.test/logo.png"}', content || '{"logo_url":"/fotos/patrocinadores/../x.png"}',
    content || '{"links":{"site":"javascript:alert(1)"}}', content || '{"links":{"twitter":"https://x.com/a"}}',
    content || '{"photos":[{"url":"/fotos/a.webp"}]}', content || '{"photos":[{"url":"/fotos/patrocinadores/a.svg"}]}',
    content || '{"contributions":[""]}', content || '{"name":"  "}', content - 'about', content || '{"extra":1}'] loop
    begin
      perform public.admin_sponsors(admin,prefix,data,2);
      raise exception 'Conteúdo inválido aceito: %', data;
    exception when invalid_parameter_value then null;
    end;
  end loop;
  begin
    perform public.admin_sponsors(prefix||'-user');
    raise exception 'Participante comum listou patrocinadores';
  exception when insufficient_privilege then null;
  end;

  -- Sorteio com brinde oferecido pelo patrocinador.
  data := public.admin_raffle_draw(admin,'draw','2099-10-01','Caneca',null,prefix);
  if data->'draws'->0->>'sponsor' <> 'Empresa Teste' or data->'draws'->0->>'prize' <> 'Caneca' then raise exception 'Patrocinador do brinde ausente: %', data; end if;
  begin
    perform public.admin_raffle_draw(admin,'draw','2099-10-01','Caneca',null,prefix||'-inexistente');
    raise exception 'Patrocinador inexistente aceito';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
reset role;
do $$
declare prefix text := current_setting('test.sponsor_prefix');
begin
  if (select count(*) from private.sponsor_audit where sponsor_id = prefix and updated_by = prefix||'-admin') <> 2 then
    raise exception 'Auditoria incompleta';
  end if;
  -- Leitura pública só enxerga publicados.
  update public.sponsors set published = false where id = prefix;
end;
$$;
set local role anon;
do $$
begin
  if exists(select 1 from public.sponsors where id = current_setting('test.sponsor_prefix')) then raise exception 'Rascunho visível ao público'; end if;
end;
$$;
reset role;
update public.sponsors set published = true where id = current_setting('test.sponsor_prefix');
set local role anon;
do $$
begin
  if not exists(select 1 from public.sponsors where id = current_setting('test.sponsor_prefix')) then raise exception 'Publicado invisível ao público'; end if;
end;
$$;
reset role;
do $$
declare client text;
begin
  foreach client in array array['anon','authenticated'] loop
    if has_table_privilege(client,'public.sponsors','insert') or has_table_privilege(client,'public.sponsors','update')
      or has_function_privilege(client,'public.admin_sponsors(text,text,jsonb,integer)','execute')
      or has_table_privilege(client,'private.sponsor_audit','select') then
      raise exception 'Cliente com permissão indevida: %', client;
    end if;
  end loop;
end;
$$;
rollback;
