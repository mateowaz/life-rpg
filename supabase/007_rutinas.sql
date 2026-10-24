-- Life RPG: Rutinas (misiones recurrentes).
-- Pegar completo en SQL Editor y pulsar Run, una sola vez, después de 006_finanzas.sql.
-- Hacé un respaldo JSON desde la app antes de correrlo.
--
-- Qué hace (todo en una sola transacción: o se aplica entero o no cambia nada):
--   1. Revisa que 004, 005 y 006 estén aplicadas y que 007 no se haya corrido antes. Si algo no es lo
--      esperado, se detiene con un mensaje claro y no cambia nada.
--   2. Crea la tabla recurring_plans (la rutina: una plantilla). Cada día que le toca lo crea la app como
--      una planificación normal en planned_activities, con un id que sale de la familia de la rutina
--      (series_id) y la fecha: dos dispositivos siempre crean la misma fila, nunca dos.
--   3. Agrega 3 columnas a planned_activities (con valores por defecto: las filas que ya existen no cambian):
--        recurring_plan_id  qué tramo de rutina la creó (null = planificación manual)
--        recurrence_date    el día que le tocaba según la rutina (no cambia al reprogramar)
--        recurrence_edited  true si la persona la tocó (editar solo esta, reprogramar, omitir, cancelar,
--                           eliminar): desde entonces la rutina no la vuelve a cambiar
--   4. private.enqueue_due: el mismo código de 005 con un solo cambio: las misiones de rutina no mandan
--      avisos de "atrasada" (la siguiente misión de la rutina ya llega con su propio recordatorio).
--      Los recordatorios antes de empezar siguen igual para todas.
-- No borra tablas, no borra ni cambia filas, no toca 001–006. No agrega permisos de DELETE.

begin;

-- =================== 1. Comprobaciones ===================
do $$
begin
  if to_regclass('public.planned_activities') is null then
    raise exception '007 detenido: no existe public.planned_activities (falta 004_planificador_enfoque.sql)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'planned_activities' and column_name = 'reminder_minutes') then
    raise exception '007 detenido: planned_activities no tiene reminder_minutes (falta 005_navegacion_notificaciones.sql)';
  end if;
  if to_regprocedure('private.activity_xp(integer, integer, text)') is null then
    raise exception '007 detenido: no existe private.activity_xp (falta 006_finanzas.sql)';
  end if;
  if to_regprocedure('private.enqueue_due()') is null then
    raise exception '007 detenido: no existe private.enqueue_due (falta 005_navegacion_notificaciones.sql)';
  end if;
  if to_regclass('public.recurring_plans') is not null then
    raise exception '007 detenido: public.recurring_plans ya existe (¿007 ya se ejecutó?). No se cambió nada.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'planned_activities'
              and column_name in ('recurring_plan_id', 'recurrence_date', 'recurrence_edited')) then
    raise exception '007 detenido: planned_activities ya tiene columnas de rutinas (¿007 ya se ejecutó?). No se cambió nada.';
  end if;
end $$;

-- =================== 2. Rutinas ===================
create table public.recurring_plans (
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id               uuid not null,
  series_id        uuid not null,                                   -- familia: "Esta y las siguientes" crea un tramo nuevo con el mismo series_id
  title            text not null check (char_length(title) between 1 and 80),
  description      text not null default '' check (char_length(description) <= 160),
  category         text not null check (category in ('curso','finanzas','fisico','cuidado','lectura')),
  weekdays         smallint[] not null check (cardinality(weekdays) between 1 and 7 and weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),   -- 1 = lunes … 7 = domingo
  start_date       date not null,
  end_date         date,
  time             time,                                            -- hora opcional
  planned_minutes  smallint not null check (planned_minutes between 1 and 240),
  intensity        smallint not null check (intensity between 1 and 3),
  note             text not null default '' check (char_length(note) <= 120),
  reminder_minutes smallint check (reminder_minutes between 0 and 1440),   -- null = sin recordatorio; solo con hora
  active           boolean not null default true,                   -- false = pausada
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  synced_at        timestamptz not null default now(),
  primary key (user_id, id),
  check (end_date is null or end_date >= start_date),
  check (time is not null or reminder_minutes is null)
);
create index recurring_plans_user_synced on public.recurring_plans (user_id, synced_at);
create index recurring_plans_user_series on public.recurring_plans (user_id, series_id);
-- Gana la versión más reciente y nadie cambia el dueño (la misma función que el resto de las tablas)
create trigger keep_newest before insert or update on public.recurring_plans for each row execute function public.keep_newest();

-- =================== 3. Columnas nuevas en planned_activities ===================
alter table public.planned_activities
  add column recurring_plan_id uuid,
  add column recurrence_date   date,
  add column recurrence_edited boolean not null default false,
  add constraint planned_activities_recurrence_pair check ((recurring_plan_id is null) = (recurrence_date is null));
create index planned_activities_user_routine on public.planned_activities (user_id, recurring_plan_id) where recurring_plan_id is not null;

-- =================== 4. Avisos: las misiones de rutina no avisan como atrasadas ===================
-- (Mismo código que 005; los dos cambios están marcados con "007".)
create or replace function private.enqueue_due() returns integer language plpgsql security definer set search_path = '' as $$
declare
  u record; r public.planned_activities; f public.focus_sessions; pr public.notification_preferences; tz text; today date; nowl timestamp; n integer := 0;
  st timestamptz; fire timestamptz; ex timestamptz; ends timestamptz; brk integer; cnt integer; first_title text; d date;
begin
  for u in select distinct s.user_id from public.push_subscriptions s where s.enabled loop
    pr := private.prefs(u.user_id);
    if not pr.enabled then continue; end if;
    tz := pr.timezone; nowl := now() at time zone tz; today := nowl::date;

    -- Planificaciones con hora: recordatorio y atrasada
    for r in select p.* from public.planned_activities p
              where p.user_id = u.user_id and p.time is not null and p.date between today - 1 and today + 2
                and p.deleted_at is null and p.status = 'planned' loop
      if not private.plan_open(r) then continue; end if;
      st := (r.date + r.time) at time zone tz;
      if pr.plan_reminders and r.reminder_minutes is not null then
        fire := st - make_interval(mins => r.reminder_minutes);
        ex := case when r.reminder_minutes = 0 then st + interval '15 minutes' else st end;
        if now() >= fire and now() < ex then
          if private.add_event(u.user_id, 'plan:' || r.id || ':reminder:' || to_char(r.date + r.time, 'YYYY-MM-DD"T"HH24:MI') || ':' || r.reminder_minutes, 'plan',
               r.id, st, r.reminder_minutes,
               r.title || case when r.reminder_minutes = 0 then ' empieza ahora' else ' en ' || private.mins(r.reminder_minutes) end,
               to_char(r.time, 'HH24:MI') || ' · ' || r.planned_minutes || ' min · ' || private.cat_name(r.category),
               '#planificador?plan=' || r.id, 'plan-' || r.id,
               '[{"action":"view","title":"Ver"},{"action":"focus","title":"Iniciar enfoque"}]'::jsonb, 'high', fire, ex) then n := n + 1; end if;
        end if;
      end if;
      if pr.overdue and r.recurring_plan_id is null then                       -- 007: las misiones de rutina no avisan como atrasadas
        fire := st + make_interval(mins => r.planned_minutes + 30);
        ex := (r.date + time '23:59:59') at time zone tz;
        if now() >= fire and now() < ex then
          if private.add_event(u.user_id, 'plan:' || r.id || ':overdue:' || r.date, 'overdue', r.id, st, null,
               'Te quedó una misión pendiente', r.title || ' estaba planeada para las ' || to_char(r.time, 'HH24:MI'),
               '#planificador?plan=' || r.id, 'plan-' || r.id,
               '[{"action":"view","title":"Ver"},{"action":"focus","title":"Iniciar enfoque"}]'::jsonb, 'normal', fire, ex) then n := n + 1; end if;
        end if;
      end if;
    end loop;

    -- Atrasadas sin hora: un solo aviso a las 9:00 del día siguiente (vence a las 12:00)
    if pr.overdue and nowl::time >= time '09:00' and nowl::time < time '12:00' then
      d := today - 1;
      select count(*), min(p.title) into cnt, first_title from public.planned_activities p
       where p.user_id = u.user_id and p.time is null and p.date = d and p.recurring_plan_id is null and private.plan_open(p);   -- 007: sin rutinas
      if cnt > 0 then
        if private.add_event(u.user_id, 'overdue-day:' || d, 'overdue', null, d::timestamp at time zone tz, null,
             'Misiones pendientes de ayer',
             case when cnt = 1 then 'Tienes 1 misión pendiente de ayer: ' || first_title else 'Tienes ' || cnt || ' misiones pendientes de ayer' end,
             '#planificador', 'overdue-day', '[]'::jsonb, 'normal',
             (today + time '09:00') at time zone tz, (today + time '12:00') at time zone tz) then n := n + 1; end if;
      end if;
    end if;

    -- Pomodoro: fin de enfoque y fin de descanso, aunque la app esté cerrada
    if pr.focus then
      for f in select x.* from public.focus_sessions x
                where x.user_id = u.user_id and x.deleted_at is null and x.status = 'running' and x.mode = 'pomodoro' loop
       begin                                                                -- una fila corrupta se saltea; las demás siguen
        if jsonb_typeof(f.pomodoro) is distinct from 'object' then continue; end if;
        ends := private.ts(f.pomodoro->>'ends_at');
        if ends is null then continue; end if;
        if f.pomodoro->>'phase' = 'focus' then
          if now() >= ends and now() < ends + interval '10 minutes' then
            if private.add_event(u.user_id, 'focus:' || f.id || ':focus:' || floor(extract(epoch from ends))::bigint, 'focus', f.id, ends, 0,
                 'Enfoque terminado', private.pomo_int(f.pomodoro, 'focus') || ' minutos completados · ' || f.title,
                 '#planificador?session=' || f.id, 'focus-' || f.id, '[]'::jsonb, 'high', ends, ends + interval '10 minutes') then n := n + 1; end if;
          end if;
          brk := private.break_minutes(f.pomodoro);
          ends := ends + make_interval(mins => brk);                       -- la app empieza el descanso sola al terminar el enfoque
        elsif coalesce(f.pomodoro->>'phase', '') not in ('short', 'long') then continue;     -- sin fase o fase desconocida: nada que avisar
        end if;
        if now() >= ends and now() < ends + interval '10 minutes' then
          if private.add_event(u.user_id, 'focus:' || f.id || ':break:' || floor(extract(epoch from ends))::bigint, 'focus', f.id, ends, 1,
               'Descanso terminado', '¿Empezamos otra ronda? · ' || f.title,
               '#planificador?session=' || f.id, 'focus-' || f.id, '[{"action":"timer","title":"Siguiente enfoque"}]'::jsonb, 'high',
               ends, ends + interval '10 minutes') then n := n + 1; end if;
        end if;
       exception when others then
        raise warning 'push: se salteó la sesión de enfoque % (%)', f.id, sqlerrm;
       end;
      end loop;
    end if;
  end loop;
  return n;
end $$;


-- =================== Permisos, RLS y Realtime ===================
revoke all on public.recurring_plans from anon;
grant select, insert, update on public.recurring_plans to authenticated;   -- sin DELETE: eliminar = deleted_at

alter table public.recurring_plans enable row level security;
create policy own_select on public.recurring_plans for select to authenticated using (user_id = (select auth.uid()));
create policy own_insert on public.recurring_plans for insert to authenticated with check (user_id = (select auth.uid()));
create policy own_update on public.recurring_plans for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.recurring_plans;

-- =================== 5. Verificación final ===================
do $$
declare n integer;
begin
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'planned_activities'
     and column_name in ('recurring_plan_id', 'recurrence_date', 'recurrence_edited');
  if n <> 3 then raise exception '007: faltan columnas en planned_activities (%/3)', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'recurring_plans';
  if n <> 3 then raise exception '007: recurring_plans tiene % políticas (se esperaban 3)', n; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.recurring_plans'::regclass) then
    raise exception '007: RLS no quedó activado en recurring_plans';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.recurring_plans'::regclass and tgname = 'keep_newest') then
    raise exception '007: falta el trigger keep_newest en recurring_plans';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recurring_plans') then
    raise exception '007: recurring_plans no quedó en Realtime';
  end if;
  raise notice '007: listo. recurring_plans con RLS y Realtime; planned_activities con 3 columnas nuevas.';
end $$;

commit;
