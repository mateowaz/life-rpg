-- Boss mensual: un Boss por mes, se paga una vez y queda protegido
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000b');
insert into public.monthly_bosses (id, year, month, name, boss_type, target_hp, coin_reward, claimed_at)
  values ('b4000000-0000-4000-8000-000000000001', 2025, 5, 'Dragón', 'activities', 2, 100, now());
select t.ok((select claimed_at is null from public.monthly_bosses where id = 'b4000000-0000-4000-8000-000000000001'), 'la app no puede crear un Boss ya reclamado');
select t.eq(public.claim_boss('b4000000-0000-4000-8000-000000000001', now()), 'not_defeated', 'un Boss sin derrotar no se reclama');
update public.monthly_bosses set claimed_at = now(), updated_at = now() + interval '1 second' where id = 'b4000000-0000-4000-8000-000000000001';
select t.ok((select claimed_at is null from public.monthly_bosses where id = 'b4000000-0000-4000-8000-000000000001'), 'la app no puede escribir claimed_at');

insert into public.activities (id, date, category, title, minutes, intensity) values
  ('b4000000-0000-4000-8000-000000000011', '2025-05-03', 'lectura', 'Libro', 20, 1),
  ('b4000000-0000-4000-8000-000000000012', '2025-05-04', 'lectura', 'Libro', 20, 1);
select t.eq(public.claim_boss('b4000000-0000-4000-8000-000000000001', now()), 'ok', 'un Boss derrotado se reclama');
select t.eq(public.claim_boss('b4000000-0000-4000-8000-000000000001', now()), 'already', 'un Boss no se reclama dos veces');
select t.eq((select amount from public.coin_transactions where source = 'boss'), 100, 'el Boss paga su recompensa una vez');
update public.monthly_bosses set name = 'Otro', deleted_at = now(), updated_at = now() + interval '1 hour' where id = 'b4000000-0000-4000-8000-000000000001';
select t.ok((select name = 'Dragón' and deleted_at is null from public.monthly_bosses where id = 'b4000000-0000-4000-8000-000000000001'), 'un Boss reclamado no cambia nunca más');

-- Derrotado sin reclamar: campos de juego congelados, nombre editable
insert into public.monthly_bosses (id, year, month, name, boss_type, target_hp)
  values ('b4000000-0000-4000-8000-000000000002', 2025, 6, 'Gólem', 'minutes', 10);
insert into public.activities (id, date, category, title, minutes, intensity)
  values ('b4000000-0000-4000-8000-000000000013', '2025-06-02', 'cuidado', 'Meditar', 30, 1);
update public.monthly_bosses set target_hp = 9999, deleted_at = now(), name = 'Gólem de piedra', updated_at = now() + interval '1 second'
 where id = 'b4000000-0000-4000-8000-000000000002';
select t.ok((select target_hp = 10 and deleted_at is null from public.monthly_bosses where id = 'b4000000-0000-4000-8000-000000000002'), 'un Boss derrotado no cambia su vida ni se borra');
select t.eq((select name from public.monthly_bosses where id = 'b4000000-0000-4000-8000-000000000002'), 'Gólem de piedra', 'un Boss derrotado puede cambiar de nombre');

-- Un solo Boss por mes: si el que está guardado ya fue derrotado, el nuevo se archiva
insert into public.monthly_bosses (id, year, month, name, boss_type, target_hp)
  values ('b4000000-0000-4000-8000-000000000003', 2025, 6, 'Otro de junio', 'xp', 5000);
select t.ok((select deleted_at is not null from public.monthly_bosses where id = 'b4000000-0000-4000-8000-000000000003'), 'un segundo Boss en el mismo mes se archiva');
select t.eq((select count(*) from public.monthly_bosses where year = 2025 and month = 6 and deleted_at is null), 1::bigint, 'queda un solo Boss en junio');

select t.login('00000000-0000-0000-0000-00000000000a');
select t.eq(public.claim_boss('b4000000-0000-4000-8000-000000000002', now()), 'not_found', 'A no puede reclamar un Boss de B');
reset role;
