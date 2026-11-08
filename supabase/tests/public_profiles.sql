-- Fixtures transacionais; ROLLBACK preserva participantes, perfis e sorteios reais.
begin;
do $$
declare prefix text := 'people-test-' || gen_random_uuid()::text; ana uuid; bia uuid; caio uuid;
begin
  perform set_config('test.people_prefix',prefix,true);
  insert into public.participants(full_name,email,firebase_uid) values('Ana Visível',prefix||'-ana@example.invalid',prefix||'-ana') returning id into ana;
  insert into public.participants(full_name,email,firebase_uid) values('Bia Escondida',prefix||'-bia@example.invalid',prefix||'-bia') returning id into bia;
  insert into public.participants(full_name,email) values('Caio Sem Conta',prefix||'-caio@example.invalid') returning id into caio;
  insert into public.sponsors(id,name,published) values(prefix||'-pub','Patrocinadora Pública',true),(prefix||'-draft','Rascunho',false);
  insert into public.activities(id,name,description,category,event_date,sort_order) values
    (prefix||'-1','Palestra 1','','Teste','2099-07-01',1),(prefix||'-2','Palestra 2','','Teste','2099-07-02',2);
  insert into public.attendances(participant_id,activity_id) values(ana,prefix||'-1'),(ana,prefix||'-2'),(bia,prefix||'-1'),(caio,prefix||'-2');
  insert into public.participant_profiles(participant_id,nickname,headline,bio,course,period,links,photo_path) values
    (ana,'ana.dev','Estagiária','Oi!','Ciência da Computação','5','{"github":"https://github.com/ana"}',ana::text||'/0123456789abcdef.webp');
  insert into public.raffle_draws(event_date,participant_id,ticket_id,prize,drawn_by,sponsor_id,absent) values
    ('2099-07-01',ana,gen_random_uuid(),'Caneca','fixture',prefix||'-pub',false),
    ('2099-07-02',ana,gen_random_uuid(),'Mochila','fixture',prefix||'-draft',false),
    ('2099-07-01',bia,gen_random_uuid(),'Camisa','fixture',null,true);
end;
$$;
set local role service_role;
do $$
declare prefix text := current_setting('test.people_prefix'); data jsonb; ana uuid; bia uuid;
begin
  -- Bia esconde o perfil pelo próprio formulário; o site antigo (sem a chave) não muda a escolha.
  perform public.manage_profile(prefix||'-bia','{"nickname":"bia.x","showNickname":true,"headline":"","bio":"","course":"","period":"","links":{},"publicProfile":false}');
  data := public.manage_profile(prefix||'-bia','{"nickname":"bia.x","showNickname":true,"headline":"Dev","bio":"","course":"","period":"","links":{}}');
  if (data->'profile'->>'publicProfile')::boolean then raise exception 'Salvar sem a chave tornou o perfil visível: %', data; end if;
  begin
    perform public.manage_profile(prefix||'-bia','{"nickname":null,"showNickname":true,"headline":"","bio":"","course":"","period":"","links":{},"publicProfile":"sim"}');
    raise exception 'Visibilidade não booleana aceita';
  exception when invalid_parameter_value then null;
  end;

  data := public.search_people(prefix||'-ana','Visív');
  if jsonb_array_length(data->'people') <> 1 or data->'people'->0->>'nickname' <> 'ana.dev' or (data->'people'->0->>'badgeCount')::int <> 2 then
    raise exception 'Busca por nome falhou: %', data;
  end if;
  ana := (data->'people'->0->>'participantId')::uuid;
  if jsonb_array_length(public.search_people(prefix||'-ana','@ANA.DEV')->'people') <> 1 then raise exception 'Busca por apelido falhou'; end if;
  if jsonb_array_length(public.search_people(prefix||'-ana','Escondida')->'people') <> 0
    or jsonb_array_length(public.search_people(prefix||'-ana','bia.x')->'people') <> 0 then
    raise exception 'Perfil escondido apareceu na busca';
  end if;
  if jsonb_array_length(public.search_people(prefix||'-ana','Caio Sem')->'people') <> 1 then raise exception 'Participante sem perfil não aparece'; end if;
  if public.search_people(prefix||'-ana','example')::text like '%example.invalid%'
    or jsonb_array_length(public.search_people(prefix||'-ana','example')->'people') <> 0 then
    raise exception 'Busca usa ou devolve e-mail';
  end if;
  begin
    perform public.search_people(prefix||'-ana','a');
    raise exception 'Busca de uma letra aceita';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.search_people(prefix||'-ninguem','Ana');
    raise exception 'Conta sem cadastro buscou pessoas';
  exception when insufficient_privilege then null;
  end;

  -- Perfil: selos das palestras e brindes recebidos (ausente não conta; patrocinador em rascunho não aparece).
  data := public.person_profile(prefix||'-bia',ana);
  if data->>'name' <> 'Ana Visível' or data->>'bio' <> 'Oi!' or data->>'period' <> '5' or (data->>'isMe')::boolean
    or jsonb_array_length(data->'badges') <> 2 or data->'badges'->0->>'name' <> 'Palestra 1'
    or jsonb_array_length(data->'prizes') <> 2 or data->'prizes'->0->>'sponsor' <> 'Patrocinadora Pública'
    or data->'prizes'->1->'sponsor' <> 'null'::jsonb or data::text like '%example.invalid%' then
    raise exception 'Perfil incorreto: %', data;
  end if;
  select id into bia from public.participants where firebase_uid = prefix||'-bia';
  begin
    perform public.person_profile(prefix||'-ana',bia);
    raise exception 'Perfil escondido aberto por outra pessoa';
  exception when no_data_found then null;
  end;
  data := public.person_profile(prefix||'-bia',bia);
  if not (data->>'isMe')::boolean or jsonb_array_length(data->'prizes') <> 0 then raise exception 'Própria pessoa não vê o perfil escondido: %', data; end if;
  begin
    perform public.person_profile(prefix||'-ana',gen_random_uuid());
    raise exception 'Perfil inexistente devolvido';
  exception when no_data_found then null;
  end;

  -- Ranking: id só de quem tem perfil visível (e da própria pessoa).
  data := public.get_badge_ranking(prefix||'-ana');
  if exists(select 1 from jsonb_array_elements(data->'entries') e where e->>'name' in ('@bia.x','Bia Escondida') and e->>'id' is not null) then
    raise exception 'Ranking expôs id de perfil escondido';
  end if;
  if not exists(select 1 from jsonb_array_elements(data->'entries') e where e->>'name' = '@ana.dev' and (e->>'id')::uuid = ana) then
    raise exception 'Ranking sem id de perfil visível: %', data;
  end if;
  data := public.get_badge_ranking(prefix||'-bia');
  if not exists(select 1 from jsonb_array_elements(data->'entries') e where (e->>'isMe')::boolean and (e->>'id')::uuid = bia) then
    raise exception 'Própria pessoa sem id no ranking';
  end if;
end;
$$;
reset role;

do $$
declare client text;
begin
  foreach client in array array['anon','authenticated'] loop
    if has_function_privilege(client,'public.search_people(text,text)','execute')
      or has_function_privilege(client,'public.person_profile(text,uuid)','execute') then
      raise exception 'Cliente executa função de perfis: %', client;
    end if;
  end loop;
end;
$$;
rollback;
