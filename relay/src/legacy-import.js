/** Read-only snapshot of existing task boards. Originals stay in Supabase. */
export function importLegacy(workspace, rows, members) {
  const { db } = workspace;
  db.exec(`CREATE TABLE IF NOT EXISTS legacy_imports (card_id TEXT PRIMARY KEY, issue_key TEXT NOT NULL, snapshot TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  if (db.prepare("SELECT value FROM workspace_settings WHERE name = 'legacy-import-v1'").get()) return;
  const stamp = new Date().toISOString();
  const states = name => /verificad|hecho|done|finalizat/i.test(name) ? 'done'
    : /falla|bloque|blocked/i.test(name) ? 'blocked'
    : /probando|progress|curso/i.test(name) ? 'in_progress'
    : /review|revisi/i.test(name) ? 'in_review' : 'todo';
  db.exec('BEGIN IMMEDIATE');
  try {
    const projectIds = new Map();
    const userIds = new Map();
    for (const member of members) {
      const email = member.email?.toLowerCase();
      if (!email) continue;
      db.prepare('INSERT OR IGNORE INTO users (display_name,email,created_at) VALUES (?,?,?)').run(email.split('@')[0], email, stamp);
      userIds.set(member.user_id, db.prepare('SELECT id FROM users WHERE email = ?').get(email).id);
    }
    for (const row of rows) {
      if (!projectIds.has(row.board_id)) {
        const key = 'B' + row.board_id.replaceAll('-', '').slice(0, 11).toUpperCase();
        db.prepare('INSERT OR IGNORE INTO projects (key,name,description,created_at) VALUES (?,?,?,?)').run(key, row.board_name, 'Tablero original de Departify. Importación inicial; el original se conserva en /board/.', stamp);
        projectIds.set(row.board_id, { key, id: db.prepare('SELECT id FROM projects WHERE key = ?').get(key).id, number: 0 });
      }
      if (!row.card_id || db.prepare('SELECT card_id FROM legacy_imports WHERE card_id = ?').get(row.card_id)) continue;
      const project = projectIds.get(row.board_id);
      const number = ++project.number;
      const issueKey = `${project.key}-${number}`;
      const description = [row.description, row.expected && `Qué debería pasar:\n${row.expected}`,
        row.actual && `Qué pasa en realidad:\n${row.actual}`, row.verified_at && `Verificado: ${row.verified_at} (${row.verified_by})`].filter(Boolean).join('\n\n');
      const result = db.prepare(`INSERT INTO issues (project_id,number,key,type,summary,description,status,priority,assignee_id,start_date,due_date,source_lang,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(project.id, number, issueKey, row.kind === 'bug' ? 'bug' : 'task', row.title || 'Sin título', description,
        row.completed_at ? 'done' : states(row.list_name || ''), ({ blocker:'highest', high:'high', medium:'medium', low:'low' })[row.severity] || 'medium',
        userIds.get(row.assignees?.[0]?.user_id) ?? null, row.start_date, row.due_date, 'es', stamp, stamp);
      const issueId = Number(result.lastInsertRowid);
      const labels = [row.list_name, row.kind === 'improvement' && 'mejora', row.severity && `gravedad:${row.severity}`].filter(Boolean);
      for (const name of labels) {
        db.prepare('INSERT OR IGNORE INTO labels (name) VALUES (?)').run(name.toLowerCase());
        db.prepare('INSERT OR IGNORE INTO issue_labels (issue_id,label_id) VALUES (?,?)').run(issueId, db.prepare('SELECT id FROM labels WHERE name = ?').get(name.toLowerCase()).id);
      }
      db.prepare('INSERT INTO legacy_imports (card_id,issue_key,snapshot) VALUES (?,?,?)').run(row.card_id, issueKey, JSON.stringify(row));
    }
    db.prepare("INSERT INTO workspace_settings (name,value) VALUES ('legacy-import-v1',?)").run(stamp);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
