# Life RPG (PWA)

Versión instalable de Life RPG. Funciona sin internet y guarda los datos en el dispositivo (IndexedDB).

## Archivos
- `index.html`: estructura de la página.
- `styles.css`: diseño.
- `game.js`: reglas de XP, niveles, rangos, rachas y logros. No guarda nada; todo se recalcula desde las actividades.
- Categorías: Curso, Finanzas, Físico, Cuidado y Lectura. Finanzas da XP × 1,25 (XP base redondeado × 1,25, redondeado otra vez); las demás × 1. Día completo = 4 categorías distintas.
- `economy.js`: reglas de Oro, cofres por nivel y objetivos mensuales. No toca XP, niveles ni logros.
- `tesoro.js`: pantallas de Tienda (Recompensas, Wishlist, Historial), Objetivos y Cofres.
- `boss.js`: Boss mensual (reglas de daño y estado, pantalla Boss, panel del Dashboard, reclamo y respaldo).
- `planner.js`: Planificador (Calendario, Agenda, panel de Hoy, Próximas misiones, completar, reprogramar, omitir, historial y estadísticas de planificación).
- `focus.js`: Temporizador de enfoque (sesión libre y Pomodoro, pausa, barra de sesión activa, guardado como actividad).
- `nav.js`: navegación. En celular: barra inferior (Inicio, Hoy, Plan, Boss, Más) y hoja "Más". Botón Atrás con historial (`pushState`/`popstate`) y enlaces internos de las notificaciones.
- `notify.js`: notificaciones en la app (permiso, activar por dispositivo, preferencias, lista de dispositivos, número en el ícono).
- `personaje.js`: Perfil avanzado (ficha, avatar, títulos, insignias destacadas, estadísticas de vida y récords).
- `storage.js`: copia local en IndexedDB (una fila por actividad + cola de pendientes). La app solo lee y escribe aquí.
- `sync.js`: inicio de sesión (email y contraseña) y sincronización con Supabase: sube pendientes, baja cambios, Realtime y reintentos.
- `config.js`: URL del proyecto, **Publishable Key** y clave VAPID **pública**. Nunca la service_role, una secret key ni la clave VAPID privada.
- `app.js`: vistas, formulario (agregar y editar), cuenta, respaldo e instalación.
- `sw.js`: modo offline, aviso de versión nueva y mostrar notificaciones push. **Sube `VERSION` en cada publicación** (las pruebas de cada PR lo comprueban).
- `vendor/supabase-2.117.2.js`: cliente de Supabase guardado en el repositorio para que funcione sin internet (licencia MIT).
- `supabase/schema.sql`: tablas, reglas RLS y trigger de "gana la versión más reciente".
- `supabase/002_oro_tienda_objetivos_cofres.sql`: Oro, tienda, compras, objetivos y cofres. Se ejecuta una vez, después de `schema.sql`.
- `supabase/003_boss_y_perfil.sql`: Bosses mensuales, `claim_boss` y columnas de avatar, título e insignias en `profiles`. Se ejecuta una vez, después de `002`.
- `supabase/004_planificador_enfoque.sql`: tablas `planned_activities` y `focus_sessions` y el trigger `protect_focus`. Se ejecuta una vez, después de `003`. Hasta ejecutarlo, la app sigue sincronizando todo lo demás y guarda planificaciones y sesiones solo en el dispositivo.
- `supabase/005_navegacion_notificaciones.sql`: recordatorio en `planned_activities`, dispositivos, preferencias, avisos y entregas por dispositivo, y las tareas de `pg_cron`. Se ejecuta una vez, después de `004`.
- `supabase/006_finanzas.sql`: agrega la categoría Finanzas. Revisa la restricción de categoría de 5 tablas conocidas y se detiene con un mensaje si algo no es lo esperado; después las reemplaza, actualiza `cat_name` y hace que cofres y Boss usen `private.activity_xp` (la misma fórmula que la app). Se ejecuta una vez, después de `005`.
- `supabase/functions/send-push/index.ts`: Edge Function que cifra y entrega los avisos (Web Push). Sus claves son secretos de la función.
- `manifest.webmanifest` + `icons/`: nombre, ícono y pantalla completa.
- `tests/`: pruebas automáticas (ver "Pruebas").
- `.github/workflows/pruebas.yml`: corre las pruebas en GitHub en cada PR y en cada cambio de `main`.

## Sincronización
- Offline-first: todo se guarda primero en el dispositivo; la cola se sube sola al volver la conexión.
- Si Supabase está pausado o caído, la app sigue funcionando y reintenta (5 s, 15 s, 1 min, luego cada 5 min).
- Conflictos: gana el `updated_at` más reciente, actividad por actividad. Borrar = `deleted_at`, nunca se borra la fila.
- Se baja lo nuevo según `synced_at` (hora del servidor), con 2 minutos de margen.

## Oro, Tienda, Objetivos y Cofres
- Oro por actividad = XP ÷ 10 (mínimo 1), +10 por día completo, +25 cada 7 días de racha, la recompensa de cada objetivo al reclamarlo y los cofres de nivel 5, 10, 15, 20, 30, 40 y 50.
- El Oro de actividades se recalcula siempre desde las actividades: editar o borrar una actividad ajusta el saldo.
- Compras, reclamos y cofres los confirma Supabase con `buy_reward`, `claim_goal` y `open_chest`. El navegador solo manda ids y la hora; precios, saldo y nivel los calcula el servidor. Sin conexión quedan en espera y se confirman una vez.
- La tienda empieza vacía: las recompensas las crea cada usuario.

## Boss mensual y Perfil avanzado
- Un Boss por mes. Su daño se calcula con las actividades de ese mes (7 tipos: XP total con bonus de día completo, minutos, actividades, por categoría o manual). Nunca se guarda.
- Estados: Activo, Casi derrotado (menos del 20 % de HP), Derrotado, Recompensa reclamada y No derrotado (mes terminado).
- La recompensa se reclama a mano y la confirma Supabase con `claim_boss`, que recalcula el daño y paga una sola vez.
- En el servidor, `protect_boss` impide que el navegador escriba `claimed_at`, congela los campos de juego de un Boss derrotado y deja inmutable uno reclamado. `single_boss_per_month` deja un solo Boss por mes y nunca reemplaza uno derrotado o reclamado.
- Títulos, atributos, récords y estadísticas se calculan en la app. Solo se guardan el avatar, el título equipado y 3 insignias, en `profiles`.

## Planificador y Temporizador de enfoque
- Planificar no da XP, Oro ni progreso. Solo una actividad real (en `activities`) los da.
- Completar una planificación crea la actividad con el mismo id que la planificación, así nunca se duplica aunque se complete en dos dispositivos. "Completada" no se guarda: se deduce de que exista esa actividad.
- Atrasada = fecha pasada sin completar ni omitir. Las de más de 7 días se agrupan en "Atrasadas anteriores", plegadas, con las mismas acciones.
- El temporizador guarda tramos con hora de inicio y fin, no un contador: sigue bien aunque se cierre o bloquee la app. Una sesión activa por dispositivo.
- El tiempo de enfoque no da XP. Al terminar se guarda como actividad (libre) o se usa para completar su planificación (sin sumar dos veces los minutos que se superponen).
- En el servidor, `protect_focus` congela una sesión finalizada o descartada, recalcula `focus_seconds` desde los tramos y descarta tramos inválidos.

## Navegación en celular
- Barra inferior con Inicio, Hoy, Plan, Boss y Más. Más abre una hoja con Historial, Estadísticas, Objetivos, Tienda, Logros y Perfil. En computadora el menú lateral no cambia.
- Atrás de Android: si hay una hoja o un diálogo abierto, lo cierra primero. Si no, vuelve a la pantalla anterior; desde Inicio sale de la app.

## Notificaciones
- Se activan en Perfil → Notificaciones, en cada dispositivo por separado. El navegador pide permiso solo al tocar "Permitir".
- Un aviso se crea una sola vez por cuenta (`notification_events`) y se entrega por dispositivo (`notification_deliveries`): uno puede llegar y otro fallar, y un dispositivo vencido (404/410) se apaga solo sin tocar los demás. Nunca se manda dos veces al mismo dispositivo.
- `pg_cron` revisa cada minuto qué avisos tocan y llama a la Edge Function `send-push`, que los cifra y entrega. La clave VAPID privada existe solo como secreto de esa función.
- Horario silencioso: solo pasa Focus; al terminar llega lo pendiente (más de 3, un resumen).

## Publicar en GitHub Pages
Rama `main`, carpeta `/` (Settings → Pages).

## Versiones nuevas
- Cada `VERSION` de `sw.js` se descarga completa en su propio caché: la app nunca abre con archivos de dos versiones mezclados. Un archivo cambiado sin subir `VERSION` no llega a los dispositivos.
- Cuando hay una versión nueva, la app muestra "Nueva versión disponible" con el botón Actualizar. No recarga sola: si no se toca, la versión nueva se usa la próxima vez que la app se abre desde cero.
- La app revisa si hay versión nueva al volver a ella y cada hora mientras está abierta.
- Desde la v7 o anteriores (que no tenían el aviso) se actualiza sola, como antes.

## Pruebas
- `node --test "tests/*.test.js"`: reglas de la app (XP, niveles, rangos, rachas, logros, Oro, cofres, objetivos y Boss) y comprobaciones de `sw.js` (todo lo que carga `index.html` está en `SHELL`, los archivos existen y `VERSION` cambia si cambió la app). No hace falta instalar nada.
- `tests/sql/run.sh`: ejecuta `schema.sql` y las migraciones 002 a 006 en un Postgres de prueba vacío (imagen `supabase/postgres`) y comprueba RLS, `buy_reward`, `claim_goal`, `open_chest`, `claim_boss`, `protect_boss`, `protect_focus`, `push_tick()` con filas corruptas y que `private.activity_xp` da lo mismo que `actXP` en las 3.600 combinaciones. Nunca usa el proyecto real.
- `tests/cases/xp.json`: casos de XP que usan las dos pruebas, así la fórmula de la app y la de Supabase no pueden separarse.
- En GitHub corren solas en cada PR (pestaña Actions).

## Respaldo
Perfil → Datos y respaldo muestra la **última exportación** de este dispositivo. Si pasaron más de 30 días (o nunca se exportó y ya hay actividades), Inicio muestra una tarjeta con "Exportar ahora" y "Más tarde" (la oculta 7 días). La fecha se registra cuando el respaldo se generó y la descarga, el menú Compartir o la copia al portapapeles se iniciaron sin cancelación ni error; el navegador no confirma que el archivo quedó guardado, por eso la app dice "exportación" y no "respaldo guardado". Se guarda solo en este dispositivo.

Exporta la versión 6 (actividades, perfil con avatar, Oro, tienda, compras, objetivos, cofres, Bosses, planificaciones con su recordatorio, sesiones de enfoque y preferencias de notificaciones) e importa respaldos de las versiones 1 a 6. Nunca incluye dispositivos, suscripciones ni claves; importar no activa notificaciones en ningún dispositivo. Un respaldo nunca copia Oro ni `claimed_at`, nunca cierra un cofre abierto ni desreclama un objetivo o un Boss: lo que falta se confirma con el servidor.
