-- Seguridad: cada usuario solo ve y cambia lo suyo
select t.eq((select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), null::text,
            'todas las tablas de public tienen RLS activado');

set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000a');
insert into public.activities (id, date, category, title, minutes, intensity, updated_at)
  values ('a1000000-0000-4000-8000-000000000001', '2025-03-01', 'curso', 'Clase', 30, 2, '2025-03-01T10:00:00Z');
insert into public.shop_items (id, name, price) values ('a1000000-0000-4000-8000-000000000002', 'Película', 50);
insert into public.monthly_goals (id, year, month, title, goal_type, target_value)
  values ('a1000000-0000-4000-8000-000000000003', 2025, 3, 'Leer', 'activities', 5);
insert into public.planned_activities (id, date, title, category, planned_minutes, intensity)
  values ('a1000000-0000-4000-8000-000000000004', '2025-03-05', 'Entrenar', 'fisico', 45, 2);
select t.eq((select count(*) from public.activities), 1::bigint, 'A ve su actividad');
select t.ok((select user_id from public.activities) = '00000000-0000-0000-0000-00000000000a', 'la fila queda a nombre de A');

select t.login('00000000-0000-0000-0000-00000000000b');
select t.eq((select count(*) from public.activities), 0::bigint, 'B no ve las actividades de A');
select t.eq((select count(*) from public.shop_items), 0::bigint, 'B no ve la tienda de A');
select t.eq((select count(*) from public.monthly_goals), 0::bigint, 'B no ve los objetivos de A');
select t.eq((select count(*) from public.planned_activities), 0::bigint, 'B no ve las planificaciones de A');
update public.activities set title = 'Cambiado por B', updated_at = '2030-01-01' where id = 'a1000000-0000-4000-8000-000000000001';
select t.fails($$insert into public.activities (id, user_id, date, category, title, minutes, intensity)
                 values ('b1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000a', '2025-03-01', 'curso', 'x', 10, 1)$$,
               'B no puede crear filas a nombre de A');
select t.fails($$insert into public.coin_transactions (id, amount, type, source, source_id) values (gen_random_uuid(), 500, 'earn', 'goal', 'x')$$,
               'la app no puede escribirse Oro de objetivos: solo lo hace claim_goal');
reset role;
select t.eq((select title from public.activities where id = 'a1000000-0000-4000-8000-000000000001'), 'Clase', 'B no puede cambiar la actividad de A');

-- Borrar filas: no hay política de DELETE, así que un DELETE no borra nada (borrar es poner deleted_at)
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000a');
delete from public.activities;
delete from public.shop_items;
reset role;
select t.eq((select count(*) from public.activities where user_id = '00000000-0000-0000-0000-00000000000a'), 1::bigint, 'un DELETE de la app no borra actividades');
select t.eq((select count(*) from public.shop_items where user_id = '00000000-0000-0000-0000-00000000000a'), 1::bigint, 'un DELETE de la app no borra recompensas');

set role anon;
select t.fails($$select 1 from public.activities limit 1$$, 'sin sesión no se puede leer nada');
reset role;

-- Gana la versión más reciente
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000a');
update public.activities set title = 'Vieja', updated_at = '2025-02-01' where id = 'a1000000-0000-4000-8000-000000000001';
select t.eq((select title from public.activities where id = 'a1000000-0000-4000-8000-000000000001'), 'Clase', 'un cambio más viejo se ignora');
update public.activities set title = 'Nueva', updated_at = '2025-03-02' where id = 'a1000000-0000-4000-8000-000000000001';
select t.eq((select title from public.activities where id = 'a1000000-0000-4000-8000-000000000001'), 'Nueva', 'un cambio más nuevo se guarda');

-- Categorías
insert into public.activities (id, date, category, title, minutes, intensity)
  values ('a1000000-0000-4000-8000-000000000005', '2025-03-01', 'finanzas', 'Presupuesto', 20, 1);
select t.ok(true, 'Finanzas se acepta como categoría');
select t.fails($$insert into public.activities (id, date, category, title, minutes, intensity)
                 values (gen_random_uuid(), '2025-03-01', 'otra', 'x', 10, 1)$$, 'una categoría desconocida se rechaza');
select t.fails($$insert into public.activities (id, date, category, title, minutes, intensity)
                 values (gen_random_uuid(), '2025-03-01', 'curso', 'x', 241, 1)$$, 'más de 240 minutos se rechaza');
reset role;
