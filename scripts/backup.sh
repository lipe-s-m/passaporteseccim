#!/bin/bash
# Backup completo do projeto Supabase de produção em dados-privados/ (ignorado pelo Git):
# estrutura, dados, papéis e os arquivos dos buckets "avatars" e "site-images".
# Depois do download, restaura num Postgres descartável (Docker) e confere as contagens.
# Uso: scripts/backup.sh   (exige "npx supabase login" e projeto vinculado; só lê a produção)
set -eu
cd "$(dirname "$0")/.."
DIR=dados-privados/backup-$(date +%Y-%m-%d)
if [ -e "$DIR" ]; then echo "$DIR já existe; apague ou renomeie antes." >&2; exit 1; fi
mkdir -p "$DIR/storage"
SB="npx -y supabase"

$SB db dump --remote -f "$DIR/schema.sql"
$SB db dump --remote --data-only --use-copy -f "$DIR/dados.sql"
$SB db dump --remote --role-only -f "$DIR/papeis.sql"
for bucket in avatars site-images; do
  $SB storage cp -r "ss:///$bucket" "$DIR/storage/" --remote --experimental >/dev/null
done
(cd "$DIR" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

# Restauração de teste: auth e storage são criados pelos serviços do Supabase, então os
# erros dessas tabelas são esperados aqui; o que importa são os dados do evento.
NAME=seccim-backup-check
docker rm -f $NAME >/dev/null 2>&1 || true
docker run -d --name $NAME -e POSTGRES_PASSWORD=restore-check -v "$PWD/$DIR":/backup:ro \
  public.ecr.aws/supabase/postgres:17.11.0.011 >/dev/null
trap 'docker rm -f $NAME >/dev/null 2>&1' EXIT
until docker exec $NAME pg_isready -U postgres -h localhost >/dev/null 2>&1; do sleep 1; done; sleep 5
for f in papeis schema dados; do
  docker exec $NAME psql -U supabase_admin -h localhost -d postgres -q -f /backup/$f.sql >/dev/null 2>&1 || true
done
echo "Restaurado num banco descartável:"
docker exec $NAME psql -U supabase_admin -h localhost -d postgres -At -F ': ' -c "
  select 'participantes', count(*) from public.participants union all
  select 'presenças', count(*) from public.attendances union all
  select 'chances de sorteio', count(*) from public.raffle_entries union all
  select 'sorteios', count(*) from public.raffle_draws union all
  select 'perfis', count(*) from public.participant_profiles union all
  select 'perguntas', count(*) from public.questions union all
  select 'patrocinadores', count(*) from public.sponsors"
echo "Arquivos do Storage: $(find "$DIR/storage" -type f | wc -l)"
echo "Backup em $DIR (com SHA256SUMS). Contém dados pessoais: não versionar nem compartilhar."
