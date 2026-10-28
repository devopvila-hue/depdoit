import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { createServer } from '../src/server.js';

let server;
let base;
let store;

before(async () => {
  const db = openDb(':memory:');
  store = createStore(db);
  server = createServer({ store });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
});

async function call(path, method = 'GET', body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, init);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

describe('proyectos', () => {
  it('crea un proyecto y lo lista', async () => {
    const created = await call('/api/projects', 'POST', { key: 'web', name: 'Sitio web' });
    assert.equal(created.status, 200);
    assert.equal(created.data.key, 'WEB');

    const list = await call('/api/projects');
    assert.equal(list.status, 200);
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].key, 'WEB');
  });

  it('rechaza claves duplicadas con 409', async () => {
    const res = await call('/api/projects', 'POST', { key: 'WEB', name: 'Otro' });
    assert.equal(res.status, 409);
  });

  it('rechaza claves inválidas con 400', async () => {
    const res = await call('/api/projects', 'POST', { key: '1', name: 'Malo' });
    assert.equal(res.status, 400);
  });
});

describe('incidencias', () => {
  it('crea incidencias con clave correlativa', async () => {
    const first = await call('/api/issues', 'POST', {
      projectKey: 'WEB',
      summary: 'Diseñar la home',
      type: 'story',
      priority: 'high',
      labels: ['diseño'],
    });
    assert.equal(first.status, 200);
    assert.equal(first.data.key, 'WEB-1');
    assert.deepEqual(first.data.labels, ['diseño']);

    const second = await call('/api/issues', 'POST', { projectKey: 'WEB', summary: 'Arreglar el login' });
    assert.equal(second.data.key, 'WEB-2');
    assert.equal(second.data.status, 'todo');
    assert.equal(second.data.priority, 'medium');
  });

  it('rechaza un tipo de incidencia inexistente', async () => {
    const res = await call('/api/issues', 'POST', { projectKey: 'WEB', summary: 'X', type: 'inválido' });
    assert.equal(res.status, 400);
  });

  it('rechaza incidencias de proyectos inexistentes', async () => {
    const res = await call('/api/issues', 'POST', { projectKey: 'NOPE', summary: 'X' });
    assert.equal(res.status, 404);
  });

  it('mueve una incidencia de estado y actualiza el tablero', async () => {
    const moved = await call('/api/issues/WEB-1', 'PATCH', { status: 'in_progress' });
    assert.equal(moved.status, 200);
    assert.equal(moved.data.status, 'in_progress');

    const board = await call('/api/board?project=WEB');
    const inProgress = board.data.columns.find((c) => c.status === 'in_progress');
    assert.equal(inProgress.issues.length, 1);
    assert.equal(inProgress.issues[0].key, 'WEB-1');
  });

  it('filtra por estado y por búsqueda de texto', async () => {
    const byStatus = await call('/api/issues?project=WEB&status=todo');
    assert.equal(byStatus.data.length, 1);
    assert.equal(byStatus.data[0].key, 'WEB-2');

    const byText = await call('/api/issues?project=WEB&q=login');
    assert.equal(byText.data.length, 1);
    assert.equal(byText.data[0].key, 'WEB-2');
  });

  it('añade comentarios a una incidencia', async () => {
    const res = await call('/api/issues/WEB-1/comments', 'POST', { body: 'Empezamos mañana' });
    assert.equal(res.status, 200);
    assert.equal(res.data.comments.length, 1);
    assert.equal(res.data.comments[0].body, 'Empezamos mañana');
  });

  it('elimina una incidencia', async () => {
    const res = await call('/api/issues/WEB-2', 'DELETE');
    assert.equal(res.status, 200);
    const check = await call('/api/issues/WEB-2');
    assert.equal(check.status, 404);
  });
});

describe('sprints', () => {
  it('crea un sprint y le añade una incidencia', async () => {
    const sprint = await call('/api/sprints', 'POST', {
      projectKey: 'WEB',
      name: 'Sprint 1',
      goal: 'Sacar la home',
      startDate: '2026-11-02',
      endDate: '2026-11-13',
    });
    assert.equal(sprint.status, 200);
    assert.equal(sprint.data.state, 'planned');

    const added = await call(`/api/sprints/${sprint.data.id}/issues`, 'POST', { issueKey: 'WEB-1' });
    assert.equal(added.status, 200);
    assert.equal(added.data.issues.length, 1);
    assert.equal(added.data.issues[0].key, 'WEB-1');
    assert.equal(added.data.stats.done, 0);
    assert.equal(added.data.stats.remaining, 1);
  });

  it('impide dos sprints activos en el mismo proyecto', async () => {
    const second = await call('/api/sprints', 'POST', { projectKey: 'WEB', name: 'Sprint 2' });
    const first = await call('/api/sprints', 'POST', { projectKey: 'WEB', name: 'Sprint 0' });

    const activate = await call(`/api/sprints/${first.data.id}/state`, 'POST', { state: 'active' });
    assert.equal(activate.status, 200);
    assert.equal(activate.data.state, 'active');

    const conflict = await call(`/api/sprints/${second.data.id}/state`, 'POST', { state: 'active' });
    assert.equal(conflict.status, 409);
  });

  it('completa un sprint y lo refleja en el listado', async () => {
    const sprints = await call('/api/sprints?project=WEB');
    const active = sprints.data.find((s) => s.state === 'active');
    const done = await call(`/api/sprints/${active.id}/state`, 'POST', { state: 'completed' });
    assert.equal(done.data.state, 'completed');
  });

  it('saca la incidencia del sprint al quitarla', async () => {
    const sprints = await call('/api/sprints?project=WEB');
    const sprint = sprints.data[0];
    const removed = await call(`/api/sprints/${sprint.id}/issues/WEB-1`, 'DELETE');
    assert.equal(removed.status, 200);
    assert.equal(removed.data.issues.length, 0);
  });
});

describe('tablero', () => {
  it('agrupa las incidencias por estado y deja el backlog aparte', async () => {
    await call('/api/projects', 'POST', { key: 'OPS', name: 'Operaciones' });
    await call('/api/issues', 'POST', { projectKey: 'OPS', summary: 'Revisar alertas', status: 'todo' });
    await call('/api/issues', 'POST', { projectKey: 'OPS', summary: 'Cerrar incidencia vieja', status: 'done' });

    const board = await call('/api/board?project=OPS');
    assert.equal(board.status, 200);
    assert.equal(board.data.project.key, 'OPS');
    assert.equal(board.data.columns.length, 5);

    const todo = board.data.columns.find((c) => c.status === 'todo');
    const done = board.data.columns.find((c) => c.status === 'done');
    assert.equal(todo.issues.length, 1);
    assert.equal(done.issues.length, 1);
    assert.equal(
      board.data.columns.reduce((acc, c) => acc + c.issues.length, 0),
      2
    );
    assert.equal(board.data.backlog.length, 2);
  });

  it('devuelve 404 si el proyecto no existe', async () => {
    const res = await call('/api/board?project=NADA');
    assert.equal(res.status, 404);
  });
});

describe('fechas y gantt', () => {
  let key = null;

  it('crea un proyecto para las pruebas de fechas', async () => {
    const project = await call('/api/projects', 'POST', { key: 'GNT', name: 'Gantt' });
    assert.equal(project.status, 200);
  });

  it('asigna fechas por defecto al crear una incidencia', async () => {
    const res = await call('/api/issues', 'POST', { projectKey: 'GNT', summary: 'Con fechas' });
    assert.equal(res.status, 200);
    assert.match(res.data.startDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(res.data.dueDate, /^\d{4}-\d{2}-\d{2}$/);
    key = res.data.key;
  });

  it('acepta y devuelve fechas explícitas', async () => {
    const res = await call('/api/issues', 'POST', {
      projectKey: 'GNT',
      summary: 'Fechas fijas',
      startDate: '2026-11-01',
      dueDate: '2026-11-15',
    });
    assert.equal(res.data.startDate, '2026-11-01');
    assert.equal(res.data.dueDate, '2026-11-15');
  });

  it('rechaza un fin anterior al inicio', async () => {
    const res = await call('/api/issues', 'POST', {
      projectKey: 'GNT',
      summary: 'Al revés',
      startDate: '2026-11-10',
      dueDate: '2026-11-01',
    });
    assert.equal(res.status, 400);
  });

  it('rechaza fechas con formato inválido', async () => {
    const res = await call('/api/issues', 'POST', { projectKey: 'GNT', summary: 'Mal', startDate: '01-11-2026' });
    assert.equal(res.status, 400);
  });

  it('actualiza y borra fechas', async () => {
    const updated = await call(`/api/issues/${key}`, 'PATCH', { startDate: '2026-12-01', dueDate: '2026-12-10' });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.startDate, '2026-12-01');
    assert.equal(updated.data.dueDate, '2026-12-10');

    const cleared = await call(`/api/issues/${key}`, 'PATCH', { dueDate: null });
    assert.equal(cleared.data.dueDate, null);
    assert.equal(cleared.data.startDate, '2026-12-01');
  });

  it('filtra por rango de fechas con solape', async () => {
    // key tiene inicio 2026-12-01 y fin borrado: sigue abierta, así que
    // se solapa con cualquier rango posterior.
    const inside = await call('/api/issues?project=GNT&from=2026-11-30&to=2026-12-05');
    assert.ok(inside.data.some((issue) => issue.key === key), 'la incidencia abierta cae en el rango');

    const november = await call('/api/issues?project=GNT&from=2026-11-01&to=2026-11-20');
    assert.ok(
      november.data.some((issue) => issue.startDate === '2026-11-01'),
      'la incidencia con fechas fijas cae en su rango'
    );
    assert.equal(
      november.data.some((issue) => issue.key === key),
      false,
      'la incidencia de diciembre no cae en el rango de noviembre'
    );
  });

  it('migra una base antigua añadiendo y rellenando las fechas', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'relay-migrate-'));
    const file = path.join(dir, 'legacy.db');
    const legacy = new DatabaseSync(file);
    legacy.exec(`
      CREATE TABLE issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        number INTEGER NOT NULL,
        key TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        assignee_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
    legacy.exec(
      `INSERT INTO issues (project_id, number, key, type, summary, status, priority, created_at, updated_at)
       VALUES (1, 1, 'OLD-1', 'task', 'Antigua', 'todo', 'medium', '2026-01-05T10:00:00.000Z', '2026-01-05T10:00:00.000Z')`
    );
    legacy.close();

    const migrated = openDb(file);
    const columns = migrated.prepare('PRAGMA table_info(issues)').all().map((column) => column.name);
    assert.ok(columns.includes('start_date'), 'debe existir la columna start_date');
    assert.ok(columns.includes('due_date'), 'debe existir la columna due_date');

    const row = migrated.prepare('SELECT * FROM issues WHERE key = ?').get('OLD-1');
    assert.equal(row.start_date, '2026-01-05');
    assert.equal(row.due_date, '2026-01-12');
    migrated.close();
  });
});

describe('equipo', () => {
  it('crea usuarios y rechaza emails duplicados', async () => {
    const created = await call('/api/users', 'POST', { displayName: 'Ana Ruiz', email: 'ana@equipo.local' });
    assert.equal(created.status, 200);
    assert.equal(created.data.displayName, 'Ana Ruiz');

    const duplicate = await call('/api/users', 'POST', { displayName: 'Otra', email: 'ana@equipo.local' });
    assert.equal(duplicate.status, 409);
  });

  it('asigna una incidencia a un usuario', async () => {
    const users = await call('/api/users');
    const assigned = await call('/api/issues/WEB-1', 'PATCH', { assignee: users.data[0].id });
    assert.equal(assigned.data.assignee.displayName, 'Ana Ruiz');
  });
});

describe('rutas y errores', () => {
  it('devuelve 404 en rutas desconocidas', async () => {
    const res = await call('/api/nada');
    assert.equal(res.status, 404);
  });

  it('devuelve 405 en métodos no permitidos', async () => {
    const res = await call('/api/projects', 'DELETE');
    assert.equal(res.status, 405);
  });

  it('sirve la interfaz web', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, /Relay/);
  });

  it('mantiene ocultos los overlays con la regla [hidden]', async () => {
    // Regresión: `.modal-backdrop { display: grid }` ganaba al `[hidden]` del
    // navegador y dejaba un velo que bloqueaba toda la interacción.
    const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
    assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  });
});
