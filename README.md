# Life RPG (PWA)

Versión instalable de Life RPG. Funciona sin internet y guarda los datos en el dispositivo (IndexedDB).

## Archivos
- `index.html`: estructura de la página.
- `styles.css`: diseño.
- `game.js`: reglas de XP, niveles, rangos, rachas y logros. No guarda nada; todo se recalcula desde las actividades.
- `economy.js`: reglas de Oro, cofres por nivel y objetivos mensuales. No toca XP, niveles ni logros.
- `tesoro.js`: pantallas de Tienda (Recompensas, Wishlist, Historial), Objetivos y Cofres.
- `boss.js`: Boss mensual (reglas de daño y estado, pantalla Boss, panel del Dashboard, reclamo y respaldo).
- `planner.js`: Planificador (Calendario, Agenda, panel de Hoy, Próximas misiones, completar, reprogramar, omitir, historial y estadísticas de planificación).
- `focus.js`: Temporizador de enfoque (sesión libre y Pomodoro, pausa, barra de sesión activa, guardado como actividad).
- `personaje.js`: Perfil avanzado (ficha, avatar, títulos, insignias destacadas, estadísticas de vida y récords).
- `storage.js`: copia local en IndexedDB (una fila por actividad + cola de pendientes). La app solo lee y escribe aquí.
- `sync.js`: inicio de sesión (email y contraseña) y sincronización con Supabase: sube pendientes, baja cambios, Realtime y reintentos.
- `config.js`: URL del proyecto y **Publishable Key**. Nunca la service_role ni una secret key.
- `app.js`: vistas, formulario (agregar y editar), cuenta, respaldo e instalación.
- `sw.js`: modo offline. **Sube `VERSION` en cada publicación.**
- `vendor/supabase-2.117.2.js`: cliente de Supabase guardado en el repositorio para que funcione sin internet (licencia MIT).
- `supabase/schema.sql`: tablas, reglas RLS y trigger de "gana la versión más reciente".
- `supabase/002_oro_tienda_objetivos_cofres.sql`: Oro, tienda, compras, objetivos y cofres. Se ejecuta una vez, después de `schema.sql`.
- `supabase/003_boss_y_perfil.sql`: Bosses mensuales, `claim_boss` y columnas de avatar, título e insignias en `profiles`. Se ejecuta una vez, después de `002`.
- `supabase/004_planificador_enfoque.sql`: tablas `planned_activities` y `focus_sessions` y el trigger `protect_focus`. Se ejecuta una vez, después de `003`. Hasta ejecutarlo, la app sigue sincronizando todo lo demás y guarda planificaciones y sesiones solo en el dispositivo.
- `manifest.webmanifest` + `icons/`: nombre, ícono y pantalla completa.

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

## Publicar en GitHub Pages
Rama `main`, carpeta `/` (Settings → Pages).

## Respaldo
Perfil → Datos y respaldo. Exporta la versión 5 (actividades, perfil con avatar, Oro, tienda, compras, objetivos, cofres, Bosses, planificaciones y sesiones de enfoque) e importa respaldos de las versiones 1 a 5. Un respaldo nunca copia Oro ni `claimed_at`, nunca cierra un cofre abierto ni desreclama un objetivo o un Boss: lo que falta se confirma con el servidor.
