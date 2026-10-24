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
for f in supabase/schema.sql supabase/002_*.sql supabase/003_*.sql supabase/004_*.sql supabase/005_*.sql supabase/006_*.sql supabase/007_*.sql; do
  echo "   $f"
  psql_run -f "$f" > /dev/null
done

# 008: sin 007 se detiene con un mensaje claro y no cambia nada
if (echo "begin; alter table public.recurring_plans rename to rp_prueba;"; cat supabase/008_plan_del_dia.sql) | psql -X -q -v ON_ERROR_STOP=1 > /tmp/life-rpg-008.out 2>&1; then
  echo "== 008 debería detenerse si falta 007"; exit 1
fi
grep -q "falta 007" /tmp/life-rpg-008.out || { cat /tmp/life-rpg-008.out; echo "== 008 sin 007: mensaje inesperado"; exit 1; }
psql -X -At -c "select to_regclass('public.recurring_plans') is not null and to_regclass('public.daily_plans') is null" | grep -q t \
  || { echo "== 008 sin 007 cambió algo"; exit 1; }
# Filas que ya existían antes de 008 (las revisa tests/sql/08_plan_dia.sql)
psql_run > /dev/null <<'SQL'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c8', 'pre008@prueba.local');
insert into public.profiles (user_id, name, motto) values ('00000000-0000-0000-0000-0000000000c8', 'Antes', 'de 008');
insert into public.planned_activities (user_id, id, date, time, title, category, planned_minutes, intensity, note)
values ('00000000-0000-0000-0000-0000000000c8', 'c8000000-0000-4000-8000-000000000001', '2026-10-20', '18:00', 'Vieja', 'curso', 45, 2, 'nota');
insert into public.recurring_plans (user_id, id, series_id, title, category, weekdays, start_date, planned_minutes, intensity)
values ('00000000-0000-0000-0000-0000000000c8', 'c8000000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000002', 'Rutina vieja', 'lectura', '{1,3}', '2026-10-01', 30, 1);
SQL
echo "   supabase/008_plan_del_dia.sql"
psql_run -f supabase/008_plan_del_dia.sql > /dev/null
# Correrla dos veces se detiene con un mensaje claro
if psql -X -q -v ON_ERROR_STOP=1 -f supabase/008_plan_del_dia.sql > /tmp/life-rpg-008.out 2>&1; then
  echo "== 008 no debería poder correrse dos veces"; exit 1
fi
grep -q "ya se ejecutó" /tmp/life-rpg-008.out || { cat /tmp/life-rpg-008.out; echo "== 008 repetida: mensaje inesperado"; exit 1; }
echo "   (008 sin 007 y 008 repetida se detienen con mensaje claro)"

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
