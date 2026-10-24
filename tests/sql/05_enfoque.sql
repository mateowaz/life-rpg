-- Sesiones de enfoque: el servidor calcula los minutos con los tramos y congela las sesiones terminadas
set role authenticated;
select t.login('00000000-0000-0000-0000-00000000000b');
-- Tramos superpuestos (0–10 y 5–20 minutos), uno roto, y focus_seconds inventado por el dispositivo
insert into public.focus_sessions (id, device_id, title, category, mode, status, started_at, segments, focus_seconds)
values ('b5000000-0000-4000-8000-000000000001', 'celular', 'Estudio', 'curso', 'free', 'running', now() - interval '1 hour',
        jsonb_build_array(
          jsonb_build_array(now() - interval '60 minutes', now() - interval '50 minutes'),
          jsonb_build_array(now() - interval '55 minutes', now() - interval '40 minutes'),
          jsonb_build_array('no es una fecha', 'tampoco')),
        999999);
select t.eq((select focus_seconds from public.focus_sessions where id = 'b5000000-0000-4000-8000-000000000001'), 1200,
            'focus_seconds sale de los tramos (20 min), no del dispositivo');
select t.eq((select jsonb_array_length(segments) from public.focus_sessions where id = 'b5000000-0000-4000-8000-000000000001'), 1,
            'los tramos superpuestos se unen y el roto se descarta');

update public.focus_sessions set status = 'finished', ended_at = now(), updated_at = clock_timestamp() + interval '1 second'
 where id = 'b5000000-0000-4000-8000-000000000001';
update public.focus_sessions
   set status = 'running', focus_seconds = 5, updated_at = clock_timestamp() + interval '2 seconds',
       segments = segments || jsonb_build_array(jsonb_build_array(now() - interval '30 minutes', now()))
 where id = 'b5000000-0000-4000-8000-000000000001';
select t.ok((select status = 'finished' and focus_seconds = 1200 from public.focus_sessions where id = 'b5000000-0000-4000-8000-000000000001'),
            'una sesión finalizada no vuelve a correr ni cambia sus minutos');
update public.focus_sessions set status = 'discarded', updated_at = clock_timestamp() + interval '3 seconds' where id = 'b5000000-0000-4000-8000-000000000001';
select t.eq((select status from public.focus_sessions where id = 'b5000000-0000-4000-8000-000000000001'), 'discarded', 'una sesión finalizada se puede descartar');

insert into public.focus_sessions (id, device_id, title, category, mode, status, started_at, ended_at, segments)
values ('b5000000-0000-4000-8000-000000000002', 'celular', 'Futuro', 'lectura', 'free', 'finished', now() + interval '3 days', now() + interval '4 days', '[]');
select t.ok((select started_at <= now() + interval '1 hour' and ended_at <= now() + interval '1 hour' from public.focus_sessions where id = 'b5000000-0000-4000-8000-000000000002'),
            'las horas futuras se limitan a ahora + 1 hora');
reset role;
