-- Fixtures transacionais; ROLLBACK preserva palestras e patrocinadores reais.
begin;
do $$
declare
  prefix text := 'img-test-' || substr(md5(gen_random_uuid()::text),1,8);
  ok_speaker text := 'https://mqparqbuhstkdpcgbbsa.supabase.co/storage/v1/object/public/site-images/speakers/0123456789abcdef.webp';
  ok_sponsor text := 'https://mqparqbuhstkdpcgbbsa.supabase.co/storage/v1/object/public/site-images/sponsors/fedcba9876543210.png';
  bad text;
begin
  insert into private.admins(firebase_uid,note) values(prefix||'-admin','Fixture temporária');
  insert into public.activities(id,name,description,category) values(prefix,'Palestra','','Teste');
  update public.activities set speaker_photo_url = ok_speaker where id = prefix;
  update public.activities set speaker_photo_url = '/fotos/'||prefix||'.webp' where id = prefix;
  insert into public.sponsors(id,name,logo_url,photos) values(prefix,'Empresa',ok_sponsor,jsonb_build_array(jsonb_build_object('url',ok_sponsor)));
  if not private.sponsor_photo_ok(ok_sponsor) or not private.site_image_ok(ok_speaker) then raise exception 'Imagem enviada recusada'; end if;
  foreach bad in array array[
    'https://mqparqbuhstkdpcgbbsa.supabase.co/storage/v1/object/public/avatars/x/0123456789abcdef.webp',
    'https://mqparqbuhstkdpcgbbsa.supabase.co/storage/v1/object/sign/site-images/speakers/0123456789abcdef.webp',
    'https://outroprojeto.supabase.co/storage/v1/object/public/site-images/speakers/0123456789abcdef.webp',
    'https://mqparqbuhstkdpcgbbsa.supabase.co/storage/v1/object/public/site-images/speakers/../x.webp',
    'https://mqparqbuhstkdpcgbbsa.supabase.co/storage/v1/object/public/site-images/speakers/0123456789abcdef.svg'] loop
    if private.site_image_ok(bad) or private.sponsor_photo_ok(bad) then raise exception 'Imagem fora do padrão aceita: %', bad; end if;
    begin
      update public.activities set speaker_photo_url = bad where id = prefix;
      raise exception 'Constraint aceitou: %', bad;
    exception when check_violation then null;
    end;
  end loop;
  perform public.admin_check(prefix||'-admin');
  begin
    perform public.admin_check(prefix||'-qualquer');
    raise exception 'admin_check aceitou conta comum';
  exception when insufficient_privilege then null;
  end;
end;
$$;
do $$
begin
  if has_function_privilege('anon','public.admin_check(text)','execute') or has_function_privilege('authenticated','public.admin_check(text)','execute') then
    raise exception 'Cliente executa admin_check';
  end if;
end;
$$;
rollback;
