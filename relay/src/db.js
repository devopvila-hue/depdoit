import { DatabaseSync } from 'node:sqlite';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  email        TEXT UNIQUE,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number      INTEGER NOT NULL,
  key         TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL,
  summary     TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL,
  priority    TEXT NOT NULL,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  start_date  TEXT,
  due_date    TEXT,
  source_lang TEXT NOT NULL DEFAULT 'es',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (project_id, number)
);

CREATE TABLE IF NOT EXISTS labels (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS issue_labels (
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, label_id)
);

CREATE TABLE IF NOT EXISTS sprints (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  goal       TEXT NOT NULL DEFAULT '',
  state      TEXT NOT NULL DEFAULT 'planned',
  start_date TEXT,
  end_date   TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sprint_issues (
  sprint_id INTEGER NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  issue_id  INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  added_at  TEXT NOT NULL,
  PRIMARY KEY (sprint_id, issue_id)
);

CREATE TABLE IF NOT EXISTS issue_translations (
  issue_id    INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  provider    TEXT NOT NULL DEFAULT 'manual',
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (issue_id, lang)
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id   INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_sprints_project ON sprints(project_id);
CREATE INDEX IF NOT EXISTS idx_sprint_issues_issue ON sprint_issues(issue_id);
CREATE INDEX IF NOT EXISTS idx_comments_issue ON comments(issue_id);
`;

/**
 * Aplica cambios de esquema sobre bases ya existentes.
 * `CREATE TABLE IF NOT EXISTS` no añade columnas nuevas, así que una base
 * creada antes de `start_date`/`due_date` necesita un ALTER TABLE.
 */
function migrate(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(issues)').all().map((column) => column.name));
  for (const [name, type] of [
    ['start_date', 'TEXT'],
    ['due_date', 'TEXT'],
    ['source_lang', "TEXT NOT NULL DEFAULT 'es'"],
  ]) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE issues ADD COLUMN ${name} ${type}`);
    }
  }
  // Backfill only when adding dates to an OLD schema. Never rewrite an
  // intentionally cleared date on every restart of an already migrated DB.
  if (!columns.has('start_date')) {
    db.exec(`UPDATE issues SET start_date = substr(created_at, 1, 10) WHERE start_date IS NULL OR start_date = ''`);
  }
  if (!columns.has('due_date')) {
    db.exec(`UPDATE issues SET due_date = date(substr(created_at, 1, 10), '+7 days') WHERE due_date IS NULL OR due_date = ''`);
  }
}

/**
 * Abre la base de datos local en SQLite.
 * @param {string} file ruta del fichero; ':memory:' para tests en memoria.
 */
export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
