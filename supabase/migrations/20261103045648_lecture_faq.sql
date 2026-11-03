begin;
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  activity_id text not null references public.activities(id) on delete restrict,
  participant_id uuid not null references public.participants(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 2000),
  anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index questions_activity_created_idx on public.questions(activity_id, created_at desc, id desc);
create index questions_participant_idx on public.questions(participant_id);
alter table public.questions enable row level security;
revoke all on public.questions from public, anon, authenticated;
grant select, insert, update, delete on public.questions to service_role;

-- Identidade fornecida exclusivamente pelo backend após validação no Firebase.
create function public.manage_faq(p_uid text, p_action text, p_activity text,
  p_id uuid default null, p_body text default null, p_anonymous boolean default false,
  p_offset integer default 0)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare author uuid; affected uuid; result jsonb;
begin
  select id into author from public.participants where firebase_uid = p_uid;
  if author is null then raise exception 'Autor inválido' using errcode = '42501'; end if;
  if not exists(select 1 from public.activities where id = p_activity and active) then
    raise exception 'Atividade inválida' using errcode = '22023';
  end if;
  if p_action = 'list' then
    if p_offset is null or p_offset < 0 or p_offset > 100000 then
      raise exception 'Página inválida' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(row_data order by created_at desc, id desc), '[]'::jsonb) into result
    from (select q.id, q.created_at, jsonb_build_object(
      'id',q.id,'body',q.body,'anonymous',q.anonymous,
      'author',case when q.anonymous then 'Anônimo' else p.full_name end,
      'mine',q.participant_id = author,'createdAt',q.created_at,'updatedAt',q.updated_at) as row_data
      from public.questions q join public.participants p on p.id = q.participant_id
      where q.activity_id = p_activity order by q.created_at desc, q.id desc limit 50 offset p_offset) page;
    return jsonb_build_object('questions',result,'hasMore',jsonb_array_length(result) = 50);
  elsif p_action in ('create','update') then
    if p_body is null or length(btrim(p_body)) not between 1 and 2000 or p_anonymous is null then
      raise exception 'Pergunta inválida' using errcode = '22023';
    end if;
    if p_action = 'create' then
      insert into public.questions(activity_id, participant_id, body, anonymous)
      values(p_activity,author,btrim(p_body),p_anonymous) returning id into affected;
    else
      update public.questions set body=btrim(p_body),anonymous=p_anonymous,updated_at=clock_timestamp()
      where id=p_id and participant_id=author and activity_id=p_activity returning id into affected;
    end if;
  elsif p_action = 'delete' then
    delete from public.questions where id=p_id and participant_id=author and activity_id=p_activity
    returning id into affected;
  else raise exception 'Ação inválida' using errcode = '22023';
  end if;
  if affected is null then raise exception 'Pergunta indisponível' using errcode = '42501'; end if;
  return jsonb_build_object('id',affected);
end;
$$;
revoke all on function public.manage_faq(text,text,text,uuid,text,boolean,integer) from public, anon, authenticated;
grant execute on function public.manage_faq(text,text,text,uuid,text,boolean,integer) to service_role;
comment on table public.questions is 'FAQ: acesso via backend Firebase. Anonimato oculta o nome do público, não da organização.';
commit;
