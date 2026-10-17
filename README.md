# Life RPG (PWA)

Versión instalable de Life RPG. Funciona sin internet y guarda los datos en el dispositivo (IndexedDB).

## Archivos
- `index.html`: estructura de la página.
- `styles.css`: diseño (igual que la versión de Claude).
- `game.js`: reglas de XP, niveles, rangos, rachas y logros. No guarda nada; todo se recalcula desde las actividades.
- `storage.js`: única capa de guardado (`Store`). Aquí se agrega la sincronización futura.
- `app.js`: vistas, formulario, respaldo e instalación.
- `sw.js`: modo offline. **Sube `VERSION` en cada publicación.**
- `manifest.webmanifest` + `icons/`: nombre, ícono y pantalla completa.

## Publicar en GitHub Pages
Subir esta carpeta a la raíz del repositorio y activar Pages (Settings → Pages → rama `main`, carpeta `/`).

## Pasar datos desde la versión de Claude
Perfil → Datos y respaldo → Exportar datos en la versión de Claude, e Importar datos en la PWA. Mismo formato JSON.

## Sincronización futura (PC ↔ celular)
`storage.js` ya registra qué días cambiaron (`outbox`), qué actividades se borraron (`tombstones`) y un id por dispositivo.
Para sincronizar, agregar un servicio remoto (por ejemplo Supabase) que envíe esos cambios, traiga los remotos y combine por id de actividad.
