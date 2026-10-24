-- Rutinas (007): tabla recurring_plans, columnas nuevas de planned_activities y avisos
select t.ok((select count(*) = 3 from information_schema.columns where table_schema = 'public' and table_name = 'planned_activities'
              and column_name in ('recurring_plan_id', 'recurrence_date', 'recurrence_edited')), '007 agrega 3 columnas a planned_activities');
select t.eq((select count(*) from public.planned_activities where recurring_plan_id is not null or recurrence_edited), 0::bigint,
            'las planificaciones que ya existían quedan como manuales y sin tocar');

set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000a');
insert into public.recurring_plans (id, series_id, title, category, weekdays, start_date, time, planned_minutes, intensity, reminder_minutes)
values ('a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'Gym', 'fisico', '{1,3,5}', '2026-10-01', '18:00', 90, 2, 30);
select t.eq((select count(*) from public.recurring_plans), 1::bigint, 'A crea su rutina');
select t.fails($$insert into public.recurring_plans (id, series_id, title, category, weekdays, start_date, planned_minutes, intensity)
                 values (gen_random_uuid(), gen_random_uuid(), 'x', 'curso', '{0,8}', '2026-10-01', 30, 1)$$, 'días fuera de 1–7 se rechazan');
select t.fails($$insert into public.recurring_plans (id, series_id, title, category, weekdays, start_date, planned_minutes, intensity)
                 values (gen_random_uuid(), gen_random_uuid(), 'x', 'curso', '{}', '2026-10-01', 30, 1)$$, 'una rutina sin días se rechaza');
select t.fails($$insert into public.recurring_plans (id, series_id, title, category, weekdays, start_date, end_date, planned_minutes, intensity)
                 values (gen_random_uuid(), gen_random_uuid(), 'x', 'curso', '{1}', '2026-10-10', '2026-10-01', 30, 1)$$, 'fecha de fin antes del inicio se rechaza');
select t.fails($$insert into public.recurring_plans (id, series_id, title, category, weekdays, start_date, planned_minutes, intensity, reminder_minutes)
                 values (gen_random_uuid(), gen_random_uuid(), 'x', 'curso', '{1}', '2026-10-01', 30, 1, 10)$$, 'recordatorio sin hora se rechaza');
select t.fails($$insert into public.recurring_plans (id, series_id, title, category, weekdays, start_date, planned_minutes, intensity)
                 values (gen_random_uuid(), gen_random_uuid(), 'x', 'curso', '{1}', '2026-10-01', 300, 1)$$, 'más de 240 minutos se rechaza');

-- Gana la versión más reciente
update public.recurring_plans set time = '19:00', updated_at = '2030-01-01T10:00:00Z' where id = 'a7000000-0000-4000-8000-000000000001';
update public.recurring_plans set time = '20:00', updated_at = '2030-01-01T09:00:00Z' where id = 'a7000000-0000-4000-8000-000000000001';
select t.eq((select time from public.recurring_plans where id = 'a7000000-0000-4000-8000-000000000001'), '19:00'::time, 'un cambio más viejo de la rutina se ignora');

-- La misma misión subida por dos dispositivos (mismo id estable) queda en una sola fila
insert into public.planned_activities (id, date, title, category, planned_minutes, intensity, recurring_plan_id, recurrence_date, updated_at)
values ('a7000000-0000-4000-8000-000000000010', '2026-10-26', 'Gym', 'fisico', 90, 2, 'a7000000-0000-4000-8000-000000000001', '2026-10-26', '2026-10-24T10:00:00Z')
on conflict (user_id, id) do update set title = excluded.title, updated_at = excluded.updated_at;
insert into public.planned_activities (id, date, title, category, planned_minutes, intensity, recurring_plan_id, recurrence_date, updated_at)
values ('a7000000-0000-4000-8000-000000000010', '2026-10-26', 'Gym', 'fisico', 90, 2, 'a7000000-0000-4000-8000-000000000001', '2026-10-26', '2026-10-24T10:00:01Z')
on conflict (user_id, id) do update set title = excluded.title, updated_at = excluded.updated_at;
select t.eq((select count(*) from public.planned_activities where recurring_plan_id = 'a7000000-0000-4000-8000-000000000001' and recurrence_date = '2026-10-26'),
            1::bigint, 'dos dispositivos generando el mismo día dejan una sola fila');
select t.fails($$insert into public.planned_activities (id, date, title, category, planned_minutes, intensity, recurring_plan_id)
                 values (gen_random_uuid(), '2026-10-26', 'x', 'curso', 30, 1, 'a7000000-0000-4000-8000-000000000001')$$,
               'recurring_plan_id sin recurrence_date se rechaza');

-- Seguridad
select t.login('00000000-0000-0000-0000-00000000000b');
select t.eq((select count(*) from public.recurring_plans), 0::bigint, 'B no ve las rutinas de A');
update public.recurring_plans set title = 'Cambiado por B', updated_at = '2031-01-01' where id = 'a7000000-0000-4000-8000-000000000001';
select t.fails($$insert into public.recurring_plans (id, user_id, series_id, title, category, weekdays, start_date, planned_minutes, intensity)
                 values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'x', 'curso', '{1}', '2026-10-01', 30, 1)$$,
               'B no puede crear rutinas a nombre de A');
select t.login('00000000-0000-0000-0000-00000000000a');
delete from public.recurring_plans;
reset role;
select t.ok((select title = 'Gym' from public.recurring_plans where id = 'a7000000-0000-4000-8000-000000000001'), 'B no cambia la rutina de A y un DELETE no la borra');
set role anon;
select t.fails($$select 1 from public.recurring_plans limit 1$$, 'sin sesión no se pueden leer rutinas');
reset role;

-- Avisos: recordatorio igual para todas; "atrasada" solo para las manuales
delete from public.notification_events; delete from public.notification_deliveries;
insert into public.push_subscriptions (user_id, device_id, device_name, endpoint, p256dh, auth)
values ('00000000-0000-0000-0000-00000000000a', 'celular', 'Celular', 'https://push.example.com/a', repeat('C', 87), repeat('D', 22));
-- Zona horaria donde ahora es mediodía, así la prueba nunca cruza la medianoche
insert into public.notification_preferences (user_id, timezone)
select '00000000-0000-0000-0000-00000000000a',
       case when h >= 0 then 'Etc/GMT-' || h else 'Etc/GMT+' || (-h) end
  from (select 12 - extract(hour from now() at time zone 'UTC')::int as h) x;
create temp table tz as select timezone as z from public.notification_preferences where user_id = '00000000-0000-0000-0000-00000000000a';
select t.ok((select extract(hour from now() at time zone z) between 11 and 13 from tz), 'zona horaria de prueba al mediodía');
-- Empieza en 10 minutos con recordatorio de 30: ya toca avisar
insert into public.planned_activities (user_id, id, date, time, title, category, planned_minutes, intensity, reminder_minutes, recurring_plan_id, recurrence_date)
select '00000000-0000-0000-0000-00000000000a'::uuid, 'a7000000-0000-4000-8000-000000000020'::uuid, (now() at time zone z)::date, ((now() at time zone z) + interval '10 minutes')::time(0),
       'Rutina pronto', 'curso', 30, 1, 30, 'a7000000-0000-4000-8000-000000000001'::uuid, (now() at time zone z)::date from tz;
-- Empezaron hace 2 horas (ventana de "atrasada" abierta): una de rutina y una manual
insert into public.planned_activities (user_id, id, date, time, title, category, planned_minutes, intensity, recurring_plan_id, recurrence_date)
select '00000000-0000-0000-0000-00000000000a'::uuid, 'a7000000-0000-4000-8000-000000000021'::uuid, (now() at time zone z)::date, ((now() at time zone z) - interval '2 hours')::time(0),
       'Rutina atrasada', 'lectura', 20, 1, 'a7000000-0000-4000-8000-000000000001'::uuid, (now() at time zone z)::date from tz
union all
select '00000000-0000-0000-0000-00000000000a'::uuid, 'a7000000-0000-4000-8000-000000000022'::uuid, (now() at time zone z)::date, ((now() at time zone z) - interval '2 hours')::time(0),
       'Manual atrasada', 'lectura', 20, 1, null::uuid, null::date from tz;
select private.push_tick();
select t.eq((select count(*) from public.notification_events where logical_id like 'plan:a7000000-0000-4000-8000-000000000020:reminder:%'), 1::bigint,
            'una misión de rutina manda su recordatorio con el motor de siempre');
select t.eq((select count(*) from public.notification_events where logical_id like 'plan:a7000000-0000-4000-8000-000000000021:overdue:%'), 0::bigint,
            'una misión de rutina atrasada no manda aviso de atrasada');
select t.eq((select count(*) from public.notification_events where logical_id like 'plan:a7000000-0000-4000-8000-000000000022:overdue:%'), 1::bigint,
            'una planificación manual atrasada sigue mandando su aviso');
