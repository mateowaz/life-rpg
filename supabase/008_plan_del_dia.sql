-- Life RPG: Plan del Día.
-- Pegar completo en SQL Editor y pulsar Run, una sola vez, después de 007_rutinas.sql.
-- Hacé un respaldo JSON desde la app antes de correrlo.
--
-- Qué hace (todo en una sola transacción: o se aplica entero o no cambia nada):
--   1. Revisa que 007 esté aplicada y que 008 no se haya corrido antes. Si algo no es lo esperado,
--      se detiene con un mensaje claro y no cambia nada.
--   2. planned_activities: 5 columnas opcionales (vacías en todas las filas que ya existen).
--        priority, energy_required, duration_mode, minimum_minutes: vacío = hereda de la rutina o el valor por defecto
--        due_date: fecha límite opcional
--   3. recurring_plans: priority, energy_required y duration_mode con valor por defecto (normal, normal, fixed),
--      y minimum_minutes opcional. Las rutinas que ya existen quedan con los valores por defecto.
--   4. daily_plans: el plan aceptado de cada día, solo ajustes e ids (los datos siguen en planned_activities).
--      La app usa un id fijo calculado de la fecha: la PC y el celular escriben la misma fila, nunca dos.
--   5. profiles.day_plan_prefs: preferencias del Plan del Día ({} por defecto).
-- El servidor nunca lee ni convierte items ni day_plan_prefs: solo valida su forma.
-- No borra tablas, no borra ni cambia filas, no toca 001–007, ni push_tick, enqueue_due ni los claim_*.
-- No agrega permisos de DELETE.

begin;

-- =================== 1. Comprobaciones ===================
do $$
begin
  if to_regclass('public.recurring_plans') is null then
    raise exception '008 detenido: no existe public.recurring_plans (falta 007_rutinas.sql)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'planned_activities' and column_name = 'recurring_plan_id') then
    raise exception '008 detenido: planned_activities no tiene recurring_plan_id (falta 007_rutinas.sql)';
  end if;
  if to_regclass('public.daily_plans') is not null then
    raise exception '008 detenido: public.daily_plans ya existe (¿008 ya se ejecutó?). No se cambió nada.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and ((table_name = 'planned_activities' and column_name in ('priority', 'energy_required', 'duration_mode', 'minimum_minutes', 'due_date'))
                or (table_name = 'recurring_plans' and column_name in ('priority', 'energy_required', 'duration_mode', 'minimum_minutes'))
                or (table_name = 'profiles' and column_name = 'day_plan_prefs'))) then
    raise exception '008 detenido: ya hay columnas del Plan del Día (¿008 ya se ejecutó?). No se cambió nada.';
  end if;
end $$;

-- =================== 2. planned_activities ===================
-- minimum_minutes no se compara con planned_minutes en el servidor: una versión vieja de la app podría bajar
-- planned_minutes y el CHECK frenaría toda su sincronización. La app usa siempre el menor de los dos.
alter table public.planned_activities
  add column priority        text check (priority in ('low', 'normal', 'high', 'critical')),
  add column energy_required text check (energy_required in ('low', 'normal', 'high')),
  add column duration_mode   text check (duration_mode in ('fixed', 'flexible')),
  add column minimum_minutes smallint check (minimum_minutes between 1 and 240),
  add column due_date        date,
  add constraint planned_activities_flexible_min check (duration_mode is distinct from 'flexible' or minimum_minutes is not null);

-- =================== 3. recurring_plans ===================
alter table public.recurring_plans
  add column priority        text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  add column energy_required text not null default 'normal' check (energy_required in ('low', 'normal', 'high')),
  add column duration_mode   text not null default 'fixed' check (duration_mode in ('fixed', 'flexible')),
  add column minimum_minutes smallint check (minimum_minutes between 1 and 240),
  add constraint recurring_plans_flexible_min check (duration_mode = 'fixed' or minimum_minutes is not null);

-- =================== 4. daily_plans ===================
create table public.daily_plans (
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id                uuid not null,                                   -- la app lo calcula de la fecha
  date              date not null,
  available_minutes smallint not null check (available_minutes between 0 and 1440),
  energy            text not null default 'normal' check (energy in ('low', 'normal', 'high')),
  focus_kind        text not null default 'auto' check (focus_kind in ('auto', 'category', 'goal', 'boss')),
  focus_ref         text check (char_length(focus_ref) <= 64),          -- la categoría o el id del objetivo
  -- Lista ordenada del plan aceptado: [{"id": "...", "m": minutos}]. CASE: primero el tipo, después el largo
  -- (un AND no garantiza el orden y jsonb_array_length sobre algo que no es lista da error).
  items             jsonb not null default '[]'::jsonb
                    check (case when jsonb_typeof(items) = 'array' then jsonb_array_length(items) <= 30 else false end),
  removed           uuid[] not null default '{}' check (cardinality(removed) <= 100),   -- lo que sacaste del plan ese día
  accepted_at       timestamptz,
  closed_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  synced_at         timestamptz not null default now(),
  primary key (user_id, id)
);
create index daily_plans_user_synced on public.daily_plans (user_id, synced_at);
create index daily_plans_user_date on public.daily_plans (user_id, date);
-- Gana la versión más reciente y nadie cambia el dueño (la misma función que el resto de las tablas)
create trigger keep_newest before insert or update on public.daily_plans for each row execute function public.keep_newest();

-- =================== 5. profiles.day_plan_prefs ===================
alter table public.profiles
  add column day_plan_prefs jsonb not null default '{}'::jsonb
    check (jsonb_typeof(day_plan_prefs) = 'object' and pg_column_size(day_plan_prefs) < 2048);

-- =================== Permisos, RLS y Realtime ===================
revoke all on public.daily_plans from anon;
grant select, insert, update on public.daily_plans to authenticated;   -- sin DELETE: eliminar = deleted_at

alter table public.daily_plans enable row level security;
create policy own_select on public.daily_plans for select to authenticated using (user_id = (select auth.uid()));
create policy own_insert on public.daily_plans for insert to authenticated with check (user_id = (select auth.uid()));
create policy own_update on public.daily_plans for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.daily_plans;

-- =================== 6. Verificación final ===================
do $$
declare n integer;
begin
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'planned_activities'
     and column_name in ('priority', 'energy_required', 'duration_mode', 'minimum_minutes', 'due_date');
  if n <> 5 then raise exception '008: faltan columnas en planned_activities (%/5)', n; end if;
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'recurring_plans'
     and column_name in ('priority', 'energy_required', 'duration_mode', 'minimum_minutes');
  if n <> 4 then raise exception '008: faltan columnas en recurring_plans (%/4)', n; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'day_plan_prefs') then
    raise exception '008: falta profiles.day_plan_prefs';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'daily_plans';
  if n <> 3 then raise exception '008: daily_plans tiene % políticas (se esperaban 3)', n; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.daily_plans'::regclass) then
    raise exception '008: RLS no quedó activado en daily_plans';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.daily_plans'::regclass and tgname = 'keep_newest') then
    raise exception '008: falta el trigger keep_newest en daily_plans';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_plans') then
    raise exception '008: daily_plans no quedó en Realtime';
  end if;
  if has_table_privilege('anon', 'public.daily_plans', 'select') then
    raise exception '008: anon no debería poder leer daily_plans';
  end if;
end $$;

commit;
