-- Oro: cofres, compras y objetivos los confirma el servidor, una sola vez y sin saldo negativo
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000b');
-- 2 actividades de 500 XP = 1.000 XP → nivel 6
insert into public.activities (id, date, category, title, minutes, intensity) values
  ('b2000000-0000-4000-8000-000000000001', '2025-03-02', 'fisico', 'Maratón', 240, 3),
  ('b2000000-0000-4000-8000-000000000002', '2025-03-03', 'curso',  'Estudio', 240, 3);
reset role;
select t.eq(public.user_level('00000000-0000-0000-0000-00000000000b'), 6, 'user_level: 1.000 XP es nivel 6');

set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000b');
select t.eq(public.open_chest(5, now()), 'ok', 'cofre de nivel 5: se abre');
select t.eq(public.open_chest(5, now()), 'already', 'cofre de nivel 5: no se abre dos veces');
select t.eq(public.open_chest(10, now()), 'not_reached', 'cofre de nivel 10: nivel insuficiente');
select t.eq(public.open_chest(7, now()), 'invalid', 'nivel 7 no tiene cofre');
select t.eq((select sum(amount) from public.coin_transactions where deleted_at is null), 40::bigint, 'el cofre de nivel 5 da 40 de Oro');

insert into public.shop_items (id, name, price) values
  ('b2000000-0000-4000-8000-000000000010', 'Cena', 100),
  ('b2000000-0000-4000-8000-000000000011', 'Café', 30);
select t.eq(public.buy_reward('b2000000-0000-4000-8000-000000000020', 'b2000000-0000-4000-8000-000000000010', now()), 'rejected:balance',
            'comprar algo de 100 con 40 de Oro se rechaza');
select t.eq((select sum(amount) from public.coin_transactions where deleted_at is null), 40::bigint, 'el rechazo no toca el saldo');
select t.eq(public.buy_reward('b2000000-0000-4000-8000-000000000021', 'b2000000-0000-4000-8000-000000000011', now()), 'ok', 'comprar algo de 30 con 40 de Oro funciona');
select t.eq(public.buy_reward('b2000000-0000-4000-8000-000000000021', 'b2000000-0000-4000-8000-000000000011', now()), 'ok', 'reenviar la misma compra responde igual');
select t.eq((select sum(amount) from public.coin_transactions where deleted_at is null), 10::bigint, 'la compra repetida se cobra una sola vez');
select t.eq(public.buy_reward('b2000000-0000-4000-8000-000000000022', 'b2000000-0000-4000-8000-000000000011', now()), 'rejected:balance', 'el saldo nunca queda negativo');
select t.eq(public.buy_reward(gen_random_uuid(), 'a1000000-0000-4000-8000-000000000002', now()), 'not_found', 'no se puede comprar una recompensa de otro usuario');

insert into public.monthly_goals (id, year, month, title, goal_type, target_value, coin_reward)
  values ('b2000000-0000-4000-8000-000000000030', 2025, 3, 'Entrenar', 'activities', 2, 60);
select t.eq(public.claim_goal('b2000000-0000-4000-8000-000000000030', now()), 'not_completed', 'un objetivo sin completar no se reclama');
update public.monthly_goals set completed_at = now(), updated_at = now() + interval '1 second' where id = 'b2000000-0000-4000-8000-000000000030';
select t.eq(public.claim_goal('b2000000-0000-4000-8000-000000000030', now()), 'ok', 'un objetivo completado se reclama');
select t.eq(public.claim_goal('b2000000-0000-4000-8000-000000000030', now()), 'already', 'un objetivo no se reclama dos veces');
select t.eq((select sum(amount) from public.coin_transactions where deleted_at is null), 70::bigint, 'el objetivo paga su recompensa una vez');
update public.monthly_goals set claimed_at = null, updated_at = now() + interval '1 hour' where id = 'b2000000-0000-4000-8000-000000000030';
select t.ok((select claimed_at is not null from public.monthly_goals where id = 'b2000000-0000-4000-8000-000000000030'), 'un objetivo reclamado no vuelve a "sin reclamar"');

select t.login('00000000-0000-0000-0000-00000000000a');
select t.eq(public.claim_goal('b2000000-0000-4000-8000-000000000030', now()), 'not_found', 'A no puede reclamar un objetivo de B');
reset role;
