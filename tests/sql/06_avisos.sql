-- Notificaciones: lectura segura de números y una fila corrupta nunca frena push_tick()
select t.eq(private.safe_int('25', 0), 25, 'safe_int: "25"');
select t.eq(private.safe_int(' 25 ', 0), 25, 'safe_int: espacios');
select t.eq(private.safe_int('25.4', 0), 25, 'safe_int: decimal redondeado');
select t.eq(private.safe_int('abc', 7), 7, 'safe_int: texto → valor por defecto');
select t.eq(private.safe_int(null, 7), 7, 'safe_int: vacío → valor por defecto');
select t.eq(private.safe_int('99999999999', 7), 7, 'safe_int: número enorme → valor por defecto');
select t.eq(private.pomo_int('{"focus":"500"}', 'focus'), 25, 'pomo_int: fuera de rango → 25');
select t.eq(private.pomo_int('"texto"', 'focus'), 25, 'pomo_int: pomodoro que no es objeto → 25');
select t.eq(private.pomo_int('{"every":"3"}', 'every'), 3, 'pomo_int: valor válido');

-- Un dispositivo activo para B
insert into public.push_subscriptions (user_id, device_id, device_name, endpoint, p256dh, auth)
values ('00000000-0000-0000-0000-00000000000b', 'celular', 'Celular', 'https://push.example.com/b',
        repeat('A', 87), repeat('B', 22));

-- Tres sesiones Pomodoro corruptas y una buena cuyo enfoque terminó hace 1 minuto
insert into public.focus_sessions (user_id, id, device_id, title, category, mode, status, started_at, pomodoro) values
  ('00000000-0000-0000-0000-00000000000b', 'b6000000-0000-4000-8000-000000000001', 'pc', 'Rota 1', 'curso', 'pomodoro', 'running', now() - interval '30 minutes',
   '{"phase":"focus","ends_at":"no es una fecha"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b6000000-0000-4000-8000-000000000002', 'pc', 'Rota 2', 'curso', 'pomodoro', 'running', now() - interval '30 minutes',
   '"texto"'),
  ('00000000-0000-0000-0000-00000000000b', 'b6000000-0000-4000-8000-000000000003', 'pc', 'Rota 3', 'curso', 'pomodoro', 'running', now() - interval '30 minutes',
   '{"phase":"focus","ends_at":"99999-01-01T00:00:00Z","focus":"mucho","every":"-1"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b6000000-0000-4000-8000-000000000004', 'pc', 'Buena', 'curso', 'pomodoro', 'running', now() - interval '30 minutes',
   jsonb_build_object('phase', 'focus', 'ends_at', now() - interval '1 minute', 'focus', 25, 'short', 5, 'long', 15, 'every', 4, 'done', 0));

select t.ok(private.push_tick() >= 1, 'push_tick termina aunque haya sesiones corruptas');
select t.eq((select count(*) from public.notification_events where logical_id like 'focus:b6000000-0000-4000-8000-000000000004:focus:%'), 1::bigint,
            'la sesión buena genera su aviso de fin de enfoque');
select t.eq((select count(*) from public.notification_deliveries d where d.logical_id like 'focus:b6000000-0000-4000-8000-000000000004:%' and d.device_id = 'celular'), 1::bigint,
            'el aviso tiene una entrega para el dispositivo');
select t.eq(private.push_tick(), 0, 'una segunda pasada no repite el aviso');
