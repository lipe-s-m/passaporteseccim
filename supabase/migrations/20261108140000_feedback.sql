-- Pesquisa de satisfação: nota de 1 a 5 e comentário por palestra, só de quem teve a presença registrada.
-- Só a organização lê as respostas, e sem o nome de quem respondeu.
begin;

create table public.activity_feedback (
  participant_id uuid not null,
  activity_id text not null,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (length(comment) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (participant_id, activity_id),
  -- A avaliação depende da presença: sem presença não há avaliação, e remover a presença remove a avaliação.
  foreign key (participant_id, activity_id) references public.attendances(participant_id, activity_id) on delete cascade
);
create index activity_feedback_activity_id_idx on public.activity_feedback(activity_id);
alter table public.activity_feedback enable row level security;
revoke all on public.activity_feedback from public, anon, authenticated, service_role;
comment on table public.activity_feedback is 'Pesquisa de satisfação. Acesso só pelas RPCs manage_feedback e admin_feedback.';

-- Lista as palestras que a própria conta assistiu, com a avaliação já enviada, e grava uma avaliação
-- quando p_activity é informado. A conta é a do UID verificado no Firebase pelo backend.
create function public.manage_feedback(p_uid text, p_activity text default null, p_rating integer default null, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare me uuid;
begin
  select id into me from public.participants where firebase_uid = p_uid;
  if me is null then raise exception 'Participante não encontrado.' using errcode = '42501'; end if;
  if p_activity is not null then
    if p_rating is null or p_rating not between 1 and 5 or p_comment is null or length(btrim(p_comment)) > 1000 then
      raise exception 'Avaliação inválida.' using errcode = '22023';
    end if;
    if not exists(select 1 from public.attendances where participant_id = me and activity_id = p_activity) then
      raise exception 'Só quem teve presença registrada avalia a palestra.' using errcode = '42501';
    end if;
    insert into public.activity_feedback(participant_id,activity_id,rating,comment)
    values(me,p_activity,p_rating,btrim(p_comment))
    on conflict (participant_id,activity_id) do update set rating=excluded.rating,comment=excluded.comment,updated_at=now();
  end if;
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('activityId',a.id,'name',a.name,
      'eventDate',a.event_date,'rating',f.rating,'comment',coalesce(f.comment,'')) order by a.event_date nulls last,a.sort_order,a.id)
    from public.attendances t join public.activities a on a.id = t.activity_id
    left join public.activity_feedback f on f.participant_id = t.participant_id and f.activity_id = t.activity_id
    where t.participant_id = me),'[]'::jsonb));
end;
$$;
revoke all on function public.manage_feedback(text,text,integer,text) from public, anon, authenticated;
grant execute on function public.manage_feedback(text,text,integer,text) to service_role;

-- Resultado para a organização: resumo por palestra e as respostas, sem identificar quem respondeu
-- (só o dia da resposta, não a hora, para não cruzar com o horário da presença).
create function public.admin_feedback(p_uid text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin(p_uid) then raise exception 'Acesso administrativo obrigatório.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'activities',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'eventDate',a.event_date,
        'attendances',(select count(*) from public.attendances t where t.activity_id = a.id),
        'responses',s.n,'average',s.average,'distribution',jsonb_build_array(s.c1,s.c2,s.c3,s.c4,s.c5))
        order by a.event_date nulls last,a.sort_order,a.id)
      from public.activities a
      cross join lateral (select count(*) as n,round(avg(f.rating),2) as average,
        count(*) filter (where f.rating = 1) as c1,count(*) filter (where f.rating = 2) as c2,count(*) filter (where f.rating = 3) as c3,
        count(*) filter (where f.rating = 4) as c4,count(*) filter (where f.rating = 5) as c5
        from public.activity_feedback f where f.activity_id = a.id) s
      where a.active or s.n > 0),'[]'::jsonb),
    'responses',coalesce((select jsonb_agg(jsonb_build_object('activityId',f.activity_id,'rating',f.rating,'comment',f.comment,
        'date',to_char(f.updated_at at time zone 'America/Sao_Paulo','YYYY-MM-DD')) order by f.updated_at desc,f.activity_id)
      from public.activity_feedback f),'[]'::jsonb));
end;
$$;
revoke all on function public.admin_feedback(text) from public, anon, authenticated;
grant execute on function public.admin_feedback(text) to service_role;

commit;
