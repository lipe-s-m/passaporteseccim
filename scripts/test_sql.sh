#!/bin/bash
# Roda todas as migrações e os testes de supabase/tests num Postgres 17 descartável (Docker),
# com os papéis anon/authenticated/service_role e privilégios padrão equivalentes aos do Supabase.
# Uso: scripts/test_sql.sh   (não toca no banco de produção)
set -u
cd "$(dirname "$0")/.."
NAME=seccim-sql-test
docker rm -f $NAME >/dev/null 2>&1
docker run -d --name $NAME -e POSTGRES_PASSWORD=test postgres:17 >/dev/null || exit 1
trap 'docker rm -f $NAME >/dev/null 2>&1' EXIT
until docker exec $NAME pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done; sleep 2
P="docker exec -i $NAME psql -U postgres -v ON_ERROR_STOP=1 -q"
$P <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
SQL
status=0
for f in supabase/migrations/*.sql supabase/seed.sql; do
  err=$($P < "$f" 2>&1 >/dev/null) || { echo "MIGRAÇÃO FALHOU: $f: $err"; status=1; }
done
for f in supabase/tests/*.sql; do
  out=$($P < "$f" 2>&1 | grep -E "ERROR|CONTEXT" | head -3)
  echo "$(basename "$f"): ${out:-ok}"; [ -z "$out" ] || status=1
done
exit $status
