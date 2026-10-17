-- Life RPG: Planificador y Temporizador de enfoque.
-- Pegar completo en SQL Editor y pulsar Run, una sola vez, después de 003_boss_y_perfil.sql.
-- Solo crea cosas nuevas: dos tablas, sus triggers, permisos y RLS. No toca activities, profiles,
-- coin_transactions ni ninguna tabla anterior. No agrega funciones RPC: completar una planificación
-- es crear una actividad normal con el mismo id que la planificación.

-- =================== Planificaciones ===================
-- "Completada" no se guarda: una planificación está completada si existe una actividad no borrada con su mismo id.
create table public.planned_activities (
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id              uuid not null,
  date            date not null,
  time            time,                                            -- hora opcional
  title           text not null check (char_length(title) between 1 and 80),
  category        text not null check (category in ('curso','fisico','cuidado','lectura')),
  planned_minutes smallint not null check (planned_minutes between 1 and 240),
  intensity       smallint not null check (intensity between 1 and 3),
  note            text not null default '' check (char_length(note) <= 120),
  status          text not null default 'planned' check (status in ('planned','skipped','cancelled')),
  moved_from      date,                                            -- fecha original al reprogramar
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  synced_at       timestamptz not null default now(),
  primary key (user_id, id)
);
create index planned_activities_user_synced on public.planned_activities (user_id, synced_at);
create index planned_activities_user_date on public.planned_activities (user_id, date);
create trigger keep_newest before insert or update on public.planned_activities for each row execute function public.keep_newest();

-- =================== Sesiones de enfoque ===================
-- El tiempo se guarda como tramos [inicio, fin] (segments), nunca como un contador.
-- focus_seconds lo calcula siempre el servidor a partir de segments.
create table public.focus_sessions (
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id                  uuid not null,
  planned_activity_id uuid,                                        -- fijo desde el inicio; nunca cambia
  device_id           text not null check (char_length(device_id) between 1 and 64),
  title               text not null check (char_length(title) between 1 and 80),
  category            text not null check (category in ('curso','fisico','cuidado','lectura')),
  mode                text not null check (mode in ('free','pomodoro')),
  status              text not null check (status in ('running','paused','finished','discarded')),
  started_at          timestamptz not null,
  segment_started_at  timestamptz,                                 -- tramo de enfoque en curso
  segments            jsonb not null default '[]'::jsonb,          -- tramos cerrados [["inicio","fin"], ...]
  focus_seconds       integer not null default 0,
  pomodoro            jsonb,                                       -- configuración y fase del Pomodoro
  ended_at            timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  synced_at           timestamptz not null default now(),
  primary key (user_id, id),
  check (jsonb_typeof(segments) = 'array'),
  check ((mode = 'pomodoro') = (pomodoro is not null))
);
create index focus_sessions_user_synced on public.focus_sessions (user_id, synced_at);
create index focus_sessions_user_plan on public.focus_sessions (user_id, planned_activity_id);

-- Funciones internas: en el esquema "private" (creado en 003), que la API no publica
create schema if not exists private;

-- Tramos válidos: cada uno con inicio < fin, sin fechas imposibles, ordenados y sin superposición
-- (los tramos repetidos o superpuestos se unen, así no se pueden inflar los minutos).
create function private.clean_segments(s jsonb, not_before timestamptz, not_after timestamptz)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  out jsonb := '[]'::jsonb; cur_s timestamptz; cur_e timestamptz; a timestamptz; b timestamptz; r record;
begin
  if s is null or jsonb_typeof(s) <> 'array' then return out; end if;
  for r in
    select x.a, x.b from (
      select case when jsonb_typeof(e) = 'array' and jsonb_array_length(e) = 2 then private.ts(e->>0) end as a,
             case when jsonb_typeof(e) = 'array' and jsonb_array_length(e) = 2 then private.ts(e->>1) end as b
        from jsonb_array_elements(s) e
    ) x
    where x.a is not null and x.b is not null and x.a < x.b                     -- inicio < fin: nada negativo ni vacío
    order by x.a
  loop
    a := greatest(r.a, not_before); b := least(r.b, not_after);               -- dentro de la sesión
    if a >= b then continue; end if;
    if cur_s is null then cur_s := a; cur_e := b;
    elsif a <= cur_e then cur_e := greatest(cur_e, b);                        -- se superpone: se une
    else
      out := out || jsonb_build_array(jsonb_build_array(to_char(cur_s at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(cur_e at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
      cur_s := a; cur_e := b;
    end if;
  end loop;
  if cur_s is not null then
    out := out || jsonb_build_array(jsonb_build_array(to_char(cur_s at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(cur_e at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  end if;
  return out;
end $$;

-- Texto → fecha, o null si no es una fecha válida (un tramo roto se descarta en vez de frenar la sincronización)
create function private.ts(v text) returns timestamptz language plpgsql immutable set search_path = '' as $$
begin
  return v::timestamptz;
exception when others then return null;
end $$;

create function private.segment_seconds(s jsonb) returns integer language sql immutable set search_path = '' as $$
  select coalesce(sum(extract(epoch from ((e->>1)::timestamptz - (e->>0)::timestamptz))), 0)::int
    from jsonb_array_elements(s) e
$$;

revoke all on function private.clean_segments(jsonb, timestamptz, timestamptz), private.ts(text), private.segment_seconds(jsonb) from public, anon;
grant execute on function private.clean_segments(jsonb, timestamptz, timestamptz), private.ts(text), private.segment_seconds(jsonb) to authenticated;

-- Protección de las sesiones. Los triggers corren en orden alfabético: keep_newest → protect_focus.
--  * planned_activity_id, device_id, mode y started_at no cambian después de crearse.
--  * Una sesión Finalizada o Descartada queda congelada: no vuelve a correr y ya no cambian sus tiempos,
--    sus tramos, sus minutos, su vínculo, su dispositivo, su modo ni su configuración de Pomodoro.
--    Solo puede pasar de Finalizada a Descartada, y borrarse con deleted_at.
--  * focus_seconds se recalcula siempre con los tramos limpios; el valor que manda el dispositivo se ignora.
create function public.protect_focus() returns trigger language plpgsql set search_path = '' as $$
declare
  pushed timestamptz := new.updated_at;
  limit_to timestamptz := now() + interval '1 hour';               -- margen para relojes adelantados
begin
  if tg_op = 'UPDATE' then
    new.planned_activity_id := old.planned_activity_id;
    new.device_id := old.device_id;
    new.mode := old.mode;
    new.started_at := old.started_at;
    if new.mode = 'free' then new.pomodoro := null;
    elsif new.pomodoro is null then new.pomodoro := old.pomodoro; end if;

    if old.status in ('finished', 'discarded') then
      -- Tiempo histórico: nada de esto cambia nunca más
      new.ended_at := old.ended_at;
      new.segments := old.segments;
      new.segment_started_at := null;
      new.focus_seconds := old.focus_seconds;
      new.pomodoro := old.pomodoro;
      if not (new.status = 'discarded' or new.status = old.status) then
        new.status := old.status;                                   -- nunca vuelve a correr
      end if;
      new.updated_at := greatest(pushed, old.updated_at) + interval '1 millisecond';
      new.synced_at := now();
      return new;
    end if;
  end if;

  -- Al terminar, el tramo abierto se cierra en el servidor si el dispositivo no lo cerró
  if new.status in ('finished', 'discarded') then
    if new.ended_at is null then new.ended_at := least(now(), limit_to); end if;
    if new.segment_started_at is not null then
      new.segments := new.segments || jsonb_build_array(jsonb_build_array(new.segment_started_at, new.ended_at));
    end if;
    new.segment_started_at := null;
  end if;
  if new.ended_at is not null and new.ended_at < new.started_at then new.ended_at := new.started_at; end if;

  new.segments := private.clean_segments(new.segments, new.started_at, coalesce(new.ended_at, limit_to));
  new.focus_seconds := private.segment_seconds(new.segments);
  if tg_op = 'UPDATE' then
    -- La versión del servidor queda más nueva que la del dispositivo, así este la acepta al bajarla
    new.updated_at := greatest(pushed, old.updated_at) + interval '1 millisecond';
  end if;
  new.synced_at := now();
  return new;
end $$;

create trigger keep_newest before insert or update on public.focus_sessions for each row execute function public.keep_newest();
create trigger protect_focus before insert or update on public.focus_sessions for each row execute function public.protect_focus();

-- =================== Permisos y RLS ===================
revoke all on public.planned_activities, public.focus_sessions from anon;
grant select, insert, update on public.planned_activities, public.focus_sessions to authenticated;   -- sin DELETE

alter table public.planned_activities enable row level security;
alter table public.focus_sessions enable row level security;

create policy own_select on public.planned_activities for select to authenticated using (user_id = (select auth.uid()));
create policy own_insert on public.planned_activities for insert to authenticated with check (user_id = (select auth.uid()));
create policy own_update on public.planned_activities for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy own_select on public.focus_sessions for select to authenticated using (user_id = (select auth.uid()));
create policy own_insert on public.focus_sessions for insert to authenticated with check (user_id = (select auth.uid()));
create policy own_update on public.focus_sessions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- =================== Realtime ===================
alter publication supabase_realtime add table public.planned_activities, public.focus_sessions;
