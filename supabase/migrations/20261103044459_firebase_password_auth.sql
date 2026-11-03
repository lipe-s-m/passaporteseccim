-- Transição para Firebase Authentication validado pela Edge Function passport.
-- Não contém senhas e não cria contas no Firebase.
begin;

alter table public.participants add column firebase_uid text unique
  check (length(firebase_uid) between 1 and 128);

-- Toda leitura privada passa pelo backend que verifica a conta no Firebase.
-- RLS permanece habilitado e clientes não têm grants nem policies privadas.
revoke all on public.participants, public.attendances from public, anon, authenticated;
drop policy participant_read_own on public.participants;
drop policy attendance_read_own on public.attendances;
drop trigger on_passport_email_verified on auth.users;
drop function private.handle_verified_participant();

-- O papel administrativo fica exclusivamente no ambiente da Edge Function.
grant select, insert, update on public.participants to service_role;
grant select on public.attendances to service_role;

create function public.get_firebase_passport(p_uid text, p_email text, p_name text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  participant public.participants%rowtype;
  earned jsonb;
begin
  if p_uid is null or length(p_uid) not between 1 and 128
    or p_email is null or length(p_email) not between 3 and 254
    or p_email <> lower(btrim(p_email)) or p_email not like '%@%' then
    raise exception 'Identidade inválida.' using errcode = '22023';
  end if;

  select * into participant from public.participants where firebase_uid = p_uid;
  if not found then
    insert into public.participants (firebase_uid, full_name, email)
    values (p_uid, coalesce(nullif(left(btrim(p_name),120),''),'Participante'), p_email)
    on conflict (email) do update set firebase_uid = excluded.firebase_uid
      where public.participants.firebase_uid is null
        and public.participants.auth_user_id is null
    returning * into participant;
    if not found then
      raise exception 'Cadastro já vinculado a outra identidade.' using errcode = '23505';
    end if;
  end if;

  select coalesce(jsonb_agg(a.activity_id order by a.activity_id),'[]'::jsonb)
    into earned from public.attendances a
    join public.activities activity on activity.id = a.activity_id and activity.active
    where a.participant_id = participant.id;
  return jsonb_build_object(
    'participant', jsonb_build_object('id',participant.id,'full_name',participant.full_name),
    'earnedBadges', earned
  );
end;
$$;

revoke all on function public.get_firebase_passport(text,text,text) from public, anon, authenticated;
grant execute on function public.get_firebase_passport(text,text,text) to service_role;
comment on function public.get_firebase_passport(text,text,text) is
  'Backend somente: parâmetros derivados de conta verificada no Firebase, nunca de dados enviados pelo cliente.';
comment on column public.participants.firebase_uid is 'Identificador estável do Firebase; vínculo após verificação no backend.';
comment on column public.participants.auth_user_id is 'Vínculo legado Supabase Auth; não usado no acesso atual.';
comment on table public.participants is 'Dados privados. Acesso por backend autenticado; RLS e grants bloqueiam leitura direta dos clientes.';

insert into public.site_content(key,value) values
('auth_description','Entre com o mesmo e-mail da inscrição e sua senha. No primeiro acesso, crie uma conta e confirme seu e-mail.'),
('name_label','Nome completo'),
('password_label','Senha'),
('login_label','Entrar'),
('signup_label','Criar conta'),
('reset_label','Esqueci minha senha'),
('verification_description','Confirme seu e-mail pelo link recebido. Depois, volte aqui e atualize a confirmação.'),
('resend_verification_label','Reenviar confirmação'),
('check_verification_label','Já confirmei meu e-mail'),
('verification_sent','Enviamos o link de confirmação para seu e-mail. Confira também a pasta de spam.'),
('verification_error','Não foi possível enviar a confirmação. Aguarde e tente novamente.'),
('reset_sent','Se houver uma conta para esse endereço e o envio for permitido, você receberá instruções para redefinir a senha.'),
('auth_error','Não foi possível entrar. Confira os dados ou use a recuperação de senha.'),
('signup_error','Não foi possível concluir o cadastro. Se já possui uma conta, entre ou recupere a senha.'),
('auth_privacy','A senha é enviada apenas ao Firebase Authentication por conexão segura. A organização registra suas presenças no Supabase. Ao recarregar a página, entre novamente com sua senha.')
on conflict(key) do update set value = excluded.value;

delete from public.site_content where key in ('send_code_label','otp_label','verify_label','otp_sent','otp_send_error','otp_verify_error');
commit;
