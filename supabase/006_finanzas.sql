-- Life RPG: Finanzas como quinta categoría.
-- Pegar completo en SQL Editor y pulsar Run, una sola vez, después de 005_navegacion_notificaciones.sql.
-- Hacé un respaldo JSON desde la app antes de correrlo.
--
-- Qué hace (todo en una sola transacción: o se aplica entero o no cambia nada):
--   1. Revisa la restricción de categoría de 5 tablas conocidas. Si en alguna falta, hay más de una
--      o tiene una forma distinta de la esperada, se detiene con un mensaje claro y no cambia nada.
--   2. Reemplaza solo esas 5 restricciones para aceptar: curso, finanzas, fisico, cuidado, lectura.
--   3. private.cat_name: agrega "Finanzas" para el texto de las notificaciones.
--   4. private.activity_xp: la misma fórmula de XP que la app (Finanzas × 1,25, doble redondeo).
--   5. public.user_level (cofres) y private.boss_damage (Boss) pasan a usarla, y el día completo
--      pasa a ser 4 categorías distintas o más.
-- No borra tablas, no borra ni cambia filas, no trunca nada. No toca 001–005.

begin;

-- =================== 1 y 2. Restricciones de categoría ===================
do $$
declare
  tabs constant text[] := array['activities', 'monthly_goals', 'monthly_bosses', 'planned_activities', 'focus_sessions'];
  -- Formas esperadas, tal como las escribe Postgres (sin espacios para comparar)
  old_def constant text := 'CHECK((category=ANY(ARRAY[''curso''::text,''fisico''::text,''cuidado''::text,''lectura''::text])))';
  new_def constant text := 'CHECK((category=ANY(ARRAY[''curso''::text,''finanzas''::text,''fisico''::text,''cuidado''::text,''lectura''::text])))';
  t text; att smallint; n integer; c record; d text;
  todo text[] := '{}'; names text[] := '{}';
begin
  -- Primero se revisa todo. Recién si las 5 están bien se cambia algo.
  foreach t in array tabs loop
    if to_regclass('public.' || t) is null then
      raise exception '006 detenido: no existe la tabla public.%', t;
    end if;
    select a.attnum into att from pg_attribute a
     where a.attrelid = ('public.' || t)::regclass and a.attname = 'category' and not a.attisdropped;
    if att is null then
      raise exception '006 detenido: la tabla public.% no tiene la columna category', t;
    end if;
    -- Restricciones CHECK que usan solo la columna category
    select count(*) into n from pg_constraint
     where conrelid = ('public.' || t)::regclass and contype = 'c' and conkey = array[att];
    if n = 0 then
      raise exception '006 detenido: public.% no tiene restricción de categoría', t;
    elsif n > 1 then
      raise exception '006 detenido: public.% tiene % restricciones de categoría (se esperaba 1)', t, n;
    end if;
    select conname, pg_get_constraintdef(oid) as def into c from pg_constraint
     where conrelid = ('public.' || t)::regclass and contype = 'c' and conkey = array[att];
    d := regexp_replace(c.def, '\s', '', 'g');
    if d = new_def then
      raise notice '006: public.% ya acepta finanzas, se deja igual', t;
    elsif d = old_def then
      todo := todo || t; names := names || c.conname::text;
    else
      raise exception '006 detenido: la restricción % de public.% tiene una forma inesperada: %', c.conname, t, c.def;
    end if;
  end loop;

  -- Reemplazo: misma restricción, mismo nombre, con finanzas agregada
  for i in 1 .. coalesce(array_length(todo, 1), 0) loop
    execute format('alter table public.%I drop constraint %I', todo[i], names[i]);
    execute format('alter table public.%I add constraint %I check (category in (''curso'',''finanzas'',''fisico'',''cuidado'',''lectura''))', todo[i], names[i]);
    raise notice '006: public.% acepta finanzas (%)', todo[i], names[i];
  end loop;
end $$;

-- =================== 3. Nombre de la categoría en las notificaciones ===================
create or replace function private.cat_name(c text) returns text language sql immutable set search_path = '' as $$
  select case c when 'curso' then 'Curso' when 'finanzas' then 'Finanzas' when 'fisico' then 'Físico'
                when 'cuidado' then 'Cuidado' when 'lectura' then 'Lectura' else '' end
$$;
revoke execute on function private.cat_name(text) from public, anon, authenticated;

-- =================== 4. XP de una actividad (la misma fórmula que actXP en game.js) ===================
-- XP base = round((10 + min(minutos, 240)) × intensidad); después × multiplicador de la categoría y round otra vez.
-- Solo Finanzas tiene multiplicador (1,25). Para las otras 4 el resultado es exactamente el de antes.
create or replace function private.activity_xp(p_minutes integer, p_intensity integer, p_category text)
returns integer language sql immutable set search_path = '' as $$
  select round(
           round((10 + least(p_minutes, 240)) * case p_intensity when 1 then 1.0 when 2 then 1.5 else 2.0 end)
           * case p_category when 'finanzas' then 1.25 else 1.0 end
         )::int
$$;
revoke execute on function private.activity_xp(integer, integer, text) from public, anon, authenticated;

-- =================== 5. Cofres y Boss con la misma fórmula ===================
-- Nivel global: igual que antes, con activity_xp y día completo = 4 categorías distintas o más
create or replace function public.user_level(p_uid uuid) returns integer language plpgsql stable set search_path = '' as $$
declare xp bigint; lv integer := 1;
begin
  select coalesce(sum(private.activity_xp(a.minutes, a.intensity, a.category)), 0)
    into xp from public.activities a where a.user_id = p_uid and a.deleted_at is null;
  xp := xp + 50 * (select count(*) from (select a.date from public.activities a
                     where a.user_id = p_uid and a.deleted_at is null
                     group by a.date having count(distinct a.category) >= 4) d);
  while xp >= 120 + 40 * (lv - 1) loop xp := xp - (120 + 40 * (lv - 1)); lv := lv + 1; end loop;
  return lv;
end $$;
revoke execute on function public.user_level(uuid) from public, anon, authenticated;

-- Daño del Boss: igual que antes, con activity_xp y día completo = 4 categorías distintas o más
create or replace function private.boss_damage(b public.monthly_bosses) returns integer
language sql stable security definer set search_path = '' as $$
  with a as (
    select x.date, x.category, x.minutes,
           private.activity_xp(x.minutes, x.intensity, x.category) as xp
      from public.activities x
     where x.user_id = b.user_id and x.deleted_at is null
       and (b.user_id = auth.uid() or auth.uid() is null)        -- solo los Bosses propios
       and x.date >= make_date(b.year, b.month, 1)
       and x.date <  (make_date(b.year, b.month, 1) + interval '1 month')::date
  ), full_days as (
    select count(*)::int as n from (select date from a group by date having count(distinct category) >= 4) d
  )
  select case b.boss_type
    when 'manual'         then b.manual_progress
    when 'xp'             then coalesce((select sum(xp) from a), 0)::int + 50 * (select n from full_days)
    when 'minutes'        then coalesce((select sum(minutes) from a), 0)::int
    when 'activities'     then (select count(*) from a)::int
    when 'cat_xp'         then coalesce((select sum(xp) from a where category = b.category), 0)::int
    when 'cat_minutes'    then coalesce((select sum(minutes) from a where category = b.category), 0)::int
    when 'cat_activities' then (select count(*) from a where category = b.category)::int
  end
$$;
revoke execute on function private.boss_damage(public.monthly_bosses) from public, anon;
grant execute on function private.boss_damage(public.monthly_bosses) to authenticated;

commit;
