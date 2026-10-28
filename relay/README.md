# Relay

Gestor local de proyectos, incidencias y sprints para equipo. Es la alternativa
propia a Jira que corre **enteramente en tu Mac**: sin Docker, sin servicios
remotos, sin cuentas y sin una sola petición a internet.

> Este proyecto vive ahora dentro de [devopvila-hue/depdoit](https://github.com/devopvila-hue/depdoit),
> en la carpeta `relay/`, junto al Minimal Board. Este repositorio queda como espejo.

## Arranque

```bash
cd ~/Documents/Jira
npm start            # http://127.0.0.1:4310
```

No hace falta `npm install`: el proyecto **no tiene dependencias**. Usa solo
módulos nativos de Node (`node:http`, `node:sqlite`, `node:test`).

Requiere Node 22.5 o superior (probado con Node 24.13).

### Datos de ejemplo

```bash
npm run seed         # crea WEB con 5 incidencias y un sprint
```

La base de datos vive en `data/relay.db` (SQLite). Para empezar de cero:
`rm -f data/relay.db*`.

### Tests

```bash
npm test             # node:test, sin dependencias externas
```

## Qué incluye

- **Proyectos** con clave corta (`WEB-12`), descripción y contador de incidencias.
- **Incidencias** de tipo épica, historia, tarea o error, con estado, prioridad,
  responsable, etiquetas, descripción, comentarios y fechas de inicio y fin.
- **Sprints** con objetivo, fechas y ciclo de vida *planificado → activo →
  completado*. Solo puede haber un sprint activo por proyecto, y una incidencia
  pertenece a un único sprint.
- **Tablero** kanban con cinco columnas y arrastrar y soltar para cambiar el
  estado.
- **Vista de lista** con filtros por estado, tipo y responsable, y búsqueda por
  texto.
- **Vista de sprint** con progreso, issues asignadas y alta desde el backlog.
- **Vista Gantt** con escala adaptativa (día, semana o mes según el rango),
  agrupación por sprint, barras por estado y la línea de hoy.
- **Backlog** con todo lo que no está en un sprint.
- **Cuatro idiomas** de interfaz: español, inglés, rumano y húngaro. El idioma
  se elige en la barra superior y se recuerda en el navegador.
- **Traducción del contenido** de las incidencias al resto de idiomas.

## Traducción automática

Por defecto **no sale nada de tu máquina**: sin clave de API las traducciones se
escriben a mano desde la ficha de la incidencia.

Si configuras una clave, cada incidencia nueva se traduce sola al resto de
idiomas en segundo plano, con un proveedor compatible con OpenAI (MiniMax por
defecto). Solo se envía el texto de la incidencia.

```bash
export LLM_API_KEY='tu-clave'
export LLM_BASE_URL='https://api.minimax.io/v1'   # opcional
export LLM_MODEL='MiniMax-M2'                    # opcional
npm start
```

Alternativa para no tocar el entorno: guarda la clave en un fichero local
(carpeta `data/`, que está en `.gitignore`) y arranca con
`RELAY_LLM_KEY_FILE=data/llm.key npm start`.

En la ficha de cada incidencia, el bloque **Traducciones** permite traducir a
mano cualquier idioma, editar lo ya traducido y ver cuál es el idioma original.

## Publicarlo en un subdominio

```bash
HOST=0.0.0.0 RELAY_TOKEN='una-frase-secreta' npm start
```

Con `RELAY_TOKEN` definido, la API exige `Authorization: Bearer <token>` y la
interfaz pide el token la primera vez. **Sin token, cualquiera con la URL puede
leer y escribir los datos**, así que no lo publiques en abierto. El servidor
avisa por consola si escucha fuera de `localhost` sin token.

## Compartir el login con la app de tareas

Si Relay se sirve en el **mismo origen** que la app de tareas
(`tasks.departify.app`), no hay un segundo login: Relay lee la sesión de Supabase
que ya está guardada en `localStorage['depdoit:session']` —mismo formato, mismo
refresco— y el servidor la valida contra ese mismo proyecto Supabase. Así se
conservan el acceso y las invitaciones que ya tienes configurados.

```bash
SUPABASE_URL='https://<proyecto>.supabase.co' \
SUPABASE_ANON_KEY='<clave pública>' \
npm start
```

La clave anónima es pública por diseño (la que ya viaja al navegador de la app de
tareas); lo que protege los datos son las políticas RLS.

## Montarlo en un subdirectorio del mismo origen

Si la app de tareas vive en `tasks.departify.app/` y Relay se sirve en
`tasks.departify.app/relay/`, ambas comparten origen: la misma sesión, el mismo
`localStorage` y las mismas invitaciones.

```bash
RELAY_BASE_PATH='/relay' npm start
```

Con esa variable:

- La API cuelga de `/relay/api/...` y los estáticos de `/relay/...`; la raíz del
  origen no la toca Relay.
- `/relay` redirige a `/relay/`, como cualquier directorio estático.
- El front deduce solo en qué ruta está (de la URL del documento), así que los
  `<script>` y `<link>` son relativos y no hay que configurarlos.
- El `config.js` se busca primero en la ruta de Relay y después en la raíz del
  origen: así hereda el de la app de tareas sin duplicar claves.

En el proxy inverso basta con mandar `/relay/*` al proceso de Node y dejar que
todo lo demás siga a la app de tareas.

## API REST

Todo en `127.0.0.1:4310`, sin autenticación (es una herramienta local).

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/api/meta` | Estados, tipos, prioridades y estados de sprint |
| GET/POST | `/api/projects` | Listar y crear proyectos |
| GET/PATCH | `/api/projects/:key` | Detalle y edición de un proyecto |
| GET/POST | `/api/issues` | Listar (con filtros) y crear incidencias |
| GET/PATCH/DELETE | `/api/issues/:key` | Detalle, edición y borrado |
| POST | `/api/issues/:key/comments` | Añadir comentario |
| GET/POST | `/api/sprints` | Listar y crear sprints |
| GET/PATCH/DELETE | `/api/sprints/:id` | Detalle, edición y borrado |
| POST | `/api/sprints/:id/state` | Cambiar el estado del sprint |
| POST/DELETE | `/api/sprints/:id/issues[/:key]` | Quitar o poner una incidencia en el sprint |
| GET | `/api/board?project=KEY` | Tablero completo del proyecto |

Filtros de `GET /api/issues`: `project`, `status`, `type`, `priority`,
`assignee`, `sprint`, `q` y `limit`.

## Estructura

```
server.js            punto de entrada: abre la base y levanta el servidor
src/db.js            esquema SQLite y apertura de la base
src/store.js         datos y reglas de negocio (sin HTTP)
src/api.js           tabla de rutas REST
src/server.js        servidor HTTP, ficheros estáticos y ruta de montaje
src/supabase-auth.js validación de la sesión de Supabase compartida
src/translate.js     traducción automática (proveedor compatible con OpenAI)
public/              interfaz (HTML, CSS y JS sin compilar ni CDN)
test/                tests de API, i18n, sesión compartida y ruta de montaje
scripts/seed.js      datos de ejemplo
```

## Por qué sin dependencias

Cada dependencia es una puerta de salida del proyecto: supply chain, acceso a
red y actualizaciones ajenas. Para un gestor de tareas, el conjunto nativo de
Node cubre todo lo necesario: servidor HTTP, SQLite, tests y servidor de
ficheros estáticos. El resultado es una carpeta que se copia a otra máquina y
funciona.

## Configuración

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `PORT` | `4310` | Puerto del servidor |
| `HOST` | `127.0.0.1` | Interfaz de escucha (cámbialo solo si sabes lo que haces) |
| `RELAY_DB` | `data/relay.db` | Ruta del fichero SQLite |
| `RELAY_TOKEN` | — | Si se define, la API exige ese token |
| `LLM_API_KEY` | — | Clave del proveedor de traducción (MiniMax) |
| `LLM_BASE_URL` | `https://api.minimax.io/v1` | Endpoint del proveedor |
| `LLM_MODEL` | `MiniMax-M2` | Modelo de traducción |
| `RELAY_LLM_KEY_FILE` | — | Fichero local con la clave, alternativa a `LLM_API_KEY` |
| `SUPABASE_URL` | — | Proyecto Supabase para validar la sesión compartida |
| `SUPABASE_ANON_KEY` | — | Clave pública de ese proyecto |
| `RELAY_BASE_PATH` | — | Ruta en la que se monta (por ejemplo `/relay`) |
