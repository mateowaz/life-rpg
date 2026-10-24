-- Plan del Día (008): columnas opcionales, daily_plans, day_plan_prefs, RLS y "gana la más reciente"
select t.eq((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'planned_activities'
              and column_name in ('priority', 'energy_required', 'duration_mode', 'minimum_minutes', 'due_date')), 5::bigint, '008 agrega 5 columnas a planned_activities');

-- Las filas que existían antes de 008 quedan iguales
select t.ok((select title = 'Vieja' and date = '2026-10-20' and time = '18:00' and planned_minutes = 45 and note = 'nota'
                and priority is null and energy_required is null and duration_mode is null and minimum_minutes is null and due_date is null
               from public.planned_activities where id = 'c8000000-0000-4000-8000-000000000001'), 'una planificación vieja queda igual y con las columnas nuevas vacías');
select t.ok((select title = 'Rutina vieja' and priority = 'normal' and energy_required = 'normal' and duration_mode = 'fixed' and minimum_minutes is null
               from public.recurring_plans where id = 'c8000000-0000-4000-8000-000000000002'), 'una rutina vieja queda igual con los valores por defecto');
select t.ok((select name = 'Antes' and motto = 'de 008' and day_plan_prefs = '{}'::jsonb from public.profiles where user_id = '00000000-0000-0000-0000-0000000000c8'),
            'un perfil viejo queda igual con preferencias vacías');
select t.eq((select count(*) from public.planned_activities where priority is not null or due_date is not null), 0::bigint,
            'ninguna planificación existente recibe prioridad ni fecha límite');

set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000a');

-- planned_activities: valores válidos e inválidos
insert into public.planned_activities (id, date, title, category, planned_minutes, intensity, priority, energy_required, duration_mode, minimum_minutes, due_date)
values ('a8000000-0000-4000-8000-000000000001', '2026-10-26', 'Curso flexible', 'curso', 60, 2, 'critical', 'low', 'flexible', 20, '2026-10-28');
select t.ok((select priority = 'critical' and minimum_minutes = 20 and due_date = '2026-10-28' from public.planned_activities where id = 'a8000000-0000-4000-8000-000000000001'),
            'una planificación guarda prioridad, energía, flexible, mínimo y fecha límite');
select t.fails($$insert into public.planned_activities (id, date, title, category, planned_minutes, intensity, priority) values (gen_random_uuid(), '2026-10-26', 'x', 'curso', 30, 1, 'urgente')$$,
               'una prioridad desconocida se rechaza');
select t.fails($$insert into public.planned_activities (id, date, title, category, planned_minutes, intensity, energy_required) values (gen_random_uuid(), '2026-10-26', 'x', 'curso', 30, 1, 'max')$$,
               'una energía desconocida se rechaza');
select t.fails($$insert into public.planned_activities (id, date, title, category, planned_minutes, intensity, duration_mode) values (gen_random_uuid(), '2026-10-26', 'x', 'curso', 30, 1, 'flexible')$$,
               'flexible sin mínimo se rechaza');
select t.fails($$insert into public.planned_activities (id, date, title, category, planned_minutes, intensity, minimum_minutes) values (gen_random_uuid(), '2026-10-26', 'x', 'curso', 30, 1, 0)$$,
               'mínimo de 0 minutos se rechaza');
select t.fails($$insert into public.planned_activities (id, date, title, category, planned_minutes, intensity, minimum_minutes) values (gen_random_uuid(), '2026-10-26', 'x', 'curso', 30, 1, 241)$$,
               'mínimo de más de 240 minutos se rechaza');
-- Una versión vieja de la app que no conoce las columnas sigue pudiendo sincronizar (y no borra lo nuevo)
update public.planned_activities set planned_minutes = 10, updated_at = '2030-01-01' where id = 'a8000000-0000-4000-8000-000000000001';
select t.ok((select planned_minutes = 10 and minimum_minutes = 20 and priority = 'critical' from public.planned_activities where id = 'a8000000-0000-4000-8000-000000000001'),
            'una app vieja puede bajar los minutos por debajo del mínimo sin trabar la sincronización');
insert into public.planned_activities (id, date, title, category, planned_minutes, intensity)
values ('a8000000-0000-4000-8000-000000000002', '2026-10-26', 'App vieja', 'lectura', 30, 1);
select t.ok((select priority is null from public.planned_activities where id = 'a8000000-0000-4000-8000-000000000002'), 'una app vieja crea planificaciones sin las columnas nuevas');

-- recurring_plans
select t.fails($$insert into public.recurring_plans (id, series_id, title, category, weekdays, start_date, planned_minutes, intensity, duration_mode)
                 values (gen_random_uuid(), gen_random_uuid(), 'x', 'curso', '{1}', '2026-10-01', 30, 1, 'flexible')$$, 'rutina flexible sin mínimo se rechaza');
select t.fails($$insert into public.recurring_plans (id, series_id, title, category, weekdays, start_date, planned_minutes, intensity, priority)
                 values (gen_random_uuid(), gen_random_uuid(), 'x', 'curso', '{1}', '2026-10-01', 30, 1, null)$$, 'una rutina sin prioridad se rechaza');

-- daily_plans
insert into public.daily_plans (id, date, available_minutes, energy, focus_kind, focus_ref, items, removed, accepted_at, updated_at)
values ('a8000000-0000-4000-8000-0000000000d1', '2026-10-26', 180, 'low', 'category', 'finanzas',
        '[{"id":"a8000000-0000-4000-8000-000000000001","m":20}]', '{a8000000-0000-4000-8000-000000000002}', now(), '2030-01-01T10:00:00Z');
select t.eq((select count(*) from public.daily_plans), 1::bigint, 'A guarda su plan del día');
select t.fails($$insert into public.daily_plans (id, date, available_minutes, items) values (gen_random_uuid(), '2026-10-27', 60, '{"id":1}')$$, 'items que no son una lista se rechazan');
select t.fails($$insert into public.daily_plans (id, date, available_minutes, items) values (gen_random_uuid(), '2026-10-27', 60, '"texto"')$$, 'items de texto se rechazan sin error raro');
select t.fails($$insert into public.daily_plans (id, date, available_minutes, items) values (gen_random_uuid(), '2026-10-27', 60, (select jsonb_agg(i) from generate_series(1, 31) i))$$,
               'más de 30 items se rechazan');
select t.fails($$insert into public.daily_plans (id, date, available_minutes) values (gen_random_uuid(), '2026-10-27', 1441)$$, 'más de 24 h disponibles se rechaza');
select t.fails($$insert into public.daily_plans (id, date, available_minutes, energy) values (gen_random_uuid(), '2026-10-27', 60, 'max')$$, 'energía desconocida se rechaza');
select t.fails($$insert into public.daily_plans (id, date, available_minutes, focus_kind) values (gen_random_uuid(), '2026-10-27', 60, 'xp')$$, 'enfoque desconocido se rechaza');
select t.fails($$insert into public.daily_plans (id, date, available_minutes, focus_ref) values (gen_random_uuid(), '2026-10-27', 60, repeat('x', 65))$$, 'focus_ref demasiado largo se rechaza');

-- Gana la versión más reciente (PC y celular escriben la misma fila)
insert into public.daily_plans (id, date, available_minutes, updated_at) values ('a8000000-0000-4000-8000-0000000000d1', '2026-10-26', 60, '2030-01-01T09:00:00Z')
on conflict (user_id, id) do update set available_minutes = excluded.available_minutes, updated_at = excluded.updated_at;
select t.eq((select available_minutes from public.daily_plans where id = 'a8000000-0000-4000-8000-0000000000d1'), 180::smallint, 'un plan más viejo de otro dispositivo se ignora');
insert into public.daily_plans (id, date, available_minutes, updated_at) values ('a8000000-0000-4000-8000-0000000000d1', '2026-10-26', 120, '2030-01-01T11:00:00Z')
on conflict (user_id, id) do update set available_minutes = excluded.available_minutes, updated_at = excluded.updated_at;
select t.eq((select count(*) from public.daily_plans where date = '2026-10-26'), 1::bigint, 'el mismo día queda en una sola fila');
select t.eq((select available_minutes from public.daily_plans where id = 'a8000000-0000-4000-8000-0000000000d1'), 120::smallint, 'el plan más reciente gana');

-- day_plan_prefs
insert into public.profiles (user_id, name, updated_at) values ('00000000-0000-0000-0000-00000000000a', 'A', '2030-01-01') on conflict (user_id) do nothing;
update public.profiles set day_plan_prefs = '{"minutes":120,"finanzas":false}', updated_at = '2031-01-01' where user_id = '00000000-0000-0000-0000-00000000000a';
select t.ok((select day_plan_prefs->>'minutes' = '120' from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a'), 'A guarda sus preferencias del Plan del Día');
select t.fails($$update public.profiles set day_plan_prefs = '[1,2]', updated_at = '2031-01-02' where user_id = '00000000-0000-0000-0000-00000000000a'$$, 'preferencias que no son un objeto se rechazan');
select t.fails($$update public.profiles set day_plan_prefs = jsonb_build_object('x', repeat('a', 3000)), updated_at = '2031-01-03' where user_id = '00000000-0000-0000-0000-00000000000a'$$,
               'preferencias demasiado grandes se rechazan');

-- Seguridad
select t.login('00000000-0000-0000-0000-00000000000b');
select t.eq((select count(*) from public.daily_plans), 0::bigint, 'B no ve los planes de A');
update public.daily_plans set available_minutes = 5, updated_at = '2035-01-01' where id = 'a8000000-0000-4000-8000-0000000000d1';
select t.fails($$insert into public.daily_plans (user_id, id, date, available_minutes) values ('00000000-0000-0000-0000-00000000000a', gen_random_uuid(), '2026-10-27', 60)$$,
               'B no puede crear planes a nombre de A');
select t.login('00000000-0000-0000-0000-00000000000a');
delete from public.daily_plans;
reset role;
select t.eq((select available_minutes from public.daily_plans where id = 'a8000000-0000-4000-8000-0000000000d1'), 120::smallint, 'B no cambia el plan de A y un DELETE no lo borra');
set role anon;
select t.fails($$select 1 from public.daily_plans limit 1$$, 'sin sesión no se pueden leer planes');
reset role;

-- El Plan del Día no da XP ni Oro: no hay nada en el servidor que lea daily_plans
select t.eq((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'private') and p.prosrc ilike '%daily_plans%'), 0::bigint, 'ninguna función del servidor usa daily_plans');
