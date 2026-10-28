import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = process.env.RELAY_DB || path.join(ROOT, 'data', 'relay.db');

mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = openDb(DB_FILE);
const store = createStore(db);

const existing = store.listProjects();
if (existing.length) {
  console.log(`La base ya tiene ${existing.length} proyecto(s). No se toca nada.`);
  console.log('Borrar la base: rm -f data/relay.db*');
  db.close();
  process.exit(0);
}

const ana = store.createUser({ displayName: 'Ana Ruiz', email: 'ana@equipo.local' });
const bruno = store.createUser({ displayName: 'Bruno Sol', email: 'bruno@equipo.local' });

store.createProject({
  key: 'WEB',
  name: 'Sitio web',
  description: 'Reconstrucción de la web del equipo',
});

const issues = [
  { summary: 'Diseñar la home', type: 'story', priority: 'high', assignee: ana.email, labels: ['diseño'] },
  { summary: 'Montar la API de incidencias', type: 'task', priority: 'highest', assignee: bruno.email, labels: ['backend'] },
  { summary: 'El login pierde la sesión al recargar', type: 'bug', priority: 'high', assignee: bruno.email, labels: ['bug', 'login'] },
  { summary: 'Pantalla de sprint', type: 'story', priority: 'medium', assignee: ana.email, labels: ['frontend'] },
  { summary: 'Auditar accesibilidad', type: 'task', priority: 'low', assignee: null, labels: ['a11y'] },
];

const created = issues.map((issue) =>
  store.createIssue({
    projectKey: 'WEB',
    summary: issue.summary,
    type: issue.type,
    priority: issue.priority,
    assignee: issue.assignee,
    labels: issue.labels,
  })
);

const sprint = store.createSprint({
  projectKey: 'WEB',
  name: 'Sprint 1',
  goal: 'Tener la home y el login funcionando',
  startDate: '2026-11-02',
  endDate: '2026-11-13',
});

for (const issue of created.slice(0, 3)) {
  store.addIssueToSprint(sprint.id, issue.key);
}
store.updateIssue(created[0].key, { status: 'in_progress' });
store.updateIssue(created[2].key, { status: 'blocked' });

console.log(`Datos de ejemplo creados en ${DB_FILE}`);
console.log(`  proyecto: WEB · ${created.length} incidencias · sprint "${sprint.name}"`);
db.close();
