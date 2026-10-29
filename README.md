# Relay · Departify Tasks

**Canonical repository: `devopvila-hue/depdoit`.** Relay is the primary application at
https://tasks.departify.app. The standalone `relay` repository is a historical mirror;
its current code was already merged here before this integration.

## One entry point, one team

- `/`: Relay projects, issues, kanban, lists, sprints, Gantt and backlog (ES/EN/RO/HU).
- `/admin`: existing Supabase team roles and single-use invitation links.
- `/board/`: original Departify kanban, preserved with its Supabase records.
- Google OAuth, password, email magic link and existing `depdoit:session` sessions
  use the **same Supabase project**. Relay does not ask for a separate token.
- Invitations survive the login redirect, are redeemed using the existing
  `task_redeem_invitation` RPC, and select the invited organization.
- The server revalidates Supabase identity **and organization membership on every
  request**. No user metadata is trusted as permission. Removing membership revokes
  API access even while the authentication token remains valid.

## Storage

Supabase remains authoritative for identities, organizations, invitations and the
original board. Relay uses one durable SQLite database per verified organization.
The deployed `RELAY_WORKSPACE_DIR` is on a persistent Docker volume, not the container.

On the first authenticated request per organization, Relay imports a read-only
snapshot of its original boards, cards, dates, assignments and QA evidence. Each
source card has an audit mapping and full source snapshot. The import is atomic and
marked complete, so restarts never import it twice. **This is not bidirectional
synchronization.** New work should be done in Relay; the original board remains
available without deleting or rewriting its records.

## Development and checks

Node >=22.5; no external runtime dependencies.

```sh
npm test
# This environment's outbound proxy should not intercept localhost tests:
NODE_USE_ENV_PROXY=0 npm test
SUPABASE_URL=https://PROJECT.supabase.co SUPABASE_ANON_KEY=PUBLIC_KEY npm run build
```

`site/` is generated from `relay/public/`, the shared access client and `/board/`.
For local builds only, an ignored root `config.js` can supply the public Supabase
configuration instead of environment variables. Never put a service-role key there.

For standalone local Relay without team integration, see [relay/README.md](relay/README.md).
The hosted shared-access scripts are supplied by the root build, not a standalone
Relay HTTP server.

## Deployment

- Vercel project **social16/depdoit** retains `tasks.departify.app` and existing DNS.
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` are public build configuration in Vercel.
- `vercel.json` proxies `/api/*` to the isolated Relay backend under
  `https://api.departify.app/tasks-relay/api/*`.
- Build backend: `docker build -f relay/Dockerfile -t departify-tasks-relay:RELEASE relay`.
- Runtime: `HOST=0.0.0.0`, `PORT=4310`, `RELAY_BASE_PATH=/tasks-relay`,
  `RELAY_WORKSPACE_DIR=/data/workspaces`, the same public Supabase URL/anon key,
  and persistent volume mounted at `/data`.
- No service-role key, Supabase DDL, DNS change, ERP deployment, or modification of
  existing API/ERP/CRM environment variables is required.

Rollback: restore the previous Vercel deployment. Supabase originals are untouched;
the Relay data volume must be preserved. Back up SQLite with the SQLite backup API,
not by copying a live `.db` without its WAL.

### Idiomas y traducción de tareas

- Español, English, Română y Magyar comparten la preferencia `relay.lang` entre Relay, login y `/admin`.
- MiniMax traduce títulos y descripciones, incluidas tareas importadas, conservando el original. Las traducciones se guardan por empresa y se regeneran al editar el texto fuente.
- El propietario gestiona la conexión en `/admin` → Traducción automática de tareas. Solo el propietario puede consultar o modificar `/api/settings/translation`; ninguna respuesta devuelve claves.
- Conexión compartida del servidor: `LLM_API_KEY` o `RELAY_LLM_KEY_FILE`, `LLM_MODEL` y `LLM_BASE_URL`. Puede desactivarse o sustituirse con una clave por empresa; las claves de empresa permanecen en su SQLite privado, nunca en los assets ni en localStorage.
- Los fallos conservan el original y se muestran en el tablero. Cada tarea permite reintentar o corregir una traducción manualmente.
