#!/usr/bin/env bash
# Sobe um PostgreSQL 16 temporário, aplica as migrações e roda os testes do banco.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
trap '"$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

if [ "$(id -u)" = "0" ]; then RUNAS="runuser -u postgres --"; chown -R postgres "$WORK"; else RUNAS=""; fi
$RUNAS "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust -E UTF8 --locale=C.UTF-8 -c wal_level=logical >/dev/null
$RUNAS "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" start >/dev/null
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres
for i in $(seq 1 30); do pg_isready -q && break; sleep 0.2; done

PSQL="psql -X -q -v ON_ERROR_STOP=1"
$PSQL -f "$HERE/supabase_stub.sql"
for f in "$HERE"/../migrations/*.sql; do
  echo "migração: $(basename "$f")"
  $PSQL -f "$f"
done
echo "--- testes de regras e permissões"
$PSQL -f "$HERE/rules_test.sql"
echo "--- teste de concorrência (duas vendas ao mesmo tempo no mesmo anúncio)"
bash "$HERE/concurrency_test.sh"
echo "TODOS OS TESTES DO BANCO PASSARAM"
