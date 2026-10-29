import { badRequest, conflict, notFound } from './errors.js';

export const STATUSES = ['todo', 'in_progress', 'in_review', 'blocked', 'done'];
export const TYPES = ['epic', 'story', 'task', 'bug'];
export const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest'];
export const SPRINT_STATES = ['planned', 'active', 'completed'];
export const LANGS = ['es', 'en', 'ro', 'hu'];

const now = () => new Date().toISOString();

function text(value, field, { max = 2000, required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`Falta el campo "${field}"`);
    return '';
  }
  if (typeof value !== 'string') throw badRequest(`"${field}" debe ser texto`);
  const trimmed = value.trim();
  if (required && !trimmed) throw badRequest(`"${field}" no puede estar vacío`);
  if (trimmed.length > max) throw badRequest(`"${field}" supera los ${max} caracteres`);
  return trimmed;
}

function oneOf(value, list, field, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw badRequest(`Falta el campo "${field}"`);
  }
  if (!list.includes(value)) {
    throw badRequest(`"${field}" debe ser uno de: ${list.join(', ')}`);
  }
  return value;
}

function optionalDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw badRequest(`"${field}" debe tener formato AAAA-MM-DD`);
  if (Number.isNaN(Date.parse(raw))) throw badRequest(`"${field}" no es una fecha válida`);
  return raw;
}

/**
 * Fecha opcional que distingue "no informado" (undefined → se conserva el
 * valor actual o se aplica el valor por defecto) de "sin fecha" (null → se
 * borra). Cierra con las fechas de inicio y fin.
 */
function dateField(value, field, fallback) {
  if (value === undefined) return fallback;
  return optionalDate(value, field);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/**
 * Capa de datos y reglas de negocio de Relay.
 * Todo el estado vive en el SQLite local; no hay ninguna llamada de red.
 */
export function createStore(db) {
  const st = {
    allUsers: db.prepare('SELECT * FROM users ORDER BY display_name COLLATE NOCASE'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    insertUser: db.prepare('INSERT INTO users (display_name, email, created_at) VALUES (?, ?, ?)'),

    allProjects: db.prepare('SELECT * FROM projects ORDER BY key'),
    projectByKey: db.prepare('SELECT * FROM projects WHERE key = ?'),
    projectById: db.prepare('SELECT * FROM projects WHERE id = ?'),
    insertProject: db.prepare(
      'INSERT INTO projects (key, name, description, created_at) VALUES (?, ?, ?, ?)'
    ),
    updateProject: db.prepare('UPDATE projects SET name = ?, description = ? WHERE id = ?'),

    maxIssueNumber: db.prepare(
      'SELECT COALESCE(MAX(number), 0) AS n FROM issues WHERE project_id = ?'
    ),
    insertIssue: db.prepare(
      `INSERT INTO issues (project_id, number, key, type, summary, description, status, priority, assignee_id, start_date, due_date, source_lang, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    issueByKey: db.prepare('SELECT * FROM issues WHERE key = ?'),
    issueById: db.prepare('SELECT * FROM issues WHERE id = ?'),
    updateIssue: db.prepare(
      `UPDATE issues SET type = ?, summary = ?, description = ?, status = ?, priority = ?, assignee_id = ?, start_date = ?, due_date = ?, source_lang = ?, updated_at = ?
       WHERE id = ?`
    ),
    deleteIssue: db.prepare('DELETE FROM issues WHERE id = ?'),

    translationFor: db.prepare('SELECT * FROM issue_translations WHERE issue_id = ? AND lang = ?'),
    translationsOf: db.prepare('SELECT * FROM issue_translations WHERE issue_id = ?'),
    upsertTranslation: db.prepare(
      `INSERT INTO issue_translations (issue_id, lang, summary, description, provider, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(issue_id, lang) DO UPDATE SET
         summary = excluded.summary,
         description = excluded.description,
         provider = excluded.provider,
         updated_at = excluded.updated_at`
    ),
    deleteTranslation: db.prepare('DELETE FROM issue_translations WHERE issue_id = ? AND lang = ?'),

    labelByName: db.prepare('SELECT * FROM labels WHERE name = ?'),
    insertLabel: db.prepare('INSERT OR IGNORE INTO labels (name) VALUES (?)'),
    linkLabel: db.prepare('INSERT OR IGNORE INTO issue_labels (issue_id, label_id) VALUES (?, ?)'),
    clearLabels: db.prepare('DELETE FROM issue_labels WHERE issue_id = ?'),
    labelsOfIssue: db.prepare(
      `SELECT l.name FROM labels l JOIN issue_labels il ON il.label_id = l.id
       WHERE il.issue_id = ? ORDER BY l.name COLLATE NOCASE`
    ),

    allSprints: db.prepare('SELECT * FROM sprints ORDER BY id DESC'),
    sprintsOfProject: db.prepare('SELECT * FROM sprints WHERE project_id = ? ORDER BY id DESC'),
    sprintById: db.prepare('SELECT * FROM sprints WHERE id = ?'),
    insertSprint: db.prepare(
      `INSERT INTO sprints (project_id, name, goal, state, start_date, end_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),
    updateSprint: db.prepare(
      'UPDATE sprints SET name = ?, goal = ?, start_date = ?, end_date = ? WHERE id = ?'
    ),
    setSprintState: db.prepare('UPDATE sprints SET state = ? WHERE id = ?'),
    deleteSprint: db.prepare('DELETE FROM sprints WHERE id = ?'),

    linkSprintIssue: db.prepare(
      'INSERT OR IGNORE INTO sprint_issues (sprint_id, issue_id, added_at) VALUES (?, ?, ?)'
    ),
    unlinkSprintIssue: db.prepare('DELETE FROM sprint_issues WHERE sprint_id = ? AND issue_id = ?'),
    unlinkIssueFromAllSprints: db.prepare('DELETE FROM sprint_issues WHERE issue_id = ?'),
    sprintOfIssue: db.prepare(
      `SELECT s.* FROM sprints s JOIN sprint_issues si ON si.sprint_id = s.id
       WHERE si.issue_id = ? ORDER BY s.id DESC LIMIT 1`
    ),
    issuesOfSprint: db.prepare(
      `SELECT i.* FROM issues i JOIN sprint_issues si ON si.issue_id = i.id
       WHERE si.sprint_id = ? ORDER BY i.number`
    ),

    insertComment: db.prepare(
      'INSERT INTO comments (issue_id, author_id, body, created_at) VALUES (?, ?, ?, ?)'
    ),
    commentsOfIssue: db.prepare(
      `SELECT c.*, u.display_name AS author_name FROM comments c
       LEFT JOIN users u ON u.id = c.author_id
       WHERE c.issue_id = ? ORDER BY c.id`
    ),
  };

  function requireProject(key) {
    const normalized = String(key || '').trim().toUpperCase();
    if (!normalized) throw badRequest('Falta la clave del proyecto');
    const project = st.projectByKey.get(normalized);
    if (!project) throw notFound(`El proyecto ${normalized} no existe`);
    return project;
  }

  function requireIssue(key) {
    const normalized = String(key || '').trim().toUpperCase();
    if (!normalized) throw badRequest('Falta la clave de la incidencia');
    const issue = st.issueByKey.get(normalized);
    if (!issue) throw notFound(`La incidencia ${normalized} no existe`);
    return issue;
  }

  function requireSprint(id) {
    const sprint = st.sprintById.get(Number(id));
    if (!sprint) throw notFound(`El sprint ${id} no existe`);
    return sprint;
  }

  function shapeUser(row) {
    if (!row) return null;
    return { id: row.id, displayName: row.display_name, email: row.email };
  }

  function shapeSprint(row) {
    if (!row) return null;
    return {
      id: row.id,
      projectKey: st.projectById.get(row.project_id)?.key ?? null,
      name: row.name,
      goal: row.goal,
      state: row.state,
      startDate: row.start_date,
      endDate: row.end_date,
      createdAt: row.created_at,
    };
  }

  function shapeTranslations(issueId) {
    const result = {};
    for (const row of st.translationsOf.all(issueId)) {
      result[row.lang] = {
        summary: row.summary,
        description: row.description,
        provider: row.provider,
        updatedAt: row.updated_at,
      };
    }
    return result;
  }

  function shapeIssue(row, { withComments = false } = {}) {
    if (!row) return null;
    const project = st.projectById.get(row.project_id);
    const issue = {
      id: row.id,
      key: row.key,
      number: row.number,
      projectKey: project?.key ?? null,
      type: row.type,
      summary: row.summary,
      description: row.description,
      status: row.status,
      priority: row.priority,
      assignee: shapeUser(row.assignee_id ? st.userById.get(row.assignee_id) : null),
      labels: st.labelsOfIssue.all(row.id).map((l) => l.name),
      sprint: shapeSprint(st.sprintOfIssue.get(row.id)),
      startDate: row.start_date ?? null,
      dueDate: row.due_date ?? null,
      sourceLang: row.source_lang ?? 'es',
      translations: shapeTranslations(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (withComments) {
      issue.comments = st.commentsOfIssue.all(row.id).map((c) => ({
        id: c.id,
        body: c.body,
        author: c.author_name ?? null,
        createdAt: c.created_at,
      }));
    }
    return issue;
  }

  function applyLabels(issueId, labels) {
    st.clearLabels.run(issueId);
    for (const raw of labels) {
      const name = String(raw).trim().toLowerCase();
      if (!name) continue;
      st.insertLabel.run(name);
      const label = st.labelByName.get(name);
      st.linkLabel.run(issueId, label.id);
    }
  }

  function resolveAssignee(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value === 'object') {
      const id = Number(value.id);
      if (!Number.isInteger(id)) throw badRequest('"assignee.id" debe ser un entero');
      const user = st.userById.get(id);
      if (!user) throw badRequest('Ese usuario no existe');
      return user.id;
    }
    // Un id numérico (o su versión en texto) se resuelve por id.
    if (/^\d+$/.test(String(value).trim())) {
      const id = Number(String(value).trim());
      const user = st.userById.get(id);
      if (!user) throw badRequest('Ese usuario no existe');
      return user.id;
    }
    const email = String(value).trim().toLowerCase();
    const user = st.userByEmail.get(email);
    if (!user) throw badRequest(`No hay ningún usuario con el email ${email}`);
    return user.id;
  }

  return {
    meta() {
      return { statuses: STATUSES, types: TYPES, priorities: PRIORITIES, sprintStates: SPRINT_STATES };
    },

    listUsers() {
      return st.allUsers.all().map(shapeUser);
    },

    createUser(body = {}) {
      const displayName = text(body.displayName, 'displayName', { max: 120 });
      const email = body.email ? text(body.email, 'email', { max: 160 }).toLowerCase() : null;
      if (email && st.userByEmail.get(email)) throw conflict(`Ya existe un usuario con el email ${email}`);
      const info = st.insertUser.run(displayName, email, now());
      return shapeUser(st.userById.get(Number(info.lastInsertRowid)));
    },

    listProjects() {
      return st.allProjects.all().map((project) => {
        const issues = db
          .prepare('SELECT COUNT(*) AS n FROM issues WHERE project_id = ?')
          .get(project.id);
        const open = db
          .prepare('SELECT COUNT(*) AS n FROM issues WHERE project_id = ? AND status != ?')
          .get(project.id, 'done');
        const active = st.sprintsOfProject.all(project.id).find((s) => s.state === 'active');
        return {
          key: project.key,
          name: project.name,
          description: project.description,
          createdAt: project.created_at,
          issueCount: issues?.n ?? 0,
          openCount: open?.n ?? 0,
          activeSprint: active ? shapeSprint(active) : null,
        };
      });
    },

    getProject(key) {
      const project = requireProject(key);
      const issues = db.prepare('SELECT * FROM issues WHERE project_id = ? ORDER BY number').all(project.id);
      return {
        key: project.key,
        name: project.name,
        description: project.description,
        createdAt: project.created_at,
        issues: issues.map((i) => shapeIssue(i)),
        sprints: st.sprintsOfProject.all(project.id).map(shapeSprint),
      };
    },

    createProject(body = {}) {
      const key = text(body.key, 'key', { max: 12 }).toUpperCase();
      if (!/^[A-Z][A-Z0-9]{1,11}$/.test(key)) {
        throw badRequest('La clave debe empezar por letra y tener entre 2 y 12 caracteres (A-Z, 0-9)');
      }
      const name = text(body.name, 'name', { max: 120 });
      const description = text(body.description, 'description', { max: 1000, required: false });
      if (st.projectByKey.get(key)) throw conflict(`Ya existe un proyecto con la clave ${key}`);
      st.insertProject.run(key, name, description, now());
      return this.getProject(key);
    },

    updateProject(key, body = {}) {
      const project = requireProject(key);
      const name = body.name === undefined ? project.name : text(body.name, 'name', { max: 120 });
      const description =
        body.description === undefined ? project.description : text(body.description, 'description', { max: 1000, required: false });
      st.updateProject.run(name, description, project.id);
      return this.getProject(project.key);
    },

    listIssues(filters = {}) {
      const where = [];
      const params = [];
      if (filters.project) {
        where.push('i.project_id = ?');
        params.push(requireProject(filters.project).id);
      }
      if (filters.status) {
        oneOf(filters.status, STATUSES, 'status');
        where.push('i.status = ?');
        params.push(filters.status);
      }
      if (filters.type) {
        oneOf(filters.type, TYPES, 'type');
        where.push('i.type = ?');
        params.push(filters.type);
      }
      if (filters.priority) {
        oneOf(filters.priority, PRIORITIES, 'priority');
        where.push('i.priority = ?');
        params.push(filters.priority);
      }
      if (filters.assignee) {
        const assigneeId = resolveAssignee(filters.assignee);
        where.push('i.assignee_id = ?');
        params.push(assigneeId);
      }
      if (filters.sprint) {
        where.push('i.id IN (SELECT issue_id FROM sprint_issues WHERE sprint_id = ?)');
        params.push(requireSprint(filters.sprint).id);
      }
      if (filters.q) {
        const needle = `%${String(filters.q).trim().toLowerCase()}%`;
        where.push('(LOWER(i.summary) LIKE ? OR LOWER(i.description) LIKE ? OR LOWER(i.key) LIKE ?)');
        params.push(needle, needle, needle);
      }
      // Rango de fechas: la incidencia se incluye si su periodo solapa con el.
      if (filters.from) {
        where.push('(i.due_date IS NULL OR i.due_date >= ?)');
        params.push(optionalDate(filters.from, 'from'));
      }
      if (filters.to) {
        where.push('(i.start_date IS NULL OR i.start_date <= ?)');
        params.push(optionalDate(filters.to, 'to'));
      }
      const limit = Math.min(Number(filters.limit) || 200, 500);
      const sql = `SELECT i.* FROM issues i ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.number DESC LIMIT ?`;
      return db.prepare(sql).all(...params, limit).map((i) => shapeIssue(i));
    },

    getIssue(key) {
      return shapeIssue(requireIssue(key), { withComments: true });
    },

    createIssue(body = {}) {
      const project = requireProject(body.projectKey ?? body.project);
      const type = oneOf(body.type, TYPES, 'type', 'task');
      const summary = text(body.summary, 'summary', { max: 300 });
      const description = text(body.description, 'description', { max: 20000, required: false });
      const status = oneOf(body.status, STATUSES, 'status', 'todo');
      const priority = oneOf(body.priority, PRIORITIES, 'priority', 'medium');
      const assigneeId = resolveAssignee(body.assignee);
      const labels = Array.isArray(body.labels) ? body.labels : [];
      const startDate = dateField(body.startDate, 'startDate', today());
      const dueDate = dateField(body.dueDate, 'dueDate', startDate ? addDays(startDate, 7) : null);
      const sourceLang = oneOf(body.sourceLang, LANGS, 'sourceLang', 'es');
      if (startDate && dueDate && daysBetween(startDate, dueDate) < 0) {
        throw badRequest('"dueDate" no puede ser anterior a "startDate"');
      }

      db.exec('BEGIN IMMEDIATE');
      try {
        const number = (st.maxIssueNumber.get(project.id)?.n ?? 0) + 1;
        const issueKey = `${project.key}-${number}`;
        const stamp = now();
        const info = st.insertIssue.run(
          project.id,
          number,
          issueKey,
          type,
          summary,
          description,
          status,
          priority,
          assigneeId ?? null,
          startDate,
          dueDate,
          sourceLang,
          stamp,
          stamp
        );
        const issueId = Number(info.lastInsertRowid);
        applyLabels(issueId, labels);
        if (body.sprintId) {
          const sprint = requireSprint(body.sprintId);
          if (sprint.project_id !== project.id) throw badRequest('El sprint pertenece a otro proyecto');
          st.unlinkIssueFromAllSprints.run(issueId);
          st.linkSprintIssue.run(sprint.id, issueId, stamp);
        }
        db.exec('COMMIT');
        return shapeIssue(st.issueById.get(issueId), { withComments: true });
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    updateIssue(key, body = {}) {
      const issue = requireIssue(key);
      const type = body.type === undefined ? issue.type : oneOf(body.type, TYPES, 'type');
      const summary = body.summary === undefined ? issue.summary : text(body.summary, 'summary', { max: 300 });
      const description =
        body.description === undefined ? issue.description : text(body.description, 'description', { max: 20000, required: false });
      const status = body.status === undefined ? issue.status : oneOf(body.status, STATUSES, 'status');
      const priority = body.priority === undefined ? issue.priority : oneOf(body.priority, PRIORITIES, 'priority');
      const assigneeId = body.assignee === undefined ? issue.assignee_id : resolveAssignee(body.assignee);
      const startDate = dateField(body.startDate, 'startDate', issue.start_date ?? null);
      const dueDate = dateField(body.dueDate, 'dueDate', issue.due_date ?? null);
      const sourceLang = oneOf(body.sourceLang, LANGS, 'sourceLang', issue.source_lang ?? 'es');
      if (startDate && dueDate && daysBetween(startDate, dueDate) < 0) {
        throw badRequest('"dueDate" no puede ser anterior a "startDate"');
      }

      db.exec('BEGIN IMMEDIATE');
      try {
        st.updateIssue.run(type, summary, description, status, priority, assigneeId, startDate, dueDate, sourceLang, now(), issue.id);
        if (summary !== issue.summary || description !== issue.description || sourceLang !== issue.source_lang) {
          db.prepare('DELETE FROM issue_translations WHERE issue_id = ?').run(issue.id);
        }
        if (Array.isArray(body.labels)) applyLabels(issue.id, body.labels);
        if (body.sprintId !== undefined) {
          st.unlinkIssueFromAllSprints.run(issue.id);
          if (body.sprintId) {
            const sprint = requireSprint(body.sprintId);
            if (sprint.project_id !== issue.project_id) throw badRequest('El sprint pertenece a otro proyecto');
            st.linkSprintIssue.run(sprint.id, issue.id, now());
          }
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return shapeIssue(st.issueById.get(issue.id), { withComments: true });
    },

    deleteIssue(key) {
      const issue = requireIssue(key);
      st.deleteIssue.run(issue.id);
      return { deleted: true, key: issue.key };
    },

    /** Guarda una traducción de la incidencia para un idioma concreto. */
    setTranslation(key, lang, body = {}, provider = 'manual') {
      const issue = requireIssue(key);
      const target = oneOf(lang, LANGS, 'lang');
      const summary = text(body.summary, 'summary', { max: 300, required: false });
      const description = text(body.description, 'description', { max: 20000, required: false });
      st.upsertTranslation.run(issue.id, target, summary, description, provider, now());
      return shapeIssue(st.issueById.get(issue.id), { withComments: true });
    },

    deleteTranslation(key, lang) {
      const issue = requireIssue(key);
      const target = oneOf(lang, LANGS, 'lang');
      st.deleteTranslation.run(issue.id, target);
      return shapeIssue(st.issueById.get(issue.id), { withComments: true });
    },

    listTranslations(key) {
      const issue = requireIssue(key);
      return shapeTranslations(issue.id);
    },

    addComment(key, body = {}) {
      const issue = requireIssue(key);
      const textBody = text(body.body, 'body', { max: 5000 });
      const authorId = body.authorId === undefined ? null : resolveAssignee({ id: body.authorId });
      st.insertComment.run(issue.id, authorId, textBody, now());
      return shapeIssue(st.issueById.get(issue.id), { withComments: true });
    },

    listSprints(filters = {}) {
      const rows = filters.project
        ? st.sprintsOfProject.all(requireProject(filters.project).id)
        : st.allSprints.all();
      const filtered = filters.state ? rows.filter((s) => s.state === filters.state) : rows;
      return filtered.map((s) => ({
        ...shapeSprint(s),
        issueCount: st.issuesOfSprint.all(s.id).length,
      }));
    },

    getSprint(id) {
      const sprint = requireSprint(id);
      const issues = st.issuesOfSprint.all(sprint.id);
      const done = issues.filter((i) => i.status === 'done').length;
      return {
        ...shapeSprint(sprint),
        issues: issues.map((i) => shapeIssue(i)),
        stats: { total: issues.length, done, remaining: issues.length - done },
      };
    },

    createSprint(body = {}) {
      const project = requireProject(body.projectKey ?? body.project);
      const name = text(body.name, 'name', { max: 120 });
      const goal = text(body.goal, 'goal', { max: 1000, required: false });
      const startDate = optionalDate(body.startDate, 'startDate');
      const endDate = optionalDate(body.endDate, 'endDate');
      const info = st.insertSprint.run(project.id, name, goal, 'planned', startDate, endDate, now());
      return this.getSprint(Number(info.lastInsertRowid));
    },

    updateSprint(id, body = {}) {
      const sprint = requireSprint(id);
      const name = body.name === undefined ? sprint.name : text(body.name, 'name', { max: 120 });
      const goal = body.goal === undefined ? sprint.goal : text(body.goal, 'goal', { max: 1000, required: false });
      const startDate = body.startDate === undefined ? sprint.start_date : optionalDate(body.startDate, 'startDate');
      const endDate = body.endDate === undefined ? sprint.end_date : optionalDate(body.endDate, 'endDate');
      st.updateSprint.run(name, goal, startDate, endDate, sprint.id);
      return this.getSprint(sprint.id);
    },

    setSprintState(id, state) {
      const sprint = requireSprint(id);
      const next = oneOf(state, SPRINT_STATES, 'state');
      if (next === 'active') {
        const project = st.projectById.get(sprint.project_id);
        const alreadyActive = st.sprintsOfProject
          .all(project.id)
          .find((s) => s.state === 'active' && s.id !== sprint.id);
        if (alreadyActive) {
          throw conflict(`El sprint "${alreadyActive.name}" ya está activo en este proyecto`);
        }
      }
      st.setSprintState.run(next, sprint.id);
      return this.getSprint(sprint.id);
    },

    deleteSprint(id) {
      const sprint = requireSprint(id);
      st.deleteSprint.run(sprint.id);
      return { deleted: true, id: sprint.id };
    },

    addIssueToSprint(id, issueKey) {
      const sprint = requireSprint(id);
      const issue = requireIssue(issueKey);
      if (issue.project_id !== sprint.project_id) throw badRequest('La incidencia pertenece a otro proyecto');
      st.unlinkIssueFromAllSprints.run(issue.id);
      st.linkSprintIssue.run(sprint.id, issue.id, now());
      return this.getSprint(sprint.id);
    },

    removeIssueFromSprint(id, issueKey) {
      const sprint = requireSprint(id);
      const issue = requireIssue(issueKey);
      st.unlinkSprintIssue.run(sprint.id, issue.id);
      return this.getSprint(sprint.id);
    },

    /** Tablero por estados de un proyecto, con sprint activo y backlog. */
    board(projectKey) {
      const project = requireProject(projectKey);
      const issues = db.prepare('SELECT * FROM issues WHERE project_id = ? ORDER BY number').all(project.id);
      const sprints = st.sprintsOfProject.all(project.id);
      const active = sprints.find((s) => s.state === 'active') ?? null;
      const columns = STATUSES.map((status) => ({
        status,
        issues: issues.filter((i) => i.status === status).map((i) => shapeIssue(i)),
      }));
      const inSprint = new Set(
        db
          .prepare('SELECT sprint_id, issue_id FROM sprint_issues')
          .all()
          .filter((row) => sprints.some((s) => s.id === row.sprint_id))
          .map((row) => row.issue_id)
      );
      return {
        project: { key: project.key, name: project.name, description: project.description },
        columns,
        activeSprint: active ? shapeSprint(active) : null,
        sprints: sprints.map(shapeSprint),
        backlog: issues.filter((i) => !inSprint.has(i.id)).map((i) => shapeIssue(i)),
        users: st.allUsers.all().map(shapeUser),
      };
    },
  };
}
