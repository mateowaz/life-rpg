# Life RPG (PWA)

Versión instalable de Life RPG. Funciona sin internet y guarda los datos en el dispositivo (IndexedDB).

## Archivos
- `index.html`: estructura de la página.
- `styles.css`: diseño.
- `game.js`: reglas de XP, niveles, rangos, rachas y logros. No guarda nada; todo se recalcula desde las actividades.
- `economy.js`: reglas de Oro, cofres por nivel y objetivos mensuales. No toca XP, niveles ni logros.
- `tesoro.js`: pantallas de Tienda (Recompensas, Wishlist, Historial), Objetivos y Cofres.
- `storage.js`: copia local en IndexedDB (una fila por actividad + cola de pendientes). La app solo lee y escribe aquí.
- `sync.js`: inicio de sesión (email y contraseña) y sincronización con Supabase: sube pendientes, baja cambios, Realtime y reintentos.
- `config.js`: URL del proyecto y **Publishable Key**. Nunca la service_role ni una secret key.
- `app.js`: vistas, formulario (agregar y editar), cuenta, respaldo e instalación.
- `sw.js`: modo offline. **Sube `VERSION` en cada publicación.**
- `vendor/supabase-2.117.2.js`: cliente de Supabase guardado en el repositorio para que funcione sin internet (licencia MIT).
- `supabase/schema.sql`: tablas, reglas RLS y trigger de "gana la versión más reciente".
- `supabase/002_oro_tienda_objetivos_cofres.sql`: Oro, tienda, compras, objetivos y cofres. Se ejecuta una vez, después de `schema.sql`.
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

## Publicar en GitHub Pages
Rama `main`, carpeta `/` (Settings → Pages).

## Respaldo
Perfil → Datos y respaldo. Exporta la versión 3 (actividades, perfil, Oro, tienda, compras, objetivos y cofres) e importa respaldos de la versión 1, 2 y 3. Un respaldo nunca copia Oro, nunca cierra un cofre abierto ni desreclama un objetivo: lo que falta se confirma con el servidor.
