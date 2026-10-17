-- Life RPG: notificaciones push (Web Push).
-- Pegar completo en SQL Editor y pulsar Run, una sola vez, después de 004_planificador_enfoque.sql.
-- Solo agrega: una columna opcional en planned_activities, cuatro tablas nuevas, una vista, funciones
-- y dos tareas programadas. No borra ni cambia nada de lo que ya existe.
--
-- Cómo funciona:
--   * Cada minuto pg_cron corre private.push_tick(): mira las planificaciones y las sesiones de enfoque
--     (las mismas filas que ya sincroniza la app) y anota los avisos que tocan. Si no hay nada, termina ahí.
--   * Si hay avisos para entregar, pg_net despierta a la Edge Function send-push, que los cifra, los firma con
--     la clave VAPID privada (guardada SOLO como secreto de la Edge Function) y los manda.
--   * Un aviso lógico se crea una sola vez (notification_events) y se entrega a cada dispositivo por separado
--     (notification_deliveries): un dispositivo puede recibirlo y otro fallar, y nunca llega dos veces al mismo.
--
-- Antes de ejecutar: en el Vault de Supabase tienen que existir dos secretos (te guío paso a paso):
--   push_function_url  la URL de la Edge Function send-push
--   push_cron_secret   el mismo valor que PUSH_CRON_SECRET de la Edge Function
-- Si todavía no existen, todo funciona igual pero no sale ningún aviso hasta crearlos.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- =================== Recordatorio de cada planificación ===================
-- null = sin recordatorio, 0 = a la hora, 1 a 1440 = minutos antes. Una app vieja no lo borra
-- (sube con defaultToNull: false, así que una columna que no manda queda como estaba).
alter table public.planned_activities
  add column reminder_minutes smallint check (reminder_minutes between 0 and 1440);

-- =================== Dispositivos (suscripciones push) ===================
-- La app NO lee esta tabla (tiene las claves del navegador): ve la vista push_devices.
-- Solo se escribe con register_push_device y set_push_device.
create table public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  device_id       text not null check (char_length(device_id) between 1 and 64),   -- el mismo de Focus
  device_name     text not null default '' check (char_length(device_name) <= 60),
  endpoint        text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh          text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}={0,2}$'),
  auth            text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}={0,2}$'),
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  disabled_at     timestamptz,
  disabled_reason text,                                   -- usuario | vencida | sesión cerrada
  unique (user_id, device_id)
);

-- =================== Preferencias (una fila por usuario) ===================
create table public.notification_preferences (
  user_id          uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  enabled          boolean not null default true,         -- interruptor general
  plan_reminders   boolean not null default true,
  overdue          boolean not null default true,
  focus            boolean not null default true,
  goals            boolean not null default true,
  boss             boolean not null default true,
  chests           boolean not null default true,
  default_reminder smallint default 30 check (default_reminder between 0 and 1440),   -- null = sin recordatorio
  quiet_enabled    boolean not null default false,
  quiet_start      time not null default '23:00',
  quiet_end        time not null default '08:00',
  timezone         text not null default 'UTC' check (char_length(timezone) <= 64),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  synced_at        timestamptz not null default now()
);
create trigger keep_newest before insert or update on public.notification_preferences for each row execute function public.keep_newest();
-- Zona horaria desconocida → UTC (el servidor la usa para saber qué son las 18:00 para vos)
create function public.check_timezone() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then new.timezone := 'UTC'; end if;
  return new;
end $$;
create trigger check_timezone before insert or update on public.notification_preferences for each row execute function public.check_timezone();

-- =================== Avisos y entregas ===================
-- Un aviso lógico, una sola vez por usuario (logical_id), por ejemplo plan:<id>:reminder:2026-10-17T18:00:30
create table public.notification_events (
  user_id       uuid not null references auth.users(id) on delete cascade,
  logical_id    text not null check (char_length(logical_id) <= 200),
  kind          text not null check (kind in ('plan','overdue','focus','goal','boss','chest','test','summary')),
  ref_id        uuid,                      -- planificación, sesión, objetivo o Boss
  ref_at        timestamptz,               -- inicio de la planificación o fin de la fase
  ref_min       integer,                   -- minutos del recordatorio, nivel del cofre, 0/1 fin de enfoque/descanso
  title         text not null check (char_length(title) between 1 and 80),
  body          text not null default '' check (char_length(body) <= 160),
  url           text not null default '#dashboard' check (url ~ '^#[a-z]+(\?[a-z=0-9&-]*)?$'),
  tag           text not null default 'life-rpg' check (char_length(tag) <= 64),
  actions       jsonb not null default '[]'::jsonb,
  urgency       text not null default 'normal' check (urgency in ('normal','high')),
  origin_device text,                      -- quien lo detectó (no lo recibe: ya lo está mostrando)
  fire_at       timestamptz not null default now(),
  expires_at    timestamptz not null,
  status        text not null default 'pending' check (status in ('pending','held','baseline','skipped')),
  created_at    timestamptz not null default now(),
  primary key (user_id, logical_id)
);
create index notification_events_due on public.notification_events (status, expires_at);

-- Su entrega a cada dispositivo: una fila por dispositivo, así nunca se manda dos veces al mismo
create table public.notification_deliveries (
  id              uuid not null default gen_random_uuid() unique,
  user_id         uuid not null references auth.users(id) on delete cascade,
  logical_id      text not null,
  device_id       text not null,
  subscription_id uuid references public.push_subscriptions(id) on delete set null,
  status          text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped','expired','shown_in_app')),
  attempts        smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, logical_id, device_id)
);
create index notification_deliveries_pending on public.notification_deliveries (status, next_attempt_at);

-- Lista de dispositivos para la app: sin endpoint ni claves
create view public.push_devices with (security_barrier) as
  select device_id, device_name, enabled, disabled_reason, created_at, updated_at, last_used_at
    from public.push_subscriptions where user_id = (select auth.uid());

-- =================== Funciones internas ===================
create schema if not exists private;

-- Preferencias con valores por defecto si todavía no hay fila
create function private.prefs(uid uuid) returns public.notification_preferences
language sql stable security definer set search_path = '' as $$
  select coalesce((select p from public.notification_preferences p where p.user_id = uid),
                  row(uid, true, true, true, true, true, true, true, 30, false, '23:00'::time, '08:00'::time, 'UTC', now(), now(), now())::public.notification_preferences)
$$;
-- ¿Ese tipo de aviso está activado?
create function private.kind_on(p public.notification_preferences, k text) returns boolean language sql immutable set search_path = '' as $$
  select case when k in ('test') then true
              when not p.enabled then false
              when k = 'plan' then p.plan_reminders when k = 'overdue' then p.overdue when k = 'focus' then p.focus
              when k = 'goal' then p.goals when k = 'boss' then p.boss when k = 'chest' then p.chests
              else true end
$$;
-- ¿Es horario silencioso? Puede cruzar la medianoche (23:00 a 08:00)
create function private.in_quiet(p public.notification_preferences, t timestamptz) returns boolean language sql stable set search_path = '' as $$
  select p.quiet_enabled and p.quiet_start <> p.quiet_end and (
    case when p.quiet_start < p.quiet_end
         then (t at time zone p.timezone)::time >= p.quiet_start and (t at time zone p.timezone)::time < p.quiet_end
         else (t at time zone p.timezone)::time >= p.quiet_start or (t at time zone p.timezone)::time < p.quiet_end end)
$$;
create function private.cat_name(c text) returns text language sql immutable set search_path = '' as $$
  select case c when 'curso' then 'Curso' when 'fisico' then 'Físico' when 'cuidado' then 'Cuidado' when 'lectura' then 'Lectura' else '' end
$$;
create function private.mins(m integer) returns text language sql immutable set search_path = '' as $$
  select case when m >= 60 and m % 60 = 0 then (m / 60)::text || ' h'
              when m > 60 then (m / 60)::text || ' h ' || (m % 60)::text || ' min'
              else m::text || ' min' end
$$;
-- La planificación sigue pendiente: existe, no está borrada, sigue "planned" y no tiene su actividad (mismo id)
create function private.plan_open(p public.planned_activities) returns boolean language sql stable security definer set search_path = '' as $$
  select p.deleted_at is null and p.status = 'planned'
     and not exists (select 1 from public.activities a where a.user_id = p.user_id and a.id = p.id and a.deleted_at is null)
$$;
-- Texto → entero, o el fallback si es null, vacío, no numérico o no entra en un entero. Nunca lanza un error.
-- Acepta "25", " 25 ", "25.0" y "25.4" (se redondea, como Math.round en la app).
create function private.safe_int(value text, fallback integer) returns integer language plpgsql immutable set search_path = '' as $$
begin
  if value is null or btrim(value) !~ '^-?[0-9]{1,9}(\.[0-9]{1,6})?$' then return fallback; end if;
  return round(btrim(value)::numeric)::integer;
exception when others then return fallback;
end $$;
-- Un número del Pomodoro, con los mismos límites y valores por defecto que la app (focus.js: POMO_LIM y POMO_DEF):
-- focus 5–120 (25), short 1–30 (5), long 5–60 (15), every 2–8 (4). Fuera de rango → el valor por defecto, igual que la app.
-- done (rondas hechas): nunca negativo. Un pomodoro que no es un objeto JSON da los valores por defecto.
create function private.pomo_int(pomo jsonb, k text) returns integer language plpgsql immutable set search_path = '' as $$
declare v integer; lo integer; hi integer; def integer;
begin
  case k
    when 'focus' then lo := 5; hi := 120; def := 25;
    when 'short' then lo := 1; hi := 30;  def := 5;
    when 'long'  then lo := 5; hi := 60;  def := 15;
    when 'every' then lo := 2; hi := 8;   def := 4;
    when 'done'  then lo := 0; hi := 100000; def := 0;
    else return null;
  end case;
  if pomo is null or jsonb_typeof(pomo) <> 'object' then return def; end if;
  v := private.safe_int(pomo->>k, def);
  if v < lo or v > hi then return def; end if;
  return v;
end $$;
-- Descanso que sigue a un enfoque del Pomodoro (el mismo cálculo que hace la app)
create function private.break_minutes(pomo jsonb) returns integer language sql immutable set search_path = '' as $$
  select case when (private.pomo_int(pomo, 'done') + 1) % private.pomo_int(pomo, 'every') = 0
              then private.pomo_int(pomo, 'long') else private.pomo_int(pomo, 'short') end
$$;

-- Anota un aviso y sus entregas. Devuelve true si es nuevo.
create function private.add_event(uid uuid, lid text, k text, rid uuid, rat timestamptz, rmin integer, ttl text, bdy text, u text, tg text,
                                  acts jsonb, urg text, fire timestamptz, expires timestamptz, origin text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare p public.notification_preferences := private.prefs(uid); st text := 'pending'; n integer;
begin
  if k not in ('focus', 'test') and private.in_quiet(p, now()) then st := 'held'; end if;   -- Focus y la prueba no esperan
  insert into public.notification_events (user_id, logical_id, kind, ref_id, ref_at, ref_min, title, body, url, tag, actions, urgency, origin_device, fire_at, expires_at, status)
  values (uid, lid, k, rid, rat, rmin, left(ttl, 80), left(coalesce(bdy, ''), 160), u, left(tg, 64), coalesce(acts, '[]'::jsonb), urg, origin, fire, expires, st)
  on conflict (user_id, logical_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  -- una entrega por dispositivo activo; si este dispositivo ya lo mostró en pantalla, su fila ya existe y no se toca
  insert into public.notification_deliveries (user_id, logical_id, device_id, subscription_id)
    select uid, lid, s.device_id, s.id from public.push_subscriptions s
     where s.user_id = uid and s.enabled and s.device_id is distinct from origin
       and (k <> 'test' or s.device_id = split_part(lid, ':', 2))
  on conflict (user_id, logical_id, device_id) do nothing;
  if origin is not null then
    insert into public.notification_deliveries (user_id, logical_id, device_id, status)
    values (uid, lid, origin, 'shown_in_app') on conflict (user_id, logical_id, device_id) do nothing;
  end if;
  return true;
end $$;

-- ¿El aviso sigue siendo cierto? Se vuelve a mirar el estado real justo antes de mandarlo.
create function private.still_valid(e public.notification_events) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare p public.planned_activities; f public.focus_sessions; tz text := (private.prefs(e.user_id)).timezone; ends timestamptz;
begin
  if e.kind in ('test', 'summary') then return true; end if;
  if e.kind in ('plan', 'overdue') and e.ref_id is not null then
    select * into p from public.planned_activities x where x.user_id = e.user_id and x.id = e.ref_id;
    if not found or not private.plan_open(p) then return false; end if;
    if e.kind = 'plan' then
      return p.time is not null and ((p.date + p.time) at time zone tz) = e.ref_at and p.reminder_minutes = e.ref_min;
    end if;
    return p.time is not null and ((p.date + p.time) at time zone tz) = e.ref_at;     -- atrasada con hora
  end if;
  if e.kind = 'overdue' then                                                           -- atrasadas sin hora de un día
    return exists (select 1 from public.planned_activities x where x.user_id = e.user_id and x.time is null
                     and x.date = (e.ref_at at time zone tz)::date and private.plan_open(x));
  end if;
  if e.kind = 'focus' then
    select * into f from public.focus_sessions x where x.user_id = e.user_id and x.id = e.ref_id;
    if not found or f.deleted_at is not null or f.status <> 'running' or f.mode <> 'pomodoro' then return false; end if;
    ends := private.ts(f.pomodoro->>'ends_at');
    if ends is null then return false; end if;
    if e.ref_min = 0 then                                                              -- fin de enfoque
      return f.pomodoro->>'phase' = 'focus' and abs(extract(epoch from ends - e.ref_at)) < 1;
    end if;
    begin
      return (f.pomodoro->>'phase' = 'focus' and abs(extract(epoch from ends + make_interval(mins => private.break_minutes(f.pomodoro)) - e.ref_at)) < 1)
          or (f.pomodoro->>'phase' in ('short', 'long') and abs(extract(epoch from ends - e.ref_at)) < 1);
    exception when others then return false;                                           -- fila de Focus corrupta: ese aviso se descarta
    end;
  end if;
  if e.kind = 'goal' then
    return exists (select 1 from public.monthly_goals g where g.user_id = e.user_id and g.id = e.ref_id and g.deleted_at is null and g.claimed_at is null);
  end if;
  if e.kind = 'boss' then
    return exists (select 1 from public.monthly_bosses b where b.user_id = e.user_id and b.id = e.ref_id and b.deleted_at is null and b.claimed_at is null);
  end if;
  if e.kind = 'chest' then
    return not exists (select 1 from public.level_chests c where c.user_id = e.user_id and c.level = e.ref_min);
  end if;
  return false;
end $$;

-- Busca lo que toca avisar ahora: recordatorios, atrasadas y fin de fases del Pomodoro.
-- Solo para usuarios con al menos un dispositivo activo. Devuelve cuántos avisos nuevos anotó.
create function private.enqueue_due() returns integer language plpgsql security definer set search_path = '' as $$
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
      if pr.overdue then
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
       where p.user_id = u.user_id and p.time is null and p.date = d and private.plan_open(p);
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

-- Despierta a la Edge Function (solo si el Vault tiene su URL y el secreto)
create function private.push_kick() returns void language plpgsql security definer set search_path = '' as $$
declare u text; s text;
begin
  select decrypted_secret into u from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into s from vault.decrypted_secrets where name = 'push_cron_secret';
  if u is null or s is null then return; end if;
  perform net.http_post(url := u, body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s), timeout_milliseconds := 15000);
end $$;

-- Cada minuto (pg_cron)
create function private.push_tick() returns integer language plpgsql security definer set search_path = '' as $$
declare u record; ev public.notification_events; pr public.notification_preferences; ok integer; n integer;
begin
  n := private.enqueue_due();

  -- Fin del horario silencioso: se manda lo retenido que sigue vigente; más de 3, un solo resumen
  for u in select distinct h.user_id from public.notification_events h where h.status = 'held' loop
    pr := private.prefs(u.user_id);
    if private.in_quiet(pr, now()) then continue; end if;
    for ev in select * from public.notification_events h where h.user_id = u.user_id and h.status = 'held' loop
      if ev.expires_at <= now() or not private.still_valid(ev) or not private.kind_on(pr, ev.kind) then
        update public.notification_events set status = 'skipped' where user_id = ev.user_id and logical_id = ev.logical_id;
      end if;
    end loop;
    select count(*) into ok from public.notification_events h where h.user_id = u.user_id and h.status = 'held';
    if ok > 3 then
      update public.notification_events set status = 'skipped' where user_id = u.user_id and status = 'held';
      perform private.add_event(u.user_id, 'summary:' || to_char(now() at time zone pr.timezone, 'YYYY-MM-DD"T"HH24:MI'), 'summary', null, null, ok,
        'Novedades en Life RPG', 'Tienes ' || ok || ' novedades en Life RPG', '#dashboard', 'summary', '[]'::jsonb, 'normal', now(), now() + interval '3 hours');
    else
      update public.notification_events set status = 'pending' where user_id = u.user_id and status = 'held';
    end if;
  end loop;
  update public.notification_deliveries d set status = 'skipped', updated_at = now()
    from public.notification_events e
   where e.user_id = d.user_id and e.logical_id = d.logical_id and e.status = 'skipped' and d.status = 'pending';

  -- Entregas trabadas (la Edge Function se cortó) vuelven a la cola; las vencidas se cierran
  update public.notification_deliveries set status = 'pending', updated_at = now()
   where status = 'sending' and updated_at < now() - interval '5 minutes';
  update public.notification_deliveries d set status = 'expired', updated_at = now()
    from public.notification_events e
   where e.user_id = d.user_id and e.logical_id = d.logical_id and d.status = 'pending' and e.expires_at <= now();

  if exists (select 1 from public.notification_deliveries d
               join public.notification_events e on e.user_id = d.user_id and e.logical_id = d.logical_id
               join public.push_subscriptions s on s.user_id = d.user_id and s.device_id = d.device_id and s.enabled
              where d.status = 'pending' and d.next_attempt_at <= now() and e.status = 'pending' and e.fire_at <= now() and e.expires_at > now()) then
    perform private.push_kick();
  end if;
  return n;
end $$;

-- =================== Para la Edge Function (solo service_role) ===================
-- Toma un lote de entregas, revalida cada aviso y las marca "sending". Dos ejecuciones a la vez no toman la misma.
create function public.push_claim(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; out jsonb := '[]'::jsonb; pr public.notification_preferences; badge integer; ttl integer;
begin
  for c in select d.id as did, d.user_id, d.device_id, d.attempts, s.id as sid, s.endpoint, s.p256dh, s.auth, e as ev
             from public.notification_deliveries d
             join public.notification_events e on e.user_id = d.user_id and e.logical_id = d.logical_id
             join public.push_subscriptions s on s.user_id = d.user_id and s.device_id = d.device_id and s.enabled
            where d.status = 'pending' and d.next_attempt_at <= now() and e.status = 'pending' and e.fire_at <= now() and e.expires_at > now()
            order by e.fire_at
            limit least(greatest(coalesce(p_limit, 50), 1), 200)
            for update of d skip locked loop
    pr := private.prefs(c.user_id);
    if not private.still_valid(c.ev) then
      update public.notification_events set status = 'skipped' where user_id = (c.ev).user_id and logical_id = (c.ev).logical_id;
      update public.notification_deliveries set status = 'skipped', last_error = 'ya no aplica', updated_at = now() where id = c.did;
      continue;
    end if;
    if not private.kind_on(pr, (c.ev).kind) then
      update public.notification_deliveries set status = 'skipped', last_error = 'desactivado', updated_at = now() where id = c.did;
      continue;
    end if;
    update public.notification_deliveries set status = 'sending', attempts = attempts + 1, subscription_id = c.sid, updated_at = now() where id = c.did;
    -- número del ícono: atrasadas de los últimos 7 días (la app lo corrige al abrirse)
    select count(*) into badge from public.planned_activities p
     where p.user_id = c.user_id and p.date < (now() at time zone pr.timezone)::date and p.date >= (now() at time zone pr.timezone)::date - 7 and private.plan_open(p);
    ttl := greatest(60, floor(extract(epoch from (c.ev).expires_at - now()))::int);
    out := out || jsonb_build_object('id', c.did, 'endpoint', c.endpoint, 'p256dh', c.p256dh, 'auth', c.auth, 'ttl', ttl, 'urgency', (c.ev).urgency,
      'payload', jsonb_build_object('title', (c.ev).title, 'body', (c.ev).body, 'url', (c.ev).url, 'tag', (c.ev).tag, 'actions', (c.ev).actions,
                                    'kind', (c.ev).kind, 'id', (c.ev).logical_id, 'badge', badge, 'ts', floor(extract(epoch from (c.ev).fire_at) * 1000)::bigint));
  end loop;
  return out;
end $$;

-- Resultado de cada envío: sent | retry (429/5xx, hasta 3 intentos) | gone (404/410: se desactiva solo ese dispositivo) | failed
create function public.push_report(p_results jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare r jsonb; d public.notification_deliveries; n integer := 0;
begin
  if jsonb_typeof(p_results) <> 'array' then return 0; end if;
  for r in select * from jsonb_array_elements(p_results) loop
    select * into d from public.notification_deliveries where id = private.ts_uuid(r->>'id') and status = 'sending' for update;
    if not found then continue; end if;
    n := n + 1;
    if r->>'result' = 'sent' then
      update public.notification_deliveries set status = 'sent', sent_at = now(), last_error = null, updated_at = now() where id = d.id;
      update public.push_subscriptions set last_used_at = now() where id = d.subscription_id;
    elsif r->>'result' = 'retry' and d.attempts < 3 then
      update public.notification_deliveries set status = 'pending', next_attempt_at = now() + make_interval(secs => 30 * d.attempts),
        last_error = left(coalesce(r->>'error', ''), 200), updated_at = now() where id = d.id;
    elsif r->>'result' = 'gone' then
      update public.notification_deliveries set status = 'failed', last_error = left(coalesce(r->>'error', 'suscripción vencida'), 200), updated_at = now() where id = d.id;
      update public.push_subscriptions set enabled = false, disabled_at = now(), disabled_reason = 'vencida', updated_at = now() where id = d.subscription_id;
      update public.notification_deliveries set status = 'skipped', last_error = 'suscripción vencida', updated_at = now()
       where subscription_id = d.subscription_id and status = 'pending';
    else
      update public.notification_deliveries set status = 'failed', last_error = left(coalesce(r->>'error', ''), 200), updated_at = now() where id = d.id;
    end if;
  end loop;
  return n;
end $$;
create function private.ts_uuid(v text) returns uuid language plpgsql immutable set search_path = '' as $$
begin return v::uuid; exception when others then return null; end $$;

-- =================== Lo único que la app puede hacer con push ===================
-- Registra (o renueva) la suscripción de ESTE dispositivo. Si ese endpoint estaba en otra cuenta
-- (otra persona en el mismo navegador), se le quita: tus avisos nunca le llegan a otra cuenta.
create function public.register_push_device(p_device text, p_name text, p_endpoint text, p_p256dh text, p_auth text, p_tz text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return 'not_signed_in'; end if;
  if p_device is null or char_length(p_device) not between 1 and 64 then return 'invalid'; end if;
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000 or p_p256dh !~ '^[A-Za-z0-9_-]{80,100}={0,2}$' or p_auth !~ '^[A-Za-z0-9_-]{16,32}={0,2}$' then return 'invalid'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and not (user_id = uid and device_id = p_device);
  insert into public.push_subscriptions (user_id, device_id, device_name, endpoint, p256dh, auth)
  values (uid, p_device, left(coalesce(nullif(trim(p_name), ''), 'Dispositivo'), 60), p_endpoint, p_p256dh, p_auth)
  on conflict (user_id, device_id) do update set endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth,
    device_name = case when nullif(trim(p_name), '') is null then public.push_subscriptions.device_name else excluded.device_name end,
    enabled = true, disabled_at = null, disabled_reason = null, updated_at = now();
  insert into public.notification_preferences (user_id, timezone) values (uid, coalesce(nullif(p_tz, ''), 'UTC')) on conflict (user_id) do nothing;
  return 'ok';
end $$;

-- Apagar, renombrar o quitar un dispositivo (desde cualquiera de tus dispositivos).
-- Encender solo se hace con register_push_device desde el propio dispositivo: necesita su permiso.
create function public.set_push_device(p_device text, p_action text, p_name text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n integer;
begin
  if uid is null then return 'not_signed_in'; end if;
  if p_action = 'disable' or p_action = 'signout' then
    update public.push_subscriptions set enabled = false, disabled_at = now(), updated_at = now(),
      disabled_reason = case when p_action = 'signout' then 'sesión cerrada' else 'usuario' end
     where user_id = uid and device_id = p_device;
  elsif p_action = 'remove' then
    delete from public.push_subscriptions where user_id = uid and device_id = p_device;
  elsif p_action = 'rename' then
    if p_name is null or char_length(trim(p_name)) not between 1 and 60 then return 'invalid'; end if;
    update public.push_subscriptions set device_name = trim(p_name), updated_at = now() where user_id = uid and device_id = p_device;
  else return 'invalid';
  end if;
  get diagnostics n = row_count;
  if n = 0 then return 'not_found'; end if;
  update public.notification_deliveries set status = 'skipped', last_error = 'dispositivo apagado', updated_at = now()
   where user_id = uid and device_id = p_device and status = 'pending' and p_action <> 'rename';
  return 'ok';
end $$;

-- Avisos que detecta la app (objetivo cerca, Boss debilitado, cofre disponible): el servidor no calcula
-- el progreso, así que la app avisa con el id lógico. Solo estos tipos, textos cortos, enlaces internos
-- y como máximo 30 por día. p_baseline = ya era cierto al activar: se anota y no se manda.
create function public.queue_notification(p_logical_id text, p_title text, p_body text, p_url text, p_origin text, p_baseline boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); k text; rid uuid; lvl integer; ex timestamptz; pr public.notification_preferences; n integer;
begin
  if uid is null then return 'not_signed_in'; end if;
  if p_logical_id ~ '^goal:[0-9a-f-]{36}:near$' then k := 'goal'; rid := private.ts_uuid(split_part(p_logical_id, ':', 2)); ex := now() + interval '24 hours';
  elsif p_logical_id ~ '^boss:[0-9a-f-]{36}:weak$' then k := 'boss'; rid := private.ts_uuid(split_part(p_logical_id, ':', 2)); ex := now() + interval '24 hours';
  elsif p_logical_id ~ '^chest:(5|10|15|20|30|40|50):available$' then k := 'chest'; lvl := split_part(p_logical_id, ':', 2)::int; ex := now() + interval '72 hours';
  else return 'invalid'; end if;
  if (k <> 'chest' and rid is null) or p_title is null or char_length(p_title) not between 1 and 80 or char_length(coalesce(p_body, '')) > 160
     or p_url !~ '^#(objetivos|boss|dashboard)(\?(goal|chest)=[0-9a-f-]{1,36})?$' or char_length(coalesce(p_origin, '')) > 64 then return 'invalid'; end if;
  if p_baseline then
    insert into public.notification_events (user_id, logical_id, kind, ref_id, ref_min, title, body, url, expires_at, status, origin_device)
    values (uid, p_logical_id, k, rid, lvl, p_title, coalesce(p_body, ''), p_url, ex, 'baseline', p_origin) on conflict do nothing;
    return 'baseline';
  end if;
  if exists (select 1 from public.notification_events where user_id = uid and logical_id = p_logical_id) then return 'exists'; end if;
  select count(*) into n from public.notification_events
   where user_id = uid and kind in ('goal', 'boss', 'chest') and status <> 'baseline' and created_at > now() - interval '24 hours';
  if n >= 30 then return 'limit'; end if;
  -- el objetivo, el Boss o el cofre tienen que existir y seguir sin reclamar
  if k = 'goal' and not exists (select 1 from public.monthly_goals g where g.user_id = uid and g.id = rid and g.deleted_at is null and g.claimed_at is null) then return 'not_found'; end if;
  if k = 'boss' and not exists (select 1 from public.monthly_bosses b where b.user_id = uid and b.id = rid and b.deleted_at is null and b.claimed_at is null) then return 'not_found'; end if;
  if k = 'chest' and exists (select 1 from public.level_chests c where c.user_id = uid and c.level = lvl) then return 'not_found'; end if;
  pr := private.prefs(uid);
  if not private.kind_on(pr, k) then return 'off'; end if;
  perform private.add_event(uid, p_logical_id, k, rid, null, lvl, p_title, p_body, p_url, k || '-' || coalesce(rid::text, lvl::text), '[]'::jsonb, 'normal', now(), ex, p_origin);
  return 'ok';
end $$;

-- Este dispositivo ya mostró el aviso dentro de Life RPG: no le llega por push. Los demás dispositivos lo reciben igual.
create function public.mark_shown_in_app(p_logical_id text, p_device text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return 'not_signed_in'; end if;
  if p_logical_id !~ '^(plan|focus|goal|boss|chest|overdue-day|test|summary):[A-Za-z0-9:._-]{1,190}$' or p_device is null or char_length(p_device) not between 1 and 64 then return 'invalid'; end if;
  insert into public.notification_deliveries (user_id, logical_id, device_id, status)
  values (uid, p_logical_id, p_device, 'shown_in_app')
  on conflict (user_id, logical_id, device_id) do update set status = 'shown_in_app', updated_at = now()
   where public.notification_deliveries.status = 'pending';
  return 'ok';
end $$;

-- "Probar en este dispositivo": un aviso que va solo a este dispositivo, por el mismo camino que los reales
create function public.send_test_push(p_device text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); lid text;
begin
  if uid is null then return 'not_signed_in'; end if;
  if not exists (select 1 from public.push_subscriptions where user_id = uid and device_id = p_device and enabled) then return 'no_device'; end if;
  lid := 'test:' || p_device || ':' || to_char(now(), 'YYYYMMDDHH24MISS');
  if not private.add_event(uid, lid, 'test', null, null, null, 'Life RPG', 'Las notificaciones funcionan en este dispositivo.', '#perfil', 'test',
       '[]'::jsonb, 'high', now(), now() + interval '10 minutes') then return 'exists'; end if;
  perform private.push_kick();
  return 'ok';
end $$;

-- =================== Permisos y RLS ===================
revoke all on public.push_subscriptions, public.notification_events, public.notification_deliveries from anon, authenticated;
revoke all on public.notification_preferences, public.push_devices from anon;
grant select, insert, update on public.notification_preferences to authenticated;   -- sin DELETE
grant select on public.push_devices to authenticated;

alter table public.push_subscriptions       enable row level security;   -- sin políticas: solo las funciones la tocan
alter table public.notification_events      enable row level security;
alter table public.notification_deliveries  enable row level security;
alter table public.notification_preferences enable row level security;
create policy own_select on public.notification_preferences for select to authenticated using (user_id = (select auth.uid()));
create policy own_insert on public.notification_preferences for insert to authenticated with check (user_id = (select auth.uid()));
create policy own_update on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke execute on function private.prefs(uuid), private.kind_on(public.notification_preferences, text), private.in_quiet(public.notification_preferences, timestamptz),
  private.cat_name(text), private.mins(integer), private.plan_open(public.planned_activities), private.safe_int(text, integer), private.pomo_int(jsonb, text), private.break_minutes(jsonb),
  private.add_event(uuid, text, text, uuid, timestamptz, integer, text, text, text, text, jsonb, text, timestamptz, timestamptz, text),
  private.still_valid(public.notification_events), private.enqueue_due(), private.push_kick(), private.push_tick(), private.ts_uuid(text)
  from public, anon, authenticated;
revoke execute on function public.push_claim(integer), public.push_report(jsonb) from public, anon, authenticated;
grant  execute on function public.push_claim(integer), public.push_report(jsonb) to service_role;
revoke execute on function public.register_push_device(text, text, text, text, text, text), public.set_push_device(text, text, text),
  public.queue_notification(text, text, text, text, text, boolean), public.mark_shown_in_app(text, text), public.send_test_push(text) from public, anon;
grant  execute on function public.register_push_device(text, text, text, text, text, text), public.set_push_device(text, text, text),
  public.queue_notification(text, text, text, text, text, boolean), public.mark_shown_in_app(text, text), public.send_test_push(text) to authenticated;
revoke execute on function public.check_timezone() from public, anon;

alter publication supabase_realtime add table public.notification_preferences;

-- =================== Programación ===================
-- Cada minuto: revisa y, si hay algo, despierta a la Edge Function. Todos los días a las 4:00 UTC: borra lo de más de 60 días.
select cron.schedule('life-rpg-push', '* * * * *', 'select private.push_tick()');
select cron.schedule('life-rpg-push-cleanup', '0 4 * * *', $$
  delete from public.notification_deliveries where created_at < now() - interval '60 days';
  delete from public.notification_events where created_at < now() - interval '60 days';
$$);
