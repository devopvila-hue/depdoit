# Minimal Board

Un Trello con la misma idea central y sin el resto. Tres archivos, cero dependencias,
sin build, sin cuenta y sin red. Se abre con doble clic.

```
open index.html
```

---

## Cómo funciona Trello (medido, no supuesto)

Analicé el OpenAPI público de Trello (`developer.atlassian.com/cloud/trello/swagger.json`,
511 KB) y los assets que su app sirve antes de pintar un tablero:

| Medición | Valor |
|---|---|
| Rutas en la API | **191** |
| Operaciones (GET/POST/PUT/DELETE…) | **~309** |
| Esquemas | **63** |
| Campos de `Card` | **33** |
| Campos de `Member` | **42** |
| Campos de `Board` | **26** |
| `core.css` (solo estilos) | **248 KB** raw · 32 KB gzip |
| `bootstrap.js` | 16 KB raw · 6,3 KB gzip |
| `quickload.js` | 48 KB raw · 13,4 KB gzip |
| **Subtotal de entrada (gzip)** | **≈ 52 KB** |

El modelo útil cabe en tres entidades: **Board → List → Card**. Todo lo demás
(organizaciones, enterprises, plugins, members, tokens, webhooks, custom fields,
notifications, saved searches, Power-Ups) es superficie de empresa y de add-ons, no
producto. De los 33 campos de `Card`, el usuario toca quizá cinco.

El peso medido de esa superficie es real: **52 KB comprimidos antes de iniciar sesión**,
y a partir de ahí el tablero carga trocitos perezosos que ninguna app de kanban necesita
para mover cuatro columnas.

### Qué se conserva y qué se tira

**Se conserva** — el núcleo que ya era bueno: tableros, listas ordenadas, tarjetas,
etiquetas, checklists, arrastre entre columnas, filtros.

**Se tira** — cuentas, organizaciones, membresías, permisos, plugins, Power-Ups,
notificaciones, integraciones, bots, automatizaciones, plantillas de galería,
favoritos, SSO, facturación, historial de acciones por entity, viewpoints compartidos.

---

## Las siete cosas que lo hacen mejor

1. **El panel de detalle es un cajón, no un modal.** En Trello, abrir una tarjeta tapa el
   tablero: pierden el contexto y cierras para volver a orientarte. Aquí el tablero sigue
   visible y editable mientras editas.

2. **Todo se hace con teclado.** `N` crea y ya está escribiendo. `J`/`K` recorren, `E`
   renombra en línea, `F` pone fecha, `X` archiva, `Space` completa, `Tab` salta a la
   siguiente lista, `⌘K` abre la paleta. El ratón es opcional, no obligatorio.

3. **Fechas en lenguaje natural y calendario.** Cada tarea tiene **inicio y fin**, no una
   sola fecha. El botón 📅 abre un calendario con navegación de mes, atajos (Hoy / Mañana /
   +1 semana) y el rango resaltado. Y si prefieres escribir, acepta `mañana`, `in 3 days`,
   `în 3 zile`, `24/12`, `2026-12-24`, `viernes`, `sâmbătă` — en cualquiera de los tres
   idiomas, sea cual sea el de la interfaz. Nunca deja el inicio después del fin: si lo
   intentas, empuja el otro extremo. Trello te da un único "vencimiento" y un selector
   de calendario que te interrumpe el flujo.

4. **El orden es el índice del array, no un decimal.** Trello usa posiciones fraccionarias
   (`pos`) que se degradan con ediciones concurrentes y exigen renormalizar. Aquí el orden
   *es* la posición: imposible que se corrompa.

5. **WIP visible.** El contador de cada lista se pone rojo al superar su límite. Si quieres
   que importe de verdad, tiene que doler.

6. **Autocompletado al 100 %.** Al terminar una checklist aparece un aviso que mueve la
   tarjeta a la lista *Hecho* en un clic. Es el paso que siempre se olvida.

7. **Cero configuración.** No hay cuenta, ni onboarding, ni organizational structure, ni
   permisos. Abres y trabajas. Los datos viven en `localStorage`; exportas a JSON cuando
   quieras.

### Idiomas · English · Română · Español

Tres idiomas completos, no un esqueleto: interfaz, panel, ayuda, avisos, `prompt`/`confirm`,
etiquetas, calendario, fechas relativas y el contenido de ejemplo. Las tres tablas del
diccionario tienen **148 claves idénticas** — verificado que no falta ni sobra ninguna.

El idioma se elige en la barra superior, se guarda solo y, si el navegador no lo dice, se
detecta desde `navigator.language`. Las fechas usan el formato del idioma activo
(`ro-RO` escribe *24 dec.*, `es-ES` *24 dic.*, `en-GB` *24 Dec*).

**Los datos del usuario nunca se traducen automáticamente.** Traducir a ciegas el trabajo de
alguien sería destructivo. Solo el contenido de demostración se regenera al cambiar de idioma,
y solo mientras siga intacto: en cuanto haces cualquier acción, la bandera `__demo` se apaga
y tus tarjetas se quedan como están, aunque la interfaz cambie.

Por eso el parser de fechas acepta los tres idiomas siempre: puedes escribir `în 3 zile` con
la interfaz en español, o `in 5 days` con la interfaz en rumano.

### El peso

| | raw | gzip |
|---|---|---|
| **Minimal Board** (los 4 archivos) | **119 KB** | **31 KB** |
| Trello (solo entrada, sin login) | 312 KB | 52 KB |

**1,7× menos** que Trello antes de iniciar sesión — y sin carga diferida detrás.
Además: sin `package.json`, sin `node_modules`, sin cadena de build que envejezca.
Los tres idiomas completos cuestan **6 KB gzip**; el calendario, **2 KB**.

---

## Teclado

| Acción | Atajo |
|---|---|
| Nueva tarjeta (lista activa) | `N` |
| Nueva lista | `⇧`+`N` |
| Renombrar en línea | `E` |
| Editar descripción | `D` |
| Fecha natural | `F` |
| Completar ↔ reabrir | `Space` |
| Mover a la lista siguiente | `Tab` |
| Archivar | `X` |
| Recorrer tarjetas | `J` / `K` |
| Saltar a lista 1–9 | `1`…`9` |
| Buscar | `/` |
| Paleta de comandos | `⌘K` |
| Deshacer / rehacer | `⌘Z` / `⇧⌘Z` |
| Ayuda completa | `?` |

---

## Estructura

```
index.html    87 líneas — el shell; todo lo demás se renderiza desde JS
styles.css  1066 líneas — tokens → layout → componentes → calendario → responsive
i18n.js      680 líneas — diccionario en/ro/es (148 claves), t(), detección de idioma
app.js      1918 líneas — store, undo, render, drag, teclado, paleta, fechas, calendario
```

`app.js` va en secciones numeradas: utilidades, paleta de etiquetas, estado, persistencia,
deshacer/rehacer, selectores, toasts, mutaciones, render, foco, selección, compositor,
menús, import/export, drag & drop, paleta, eventos, arranque.

Cargar como script clásico (no módulo ES) es deliberado: los módulos ES fallan bajo
`file://` por CORS, y así esto funciona con doble clic y también servido por HTTP.

### Verificado en navegador

Carga inicial, render de los 9 datos semilla, consola sin errores, apertura del panel,
edición de descripción, alta de ítems de checklist con `Enter`, marcado, toggle de
etiquetas, cambio de lista desde el panel, búsqueda, filtro por etiqueta, arrastre entre
listas, reordenación dentro de la misma lista, flujo `N` → escribir → `Enter`, deshacer,
modo claro y oscuro, tema en `localStorage`.

**Multilingüe:** conmutación en/ro/es en caliente; demo regenerada en cada idioma; datos del
usuario conservados al cambiar de idioma; parser de fechas con 11 entradas mezclando los tres
idiomas (todas correctas); ayuda, panel, etiquetas, avisos y `prompt`/`confirm` traducidos;
sin solape entre el selector de idioma y el panel abierto.

**Calendario:** apertura, elección de día sin cerrarse, navegación de mes ida y vuelta,
rango resaltado, los tres atajos, duración calculada (23→26 = 4 días), protección
inicio ≤ fin, escritura en lenguaje natural dentro del propio calendario y cierre al pulsar
fuera.

### Bugs encontrados y corregidos durante la verificación

- **Desfase de índice al arrastrar** dentro de la misma lista: cada destino caía una posición más abajo.
- **Robo de foco**: los campos que creaban contenido re-renderizaban en cada tecla, así que solo dejaban escribir un carácter. Ahora confirman con `Enter`.
- **`[object Object]`** en el campo de fecha: se interpolaba el objeto `dueMeta` en vez de su texto.
- **Colisión `⇧N`**: creaba una tarjeta en vez de una lista.
- **El panel tapaba la barra superior** con el selector de idioma y los botones de la derecha inaccesibles; ahora el tablero reserva el espacio en pantallas anchas.
- **El selector de idioma mostraba el nombre del idioma activo** en las tres opciones, en vez del endónimo de cada uno.
- **El calendario se cerraba solo al usarlo**: al elegir un día el popover se reconstruía, el `e.target` quedaba desacoplado del DOM y `closest()` devolvía `null`, así que el cierre-por-clic-externo lo disparaba. Resuelto con `composedPath()`, que se calcula al despachar el evento.

---

## Relay — el gestor de incidencias, en la misma carpeta

Este repo también contiene **Relay**, un gestor de proyectos, incidencias y sprints
tipo Jira. Vive en `relay/` y no toca nada del Minimal Board de la raíz.

### Qué es

- Node puro: `node:http`, `node:sqlite`, `node:test`. Cero dependencias, cero build.
- API REST local: proyectos, incidencias, sprints, tablero, usuarios y traducciones.
- Tablero kanban con arrastrar y soltar, vista de lista con filtros, vista de sprint,
  **vista Gantt** con escala automática (día, semana o mes) y backlog.
- Interfaz en **español, inglés, rumano y húngaro**.
- Traducción automática del texto de cada incidencia con MiniMax, o a mano.

### El mismo login que la app de tareas

Si Relay se sirve en el mismo origen que la app de tareas (`tasks.departify.app`),
**no hay un segundo login**: lee la sesión de Supabase que ya existe en
`localStorage['depdoit:session']` —mismo formato, mismo refresco— y el servidor la
valida contra ese mismo proyecto Supabase. Se conservan el acceso y las invitaciones.

```bash
cd relay
SUPABASE_URL='https://<proyecto>.supabase.co' \
SUPABASE_ANON_KEY='<clave pública>' \
npm start
```

Sin esas variables, Relay arranca en `127.0.0.1:4310` para uso local, o protegido con
`RELAY_TOKEN=...` si se publica.

Los datos de Relay viven en su propio SQLite (`relay/data/relay.db`, no se sube). Para
que también vivan en Supabase habría que crear sus tablas y sus políticas RLS: ese
paso de base de datos todavía está pendiente.

### Cómo se arranca

```bash
cd relay
npm test     # 42 tests, sin dependencias externas
npm start    # http://127.0.0.1:4310
```

`npm run seed` deja un proyecto de ejemplo con incidencias, sprint y equipo.

---

## Lo que NO tiene (a propósito)

Sin servidor ni sincronización multiusuario · sin adjuntos ni subida de ficheros ·
sin búsqueda de texto completo · sin asignación de miembros · sin recordatorios ·
sin comentarios · sin informes · sin importador de CSV · sin API ni webhooks ·
sin dependencias externas ni tareas recurrentes.

Todos ellos son disproportionately caros frente a lo que aporta. Añádelos cuando de
verdad hagan falta, no por defecto.