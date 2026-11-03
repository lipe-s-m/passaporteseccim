-- Executar em um projeto Supabase novo, como postgres (SQL Editor).
-- Transacional: uma falha desfaz toda a migração.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.site_content (
  key text primary key check (length(key) between 1 and 80),
  value text not null check (length(value) <= 4000)
);

create table public.activities (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) between 1 and 200),
  description text not null check (length(description) <= 8000),
  category text not null check (length(category) between 1 and 120),
  sort_order integer not null default 0,
  active boolean not null default true
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  email text not null unique check (
    email = lower(btrim(email)) and length(email) between 3 and 254
    and email like '%@%'
  ),
  legacy_id text unique,
  created_at timestamptz not null default now()
);

create table public.attendances (
  participant_id uuid not null references public.participants(id) on delete cascade,
  activity_id text not null references public.activities(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  primary key (participant_id, activity_id)
);

create index attendances_activity_id_idx on public.attendances (activity_id);

alter table public.site_content enable row level security;
alter table public.activities enable row level security;
alter table public.participants enable row level security;
alter table public.attendances enable row level security;

-- Grants E RLS: não depender dos privilégios padrão do projeto.
revoke all on public.site_content, public.activities, public.participants,
  public.attendances from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.site_content, public.activities to anon, authenticated;
grant select on public.participants, public.attendances to authenticated;

create policy content_read on public.site_content
  for select to anon, authenticated using (true);
create policy activities_read on public.activities
  for select to anon, authenticated using (active);
create policy participant_read_own on public.participants
  for select to authenticated using (auth_user_id = (select auth.uid()));
create policy attendance_read_own on public.attendances
  for select to authenticated using (
    exists (
      select 1 from public.participants p
      where p.id = participant_id and p.auth_user_id = (select auth.uid())
    )
  );

-- Nenhuma policy de INSERT/UPDATE/DELETE para clientes.
-- O vínculo com dados importados só acontece após verificar o e-mail no Auth.
-- Metadados fornecidos pelo participante jamais concedem privilégios.
create function private.handle_verified_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is null or new.email is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.email_confirmed_at is not null then
      return new;
    end if;
  end if;

  insert into public.participants (auth_user_id, full_name, email)
  values (
    new.id,
    coalesce(nullif(left(btrim(new.raw_user_meta_data ->> 'full_name'), 120), ''), 'Participante'),
    lower(btrim(new.email))
  )
  on conflict (email) do update set auth_user_id = excluded.auth_user_id
    where public.participants.auth_user_id is null
       or public.participants.auth_user_id = excluded.auth_user_id;

  if not exists (select 1 from public.participants where auth_user_id = new.id) then
    raise exception 'Não foi possível vincular o participante.';
  end if;
  return new;
end;
$$;

revoke all on function private.handle_verified_participant() from public, anon, authenticated;
create trigger on_passport_email_verified
  after insert or update of email_confirmed_at on auth.users
  for each row execute function private.handle_verified_participant();

comment on table public.site_content is 'Textos públicos; nunca inserir dados pessoais ou segredos.';
comment on table public.participants is 'Dados privados. Leitura do próprio registro; edição somente pela equipe no Dashboard.';
comment on table public.attendances is 'Presenças concedidas pela equipe. Clientes não podem escrever.';
comment on column public.participants.legacy_id is 'Identificador da planilha; não autoriza acesso ao passaporte.';

commit;
