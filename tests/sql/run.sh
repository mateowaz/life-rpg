#!/usr/bin/env bash
# Pruebas de Supabase: ejecuta las migraciones en orden sobre un Postgres de prueba vacío
# (imagen supabase/postgres) y después cada archivo tests/sql/NN_*.sql. Nunca usa tu proyecto real.
# Variables: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE (las de psql).
set -euo pipefail
cd "$(dirname "$0")/../.."

psql_run() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

# Espera a que la base termine de prepararse (la imagen de Supabase crea auth, roles y extensiones al arrancar)
for i in $(seq 1 60); do
  psql -X -At -c "select 1 from auth.users limit 0" > /dev/null 2>&1 && break
  [ "$i" = 60 ] && { echo "La base de prueba no respondió"; exit 1; }
  sleep 2
done

echo "== Migraciones"
for f in supabase/schema.sql supabase/002_*.sql supabase/003_*.sql supabase/004_*.sql supabase/005_*.sql supabase/006_*.sql; do
  echo "   $f"
  psql_run -f "$f" > /dev/null
done

# Las tareas de pg_cron de 005 correrían solas cada minuto durante las pruebas: en esta base de prueba se apagan
psql_run -c "select cron.unschedule(jobname) from cron.job where jobname like 'life-rpg-%'" > /dev/null

# XP de todas las combinaciones según la app (game.js), para comparar con private.activity_xp
node tests/sql/xp_grid.js > /tmp/life-rpg-xp-grid.json

echo "== Pruebas"
psql_run -f tests/sql/00_ayuda.sql > /dev/null
for f in tests/sql/[0-9][0-9]_*.sql; do
  [ "$f" = tests/sql/00_ayuda.sql ] && continue
  echo "-- $f"
  if ! psql_run -At -v xp_cases="$(cat tests/cases/xp.json)" -v xp_grid="$(cat /tmp/life-rpg-xp-grid.json)" -f "$f" > /tmp/life-rpg-sql.out 2>&1; then
    grep -E '^ok' /tmp/life-rpg-sql.out || true
    grep -vE '^ok' /tmp/life-rpg-sql.out
    echo "== Falló $f"
    exit 1
  fi
  grep -E '^ok' /tmp/life-rpg-sql.out
done
total=$(psql -X -At -c "select count(*) from t.results")
echo "== $total comprobaciones de SQL correctas"
