# Life RPG (PWA)

Versión instalable de Life RPG. Funciona sin internet y guarda los datos en el dispositivo (IndexedDB).

## Archivos
- `index.html`: estructura de la página.
- `styles.css`: diseño.
- `game.js`: reglas de XP, niveles, rangos, rachas y logros. No guarda nada; todo se recalcula desde las actividades.
- `storage.js`: copia local en IndexedDB (una fila por actividad + cola de pendientes). La app solo lee y escribe aquí.
- `sync.js`: inicio de sesión (email y contraseña) y sincronización con Supabase: sube pendientes, baja cambios, Realtime y reintentos.
- `config.js`: URL del proyecto y **Publishable Key**. Nunca la service_role ni una secret key.
- `app.js`: vistas, formulario (agregar y editar), cuenta, respaldo e instalación.
- `sw.js`: modo offline. **Sube `VERSION` en cada publicación.**
- `vendor/supabase-2.117.2.js`: cliente de Supabase guardado en el repositorio para que funcione sin internet (licencia MIT).
- `supabase/schema.sql`: tablas, reglas RLS y trigger de "gana la versión más reciente".
- `manifest.webmanifest` + `icons/`: nombre, ícono y pantalla completa.

## Sincronización
- Offline-first: todo se guarda primero en el dispositivo; la cola se sube sola al volver la conexión.
- Si Supabase está pausado o caído, la app sigue funcionando y reintenta (5 s, 15 s, 1 min, luego cada 5 min).
- Conflictos: gana el `updated_at` más reciente, actividad por actividad. Borrar = `deleted_at`, nunca se borra la fila.
- Se baja lo nuevo según `synced_at` (hora del servidor), con 2 minutos de margen.

## Publicar en GitHub Pages
Rama `main`, carpeta `/` (Settings → Pages).

## Respaldo
Perfil → Datos y respaldo. Exporta la versión 2 (con `created_at`, `updated_at`, `deleted_at`) e importa respaldos de la versión 1 y 2.
