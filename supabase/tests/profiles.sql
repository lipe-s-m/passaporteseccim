-- Fixtures transacionais; ROLLBACK preserva perfis, presenças e perguntas reais.
begin;
do $$
declare prefix text := 'profile-test-' || substr(md5(gen_random_uuid()::text),1,8);
begin
  perform set_config('test.profile_prefix',prefix,true);
  insert into private.admins(firebase_uid,note) values(prefix||'-admin','Fixture temporária');
  insert into public.participants(full_name,email,firebase_uid) values
    ('Ana Oficial',prefix||'-ana@example.invalid',prefix||'-ana'),('Bruno Oficial',prefix||'-bruno@example.invalid',prefix||'-bruno');
  insert into public.activities(id,name,description,category) values(prefix||'-1','Palestra','','Teste');
  insert into public.attendances(participant_id,activity_id) select id,prefix||'-1' from public.participants where email like prefix||'%';
end;
$$;
set local role service_role;
do $$
declare
  prefix text := current_setting('test.profile_prefix'); ana text := prefix||'-ana'; bruno text := prefix||'-bruno';
  base jsonb := '{"nickname":"  Ana.Dev ","showNickname":true,"headline":"Estagiária de dados · Empresa X","bio":"Oi!","course":"Ciência da Computação","period":"5","links":{"github":"https://github.com/ana"}}';
  data jsonb; ana_id uuid; entry jsonb; nick text := 'ana' || substr(prefix, 15);
begin
  data := public.manage_profile(ana);
  if data->>'name' <> 'Ana Oficial' or data->'profile'->>'nickname' is not null or not (data->'profile'->>'showNickname')::boolean then
    raise exception 'Perfil vazio incorreto: %', data;
  end if;
  data := public.manage_profile(ana, base || jsonb_build_object('nickname','  '||upper(nick)||' '));
  if data->'profile'->>'nickname' <> nick or data->'profile'->>'headline' <> 'Estagiária de dados · Empresa X' or data->>'name' <> 'Ana Oficial' then
    raise exception 'Gravação incorreta: %', data;
  end if;
  if (select full_name from public.participants where firebase_uid = ana) <> 'Ana Oficial' then raise exception 'Nome oficial alterado'; end if;
  -- Apelido único (sem distinguir maiúsculas) e nomes reservados.
  foreach entry in array array[base || jsonb_build_object('nickname',nick), base || '{"nickname":"Admin"}', base || '{"nickname":"seccim"}'] loop
    begin
      perform public.manage_profile(bruno, entry);
      raise exception 'Apelido repetido ou reservado aceito: %', entry;
    exception when unique_violation then null;
    end;
  end loop;
  foreach entry in array array[base || '{"nickname":"a"}', base || '{"nickname":"com espaço"}', base || '{"period":"11"}',
    base || '{"links":{"twitter":"https://x.com/a"}}', base || '{"links":{"github":"javascript:alert(1)"}}', base || jsonb_build_object('bio',repeat('x',161)), base - 'bio', base || '{"extra":1}'] loop
    begin
      perform public.manage_profile(bruno, entry);
      raise exception 'Perfil inválido aceito: %', entry;
    exception when invalid_parameter_value or check_violation then null;
    end;
  end loop;
  -- Ranking e FAQ mostram o apelido quando escolhido, e o nome quando a pessoa desliga.
  data := public.get_badge_ranking(ana);
  select e into entry from jsonb_array_elements(data->'entries') e where (e->>'isMe')::boolean;
  if entry->>'name' <> '@'||nick then raise exception 'Ranking sem apelido: %', entry; end if;
  perform public.manage_faq(ana,'create',prefix||'-1',null,'Pergunta pública',false);
  data := public.manage_faq(ana,'list',prefix||'-1');
  if data->'questions'->0->>'author' <> '@'||nick then raise exception 'FAQ sem apelido: %', data; end if;
  perform public.manage_profile(ana, base || jsonb_build_object('nickname',nick,'showNickname',false));
  data := public.get_badge_ranking(ana);
  select e into entry from jsonb_array_elements(data->'entries') e where (e->>'isMe')::boolean;
  if entry->>'name' <> 'Ana Oficial' then raise exception 'Escolha de mostrar o nome ignorada'; end if;
  -- Foto: só caminho dentro da pasta da própria pessoa.
  select id into ana_id from public.participants where firebase_uid = ana;
  data := public.set_profile_photo(ana, ana_id::text || '/0123456789abcdef.webp');
  if data->>'previous' is not null then raise exception 'Foto anterior inesperada'; end if;
  data := public.set_profile_photo(ana, ana_id::text || '/fedcba9876543210.jpg');
  if data->>'previous' <> ana_id::text || '/0123456789abcdef.webp' then raise exception 'Foto anterior não devolvida'; end if;
  begin
    perform public.set_profile_photo(bruno, ana_id::text || '/0123456789abcdef.webp');
    raise exception 'Foto na pasta de outra pessoa aceita';
  exception when invalid_parameter_value then null;
  end;
  if public.profile_card(prefix||'-admin', ana_id)->>'photoPath' <> ana_id::text || '/fedcba9876543210.jpg' then raise exception 'Cartão do perfil incorreto'; end if;
  begin
    perform public.profile_card(bruno, ana_id);
    raise exception 'Participante comum leu o cartão de outra pessoa';
  exception when insufficient_privilege then null;
  end;
  -- Moderação pela organização.
  data := public.admin_profiles(prefix||'-admin', nick);
  if jsonb_array_length(data->'profiles') <> 1 then raise exception 'Busca de moderação: %', data; end if;
  data := public.admin_profiles(prefix||'-admin', null, ana_id, 'remove_photo');
  if data->>'removedPhoto' <> ana_id::text || '/fedcba9876543210.jpg' then raise exception 'Moderação não devolveu a foto removida: %', data; end if;
  perform public.admin_profiles(prefix||'-admin', null, ana_id, 'remove_nickname');
  data := public.manage_profile(ana);
  if data->'profile'->>'nickname' is not null or data->'profile'->>'photoPath' is not null then raise exception 'Moderação não aplicada'; end if;
  begin
    perform public.admin_profiles(ana, nick);
    raise exception 'Participante comum moderou';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
do $$
declare client text;
begin
  foreach client in array array['anon','authenticated'] loop
    if has_table_privilege(client,'public.participant_profiles','select')
      or has_function_privilege(client,'public.manage_profile(text,jsonb)','execute')
      or has_function_privilege(client,'public.admin_profiles(text,text,uuid,text)','execute')
      or has_function_privilege(client,'public.set_profile_photo(text,text)','execute') then
      raise exception 'Cliente com acesso indevido ao perfil: %', client;
    end if;
  end loop;
end;
$$;
rollback;
