-- Datas oficiais da programação, conforme o formulário de inscrição da SECCIM 2026.
-- Os triggers do sorteio incluem automaticamente as presenças já registradas.
begin;
update public.activities set event_date = d.event_date
from (values
  ('mesa-redonda', date '2026-11-03'),
  ('trabalhando-com-dados', date '2026-11-03'),
  ('tecnologia-ia-oportunidades', date '2026-11-03'),
  ('iniciacao-cientifica', date '2026-11-03'),
  ('linkedin-curriculo-entrevista', date '2026-11-03'),
  ('da-rural-ao-canada', date '2026-11-04'),
  ('meninas-na-robotica', date '2026-11-05'),
  ('equipe-robotica-shield-nig', date '2026-11-05'),
  ('sua-ideia-vale-uma-startup', date '2026-11-05'),
  ('visao-sobre-ai-gateway', date '2026-11-05'),
  ('ciencia-computacao-alem-software', date '2026-11-06'),
  ('kafka-alem-das-filas', date '2026-11-06'),
  ('como-iniciar-em-ia-security', date '2026-11-06'),
  ('como-e-desenvolver-um-jogo', date '2026-11-06'),
  ('e-se-a-aws-fosse-um-jogo', date '2026-11-06')
) as d(id, event_date)
where public.activities.id = d.id;

do $$
begin
  if exists(select 1 from public.activities where active and event_date is null) then
    raise exception 'Há atividade ativa sem data; confira os IDs da programação.';
  end if;
end;
$$;
commit;
