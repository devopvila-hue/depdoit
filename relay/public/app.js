/* Relay — frontend local. Sin CDN, sin build, sin red: todo contra el servidor local.
   Interfaz en español, inglés, rumano y húngaro. */

const LANG_STORAGE_KEY = 'relay.lang';
const accessText = (key, vars) => window.TasksI18n?.t(key, vars) || key;
let translationPoll = null;

/**
 * Ruta en la que vive Relay dentro de este origen.
 *
 * Vacía cuando se sirve en la raíz (`/`), y algo como `/relay` cuando se
 * monta en un subdirectorio: entonces la API cuelga de `/relay/api` y los
 * ficheros estáticos de `/relay/...`, sin pisar lo que ya haya en la raíz.
 * Se deduce de la URL del propio documento, así que no hay que configurarlo.
 */
const API_BASE = (() => {
  const path = new URL('.', document.baseURI).pathname;
  return path === '/' ? '' : path.replace(/\/+$/, '');
})();

const state = {
  lang: 'es',
  projects: [],
  projectKey: null,
  view: 'board',
  board: null,
  issues: [],
  sprints: [],
  users: [],
  activeSprintId: null,
  search: '',
  filters: { status: '', type: '', assignee: '' },
  draggedKey: null,
  meta: null,
};

const I18N = window.RELAY_I18N ?? {};
const LANGS = window.RELAY_LANGS ?? [{ code: 'es', label: 'Español', short: 'ES' }];

function t(key, vars) {
  const dict = I18N[state.lang] ?? I18N.es ?? {};
  let text = dict[key] ?? I18N.es?.[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

const statusLabel = (status) => t(`status.${status}`);
const typeLabel = (type) => t(`type.${type}`);
const priorityLabel = (priority) => t(`priority.${priority}`);
const sprintStateLabel = (stateName) => t(`sprintState.${stateName}`);
const langShort = (code) => LANGS.find((lang) => lang.code === code)?.short ?? String(code ?? '').toUpperCase();

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function api(path, { method = 'GET', body } = {}) {
  const init = { method, headers: {} };
  const token = await getAuthToken();
  if (token) init.headers.authorization = `Bearer ${token}`;
  const workspace = window.DepdoitAuth?.context();
  if (workspace) init.headers['x-organization-id'] = workspace.organizationId;
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(API_BASE + path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && window.DepdoitAuth) {
      window.DepdoitAPI.signOut(); location.reload();
    } else if (res.status === 401 && !path.includes('/api/meta')) askToken();
    const error = new Error(data.error || `Error ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

/* ── acceso: sesión de Supabase compartida o token propio ─── */

/**
 * La app de tareas (tasks.departify.app) guarda su sesión de Supabase en
 * `localStorage['depdoit:session']`. Si Relay se sirve en el mismo origen,
 * lee esa misma sesión: mismo login, mismas invitaciones, sin duplicar nada.
 * El formato es idéntico al suyo (access_token, refresh_token, expires_at, user).
 */
const SESSION_KEY = 'depdoit:session';
const TOKEN_STORAGE_KEY = 'relay.token';

function readSharedSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!session?.access_token) return null;
    if (session.expires_at && Date.now() > session.expires_at - 30000) return { ...session, expired: true };
    return session;
  } catch {
    return null;
  }
}

function writeSharedSession(session) {
  try {
    if (!session) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* sin almacenamiento: la sesión dura lo que la pestaña */
  }
}

/** Refresca el token con el mismo endpoint que usa la app de tareas. */
async function refreshSharedSession(session) {
  const config = window.RELAY_CONFIG || {};
  if (!config.supabaseUrl || !session.refresh_token) return null;
  try {
    const res = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: config.supabaseAnonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const next = {
      ...session,
      access_token: data.access_token ?? session.access_token,
      refresh_token: data.refresh_token ?? session.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    };
    writeSharedSession(next);
    return next;
  } catch {
    return null;
  }
}

function getRelayToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function setRelayToken(value) {
  try {
    if (value) localStorage.setItem(TOKEN_STORAGE_KEY, value);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* sin almacenamiento: el token dura lo que la sesión */
  }
}

/** Token para la API: primero la sesión compartida, si no, el token propio. */
async function getAuthToken() {
  if (window.DepdoitAuth) return window.DepdoitAPI.token();
  const session = readSharedSession();
  if (session) {
    if (!session.expired) return session.access_token;
    const refreshed = await refreshSharedSession(session);
    return refreshed?.access_token ?? session.access_token;
  }
  return getRelayToken();
}

/**
 * Carga la configuración de Supabase. Si Relay vive en el mismo origen que la
 * app de tareas, reutiliza su `/config.js` en lugar de duplicar claves.
 *
 * Se prueba primero el config de la propia ruta de Relay y después el de la
 * raíz del origen (que es el de la app de tareas), para que funcione tanto
 * servido en la raíz como montado en un subdirectorio.
 */
async function loadConfig() {
  if (window.RELAY_CONFIG) return window.RELAY_CONFIG;
  if (window.DEPDOIT_CONFIG) {
    window.RELAY_CONFIG = {
      supabaseUrl: window.DEPDOIT_CONFIG.supabaseUrl || '',
      supabaseAnonKey: window.DEPDOIT_CONFIG.supabaseAnonKey || '',
    };
    return window.RELAY_CONFIG;
  }
  const sources = [...new Set([`${API_BASE}/config.js`, '/config.js'])];
  for (const source of sources) {
    await new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = source;
      script.onload = resolve;
      script.onerror = resolve;
      document.head.appendChild(script);
    });
    if (window.DEPDOIT_CONFIG) break;
  }
  window.RELAY_CONFIG = {
    supabaseUrl: window.DEPDOIT_CONFIG?.supabaseUrl || '',
    supabaseAnonKey: window.DEPDOIT_CONFIG?.supabaseAnonKey || '',
  };
  return window.RELAY_CONFIG;
}

function askToken() {
  const modal = $('modal');
  modal.innerHTML = `
    <h3>${escapeHtml(t('auth.title'))}</h3>
    <p style="color:var(--ink-2);font-size:13px;margin:0 0 6px">${escapeHtml(t('auth.hint'))}</p>
    <form id="modal-form">
      <label>${escapeHtml(t('auth.token'))}</label>
      <input name="token" type="password" autocomplete="off" />
      <div class="actions">
        <button type="submit" class="btn btn-primary">${escapeHtml(t('action.save'))}</button>
      </div>
    </form>`;
  $('modal-backdrop').hidden = false;
  $('modal-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = modal.querySelector('input[name=token]').value.trim();
    setRelayToken(value);
    closeModal();
    try {
      await refreshProjects();
    } catch (error) {
      flash(error.message);
    }
  });
  modal.querySelector('input[name=token]')?.focus();
}

/** Espera a que el servidor termine de traducir la incidencia recién creada. */
async function awaitTranslations(key, attempts = 25) {
  for (let index = 0; index < attempts; index++) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    try {
      const issue = await api(`/api/issues/${encodeURIComponent(key)}`);
      if (!issue.translationsPending) {
        await refreshProjectData();
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

let flashTimer = null;
function flash(message, ok = false) {
  const node = $('flash');
  node.textContent = message;
  node.className = ok ? 'flash ok' : 'flash';
  node.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    node.hidden = true;
  }, 3600);
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase();
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString({es:'es-ES',en:'en-GB',ro:'ro-RO',hu:'hu-HU'}[state.lang], { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Texto de la incidencia en el idioma de la interfaz, si existe traducción. */
function localized(issue) {
  const translation = issue.translations?.[state.lang];
  if (translation?.summary) {
    return { text: translation.summary, translated: true };
  }
  return { text: issue.summary, translated: false };
}

/** Muestra el idioma original cuando el texto sigue sin traducir. */
function originalBadge(issue) {
  if (issue.translations?.[state.lang]?.summary) return '';
  if (!issue.sourceLang || issue.sourceLang === state.lang) return '';
  return `<span class="lang-badge" title="${escapeHtml(t('tr.original'))}">${escapeHtml(langShort(issue.sourceLang))}</span>`;
}

/* ── datos ───────────────────────────────────────────────── */

async function refreshProjects() {
  state.projects = await api('/api/projects');
  const select = $('project-select');
  select.innerHTML = state.projects
    .map((project) => `<option value="${escapeHtml(project.key)}">${escapeHtml(project.key)} · ${escapeHtml(project.name)}</option>`)
    .join('');

  if (!state.projects.length) {
    state.projectKey = null;
    $('view-root').innerHTML = `
      <div class="empty"><p>${escapeHtml(t('empty.noProjects'))}</p><p>${escapeHtml(t('empty.noProjectsHint'))}</p></div>`;
    renderSidebar();
    return;
  }
  if (!state.projectKey || !state.projects.some((project) => project.key === state.projectKey)) {
    state.projectKey = state.projects[0].key;
  }
  select.value = state.projectKey;
  await refreshProjectData();
}

async function refreshProjectData() {
  if (!state.projectKey) return;
  const key = encodeURIComponent(state.projectKey);
  const [board, issues, sprints, users] = await Promise.all([
    api(`/api/board?project=${key}`),
    api(`/api/issues?project=${key}&limit=500`),
    api(`/api/sprints?project=${key}`),
    api('/api/users'),
  ]);
  state.board = board;
  state.issues = issues;
  state.sprints = sprints;
  state.users = users;
  if (state.activeSprintId && !sprints.some((sprint) => sprint.id === state.activeSprintId)) {
    state.activeSprintId = null;
  }
  render();
  const pending = issues.some(issue => issue.translationsPending && !issue.translationsFailed);
  const failed = issues.some(issue => issue.translationsFailed);
  const notice = $('notice');
  if (notice) {
    notice.hidden = !pending && !failed && Boolean(state.meta?.translation.available);
    notice.textContent = accessText(failed ? 'translationFailed' : pending ? 'translating' : 'translationMissing');
  }
  clearTimeout(translationPoll);
  if (pending) translationPoll = setTimeout(() => refreshProjectData().catch(() => {}), 1600);
}

function filteredIssues() {
  const needle = state.search.trim().toLowerCase();
  return state.issues.filter((issue) => {
    if (state.filters.status && issue.status !== state.filters.status) return false;
    if (state.filters.type && issue.type !== state.filters.type) return false;
    if (state.filters.assignee && issue.assignee?.id !== Number(state.filters.assignee)) return false;
    if (!needle) return true;
    const { text } = localized(issue);
    return (
      issue.key.toLowerCase().includes(needle) ||
      text.toLowerCase().includes(needle) ||
      (issue.translations?.[state.lang]?.description || issue.description || '').toLowerCase().includes(needle)
    );
  });
}

/* ── render ──────────────────────────────────────────────── */

function render() {
  renderSidebar();
  const root = $('view-root');
  if (!state.projectKey) return;
  if (state.view === 'board') renderBoard(root);
  else if (state.view === 'list') renderList(root);
  else if (state.view === 'sprint') renderSprint(root);
  else if (state.view === 'gantt') renderGantt(root);
  else renderBacklog(root);
}

function renderSidebar() {
  const sprintList = $('sprint-list');
  sprintList.innerHTML = '';
  if (!state.sprints.length) {
    sprintList.innerHTML = `<p class="empty" style="padding:8px 0;font-size:12px">${escapeHtml(t('sprint.none'))}</p>`;
  }
  for (const sprint of state.sprints) {
    const node = el('div', 'sprint-item' + (state.activeSprintId === sprint.id ? ' is-active' : ''));
    node.innerHTML = `
      <span class="sprint-dot ${sprint.state}"></span>
      <span>${escapeHtml(sprint.name)}</span>
      <span class="sprint-count">${sprint.issueCount ?? 0}</span>`;
    node.addEventListener('click', () => {
      state.activeSprintId = state.activeSprintId === sprint.id ? null : sprint.id;
      state.view = 'sprint';
      syncViewButtons();
      render();
    });
    sprintList.appendChild(node);
  }

  const userList = $('user-list');
  userList.innerHTML = '';
  for (const user of state.users) {
    const chip = el('div', 'user-chip');
    chip.innerHTML = `<span class="avatar">${escapeHtml(initials(user.displayName))}</span>${escapeHtml(user.displayName)}`;
    userList.appendChild(chip);
  }
}

function syncViewButtons() {
  for (const button of document.querySelectorAll('.view-btn')) {
    button.classList.toggle('is-active', button.dataset.view === state.view);
  }
}

function issueCard(issue) {
  const card = el('div', 'card');
  card.draggable = true;
  card.dataset.key = issue.key;
  const { text } = localized(issue);
  const labels = issue.labels.map((label) => `<span class="label-chip">${escapeHtml(label)}</span>`).join('');
  const avatar = issue.assignee
    ? `<span class="avatar" title="${escapeHtml(issue.assignee.displayName)}">${escapeHtml(initials(issue.assignee.displayName))}</span>`
    : '';
  card.innerHTML = `
    <div class="card-key">${escapeHtml(issue.key)}${originalBadge(issue)}</div>
    <div class="card-summary">${escapeHtml(text)}</div>
    <div class="card-meta">
      <span class="tag type-${escapeHtml(issue.type)}">${escapeHtml(typeLabel(issue.type))}</span>
      <span class="prio prio-${escapeHtml(issue.priority)}">${escapeHtml(priorityLabel(issue.priority))}</span>
      ${labels}
      ${avatar}
    </div>`;

  card.addEventListener('click', () => openIssue(issue.key));
  card.addEventListener('dragstart', (event) => {
    state.draggedKey = issue.key;
    card.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', issue.key);
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('is-dragging');
    state.draggedKey = null;
  });
  return card;
}

function renderBoard(root) {
  const board = state.board;
  const visible = new Set(filteredIssues().map((issue) => issue.key));
  const sprint = board.activeSprint;

  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1 class="view-title">${escapeHtml(board.project.name)}</h1>
        <p class="view-sub">${escapeHtml(board.project.key)} · ${escapeHtml(board.project.description || '')}</p>
      </div>
      <div class="view-head-actions">
        <button class="btn btn-ghost btn-sm" id="btn-legend">${escapeHtml(t('board.columns'))}</button>
        <button class="btn btn-primary btn-sm" id="btn-add-board-issue">${escapeHtml(t('action.newIssue'))}</button>
      </div>
    </div>`;

  const columns = el('div', 'board');
  for (const column of board.columns) {
    const node = el('div', 'column');
    node.dataset.status = column.status;
    const issues = column.issues.filter((issue) => visible.has(issue.key));
    node.innerHTML = `
      <div class="column-head">
        <span class="column-title">${escapeHtml(statusLabel(column.status))}</span>
        <span class="column-count">${issues.length}</span>
      </div>
      <div class="column-body"></div>`;
    const body = node.querySelector('.column-body');
    for (const issue of issues) body.appendChild(issueCard(issue));

    node.addEventListener('dragover', (event) => {
      event.preventDefault();
      node.classList.add('is-drop-target');
    });
    node.addEventListener('dragleave', () => node.classList.remove('is-drop-target'));
    node.addEventListener('drop', async (event) => {
      event.preventDefault();
      node.classList.remove('is-drop-target');
      const key = event.dataTransfer.getData('text/plain') || state.draggedKey;
      if (!key) return;
      await moveIssue(key, column.status);
    });

    columns.appendChild(node);
  }
  root.appendChild(columns);

  if (sprint) {
    const banner = el('div', 'view-sub');
    banner.style.margin = '14px 0 0';
    banner.textContent = `${t('board.activeSprint')}: ${sprint.name} · ${formatDate(sprint.endDate)}`;
    root.appendChild(banner);
  }

  $('btn-add-board-issue').addEventListener('click', () => openIssue(null));
  $('btn-legend').addEventListener('click', () => flash(t('board.dragHint'), true));
}

async function moveIssue(key, status) {
  try {
    await api(`/api/issues/${encodeURIComponent(key)}`, { method: 'PATCH', body: { status } });
    flash(t('flash.moved', { key, status: statusLabel(status) }), true);
    await refreshProjectData();
  } catch (error) {
    flash(error.message);
  }
}

function renderList(root) {
  const issues = filteredIssues();
  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1 class="view-title">${escapeHtml(t('list.title'))}</h1>
        <p class="view-sub">${escapeHtml(t('list.results', { count: issues.length }))}</p>
      </div>
      <div class="view-head-actions">
        <select id="f-status" style="width:auto"></select>
        <select id="f-type" style="width:auto"></select>
        <select id="f-assignee" style="width:auto"></select>
        <button class="btn btn-primary btn-sm" id="btn-add-list-issue">${escapeHtml(t('action.newIssue'))}</button>
      </div>
    </div>`;

  const statusSel = $('f-status');
  statusSel.innerHTML = `<option value="">${escapeHtml(t('list.allStatuses'))}</option>` + Object.keys(state.meta?.statuses ?? {})
    .map((status) => `<option value="${status}">${escapeHtml(statusLabel(status))}</option>`)
    .join('');
  const typeSel = $('f-type');
  typeSel.innerHTML = `<option value="">${escapeHtml(t('list.allTypes'))}</option>` + Object.keys(state.meta?.types ?? {})
    .map((type) => `<option value="${type}">${escapeHtml(typeLabel(type))}</option>`)
    .join('');
  const assigneeSel = $('f-assignee');
  assigneeSel.innerHTML = `<option value="">${escapeHtml(t('list.allAssignees'))}</option>`;
  for (const user of state.users) {
    assigneeSel.insertAdjacentHTML('beforeend', `<option value="${user.id}">${escapeHtml(user.displayName)}</option>`);
  }
  statusSel.value = state.filters.status;
  typeSel.value = state.filters.type;
  assigneeSel.value = state.filters.assignee;

  const onFilter = () => {
    state.filters.status = statusSel.value;
    state.filters.type = typeSel.value;
    state.filters.assignee = assigneeSel.value;
    render();
  };
  statusSel.addEventListener('change', onFilter);
  typeSel.addEventListener('change', onFilter);
  assigneeSel.addEventListener('change', onFilter);

  const rows = issues
    .map((issue) => {
      const { text } = localized(issue);
      return `
      <tr data-key="${escapeHtml(issue.key)}">
        <td style="color:var(--ink-3);font-weight:700">${escapeHtml(issue.key)}</td>
        <td><span class="tag type-${escapeHtml(issue.type)}">${escapeHtml(typeLabel(issue.type))}</span></td>
        <td>${escapeHtml(text)}${originalBadge(issue)}</td>
        <td><span class="status-pill">${escapeHtml(statusLabel(issue.status))}</span></td>
        <td class="prio prio-${escapeHtml(issue.priority)}">${escapeHtml(priorityLabel(issue.priority))}</td>
        <td>${escapeHtml(issue.assignee?.displayName || t('none.assignee'))}</td>
        <td>${escapeHtml(issue.sprint?.name || t('none.sprint'))}</td>
      </tr>`;
    })
    .join('');

  const wrap = el('div', 'table-wrap');
  wrap.innerHTML = `
    <table>
      <thead><tr>
        <th>${escapeHtml(t('table.key'))}</th><th>${escapeHtml(t('table.type'))}</th>
        <th>${escapeHtml(t('table.summary'))}</th><th>${escapeHtml(t('table.status'))}</th>
        <th>${escapeHtml(t('table.priority'))}</th><th>${escapeHtml(t('table.assignee'))}</th>
        <th>${escapeHtml(t('table.sprint'))}</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="empty">${escapeHtml(t('list.empty'))}</td></tr>`}</tbody>
    </table>`;
  for (const row of wrap.querySelectorAll('tbody tr[data-key]')) {
    row.addEventListener('click', () => openIssue(row.dataset.key));
  }
  root.appendChild(wrap);
  $('btn-add-list-issue').addEventListener('click', () => openIssue(null));
}

function renderSprint(root) {
  const sprint = state.sprints.find((item) => item.id === state.activeSprintId) || state.sprints[0] || null;
  if (!sprint) {
    root.innerHTML = `<div class="empty"><p>${escapeHtml(t('sprint.none'))}</p></div>`;
    return;
  }
  const sprintIssues = state.issues.filter((issue) => issue.sprint?.id === sprint.id);
  const done = sprintIssues.filter((issue) => issue.status === 'done').length;
  const pct = sprintIssues.length ? Math.round((done / sprintIssues.length) * 100) : 0;

  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1 class="view-title">${escapeHtml(sprint.name)}</h1>
        <p class="view-sub">${escapeHtml(sprintStateLabel(sprint.state))} · ${escapeHtml(t('sprint.dates', { start: formatDate(sprint.startDate), end: formatDate(sprint.endDate) }))}</p>
      </div>
      <div class="view-head-actions" id="sprint-actions"></div>
    </div>
    <div class="sprint-grid">
      <div class="panel">
        <h3>${escapeHtml(t('sprint.progress'))}</h3>
        <div id="sprint-issues"></div>
      </div>
      <div>
        <div class="panel">
          <h3>${escapeHtml(t('sprint.progress'))}</h3>
          <div class="progress"><span style="width:${pct}%"></span></div>
          <div class="stat-row"><span>${escapeHtml(t('sprint.completed'))}</span><strong>${done}</strong></div>
          <div class="stat-row"><span>${escapeHtml(t('sprint.remaining'))}</span><strong>${sprintIssues.length - done}</strong></div>
          <div class="stat-row"><span>${escapeHtml(t('sprint.total'))}</span><strong>${sprintIssues.length}</strong></div>
        </div>
        <div class="panel" style="margin-top:14px">
          <h3>${escapeHtml(t('sprint.goal'))}</h3>
          <p style="color:var(--ink-2);font-size:13px;margin:0">${escapeHtml(sprint.goal || t('sprint.noGoal'))}</p>
        </div>
        <div class="panel" style="margin-top:14px">
          <h3>${escapeHtml(t('sprint.addToSprint'))}</h3>
          <select id="add-to-sprint"></select>
          <button class="btn btn-ghost btn-block" id="btn-add-to-sprint">${escapeHtml(t('action.add'))}</button>
        </div>
      </div>
    </div>`;

  const list = el('div');
  if (!sprintIssues.length) {
    list.innerHTML = `<p class="empty">${escapeHtml(t('sprint.noIssues'))}</p>`;
  }
  for (const issue of sprintIssues) list.appendChild(issueCard(issue));
  $('sprint-issues').appendChild(list);

  const actions = $('sprint-actions');
  if (sprint.state !== 'active') {
    const start = el('button', 'btn btn-primary btn-sm', t('sprint.start'));
    start.addEventListener('click', async () => {
      try {
        await api(`/api/sprints/${sprint.id}/state`, { method: 'POST', body: { state: 'active' } });
        flash(t('flash.sprintStarted', { name: sprint.name }), true);
        await refreshProjectData();
      } catch (error) {
        flash(error.message);
      }
    });
    actions.appendChild(start);
  } else {
    const finish = el('button', 'btn btn-primary btn-sm', t('sprint.complete'));
    finish.addEventListener('click', async () => {
      try {
        await api(`/api/sprints/${sprint.id}/state`, { method: 'POST', body: { state: 'completed' } });
        flash(t('flash.sprintCompleted', { name: sprint.name }), true);
        await refreshProjectData();
      } catch (error) {
        flash(error.message);
      }
    });
    actions.appendChild(finish);
  }

  const select = $('add-to-sprint');
  const candidates = state.issues.filter((issue) => issue.sprint?.id !== sprint.id);
  select.innerHTML = candidates
    .map((issue) => `<option value="${escapeHtml(issue.key)}">${escapeHtml(issue.key)} · ${escapeHtml(localized(issue).text)}</option>`)
    .join('');
  $('btn-add-to-sprint').addEventListener('click', async () => {
    if (!select.value) return flash(t('list.empty'));
    try {
      await api(`/api/sprints/${sprint.id}/issues`, { method: 'POST', body: { issueKey: select.value } });
      flash(`${select.value} → ${sprint.name}`, true);
      await refreshProjectData();
    } catch (error) {
      flash(error.message);
    }
  });
}

/* ── gantt ──────────────────────────────────────────────── */

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function shortDate(iso, bucket) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (bucket >= 30) {
    return date.toLocaleDateString({es:'es-ES',en:'en-GB',ro:'ro-RO',hu:'hu-HU'}[state.lang], { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
  return date.toLocaleDateString({es:'es-ES',en:'en-GB',ro:'ro-RO',hu:'hu-HU'}[state.lang], { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

function renderGantt(root) {
  const issues = filteredIssues();
  const sprints = state.sprints;

  const dates = [];
  for (const issue of issues) {
    if (issue.startDate) dates.push(issue.startDate);
    if (issue.dueDate) dates.push(issue.dueDate);
  }
  for (const sprint of sprints) {
    if (sprint.startDate) dates.push(sprint.startDate);
    if (sprint.endDate) dates.push(sprint.endDate);
  }

  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1 class="view-title">${escapeHtml(t('gantt.title'))}</h1>
        <p class="view-sub" id="gantt-sub"></p>
      </div>
      <div class="view-head-actions">
        <button class="btn btn-ghost btn-sm" id="btn-gantt-legend">${escapeHtml(t('gantt.legend'))}</button>
        <button class="btn btn-primary btn-sm" id="btn-add-gantt-issue">${escapeHtml(t('action.newIssue'))}</button>
      </div>
    </div>`;

  if (!dates.length) {
    const empty = el('div', 'empty');
    empty.innerHTML = `<p>${escapeHtml(t('gantt.empty'))}</p>`;
    root.appendChild(empty);
    $('btn-add-gantt-issue').addEventListener('click', () => openIssue(null));
    $('btn-gantt-legend').addEventListener('click', () => flash(t('gantt.hint'), true));
    return;
  }

  dates.sort();
  const rangeStart = dates[0];
  let rangeEnd = dates[dates.length - 1];
  if (daysBetween(rangeStart, rangeEnd) < 13) rangeEnd = addDays(rangeStart, 13);
  const dayCount = daysBetween(rangeStart, rangeEnd) + 1;
  const bucket = dayCount <= 70 ? 1 : dayCount <= 420 ? 7 : 30;
  const columns = Math.ceil(dayCount / bucket);
  const granularity = t(`gantt.scale.${bucket === 1 ? 'day' : bucket === 7 ? 'week' : 'month'}`);

  $('gantt-sub').textContent = t('gantt.sub', {
    start: formatDate(rangeStart),
    end: formatDate(rangeEnd),
    scale: granularity,
    count: issues.length,
  });

  const groups = sprints.map((sprint) => ({ sprint, issues: issues.filter((issue) => issue.sprint?.id === sprint.id) }));
  const loose = issues.filter((issue) => !issue.sprint);
  if (loose.length) groups.push({ sprint: null, issues: loose });

  const rows = [];
  for (const group of groups) {
    if (group.sprint) {
      rows.push({
        kind: 'sprint',
        label: group.sprint.name,
        sub: sprintStateLabel(group.sprint.state),
        start: group.sprint.startDate,
        end: group.sprint.endDate,
        state: group.sprint.state,
      });
    }
    for (const issue of group.issues) {
      const start = issue.startDate || (issue.createdAt ? issue.createdAt.slice(0, 10) : null);
      rows.push({
        kind: 'issue',
        label: issue.key,
        sub: localized(issue).text,
        start,
        end: issue.dueDate || start,
        status: issue.status,
        key: issue.key,
      });
    }
  }

  const bucketIndex = (date) => Math.floor(daysBetween(rangeStart, date) / bucket);
  const grid = el('div', 'gantt');
  grid.style.setProperty('--gantt-cols', String(columns));

  const headLabel = el('div', 'gantt-cell gantt-head-label', t('list.title'));
  headLabel.style.gridColumn = '1';
  headLabel.style.gridRow = '1';
  grid.appendChild(headLabel);

  for (let i = 0; i < columns; i++) {
    const date = addDays(rangeStart, i * bucket);
    const cell = el('div', 'gantt-cell gantt-head', shortDate(date, bucket));
    cell.style.gridColumn = String(i + 2);
    cell.style.gridRow = '1';
    grid.appendChild(cell);
  }

  rows.forEach((row, index) => {
    const gridRow = String(index + 2);
    const label = el('div', 'gantt-cell gantt-label' + (row.kind === 'sprint' ? ' is-sprint' : ''));
    label.style.gridColumn = '1';
    label.style.gridRow = gridRow;
    label.innerHTML =
      row.kind === 'sprint'
        ? `<span class="sprint-dot ${escapeHtml(row.state)}"></span><span class="gantt-sum">${escapeHtml(row.label)}</span><span class="gantt-sub">${escapeHtml(row.sub)}</span>`
        : `<span class="gantt-key">${escapeHtml(row.label)}</span><span class="gantt-sum">${escapeHtml(row.sub)}</span>`;
    grid.appendChild(label);

    if (!row.start) return;
    const from = Math.max(0, Math.min(columns - 1, bucketIndex(row.start)));
    const to = Math.max(from, Math.min(columns - 1, bucketIndex(row.end)));
    const bar = el('div', `gantt-bar ${row.kind === 'sprint' ? 'gantt-bar-sprint is-' + row.state : 'gantt-bar-' + row.status}`);
    bar.style.gridColumn = `${from + 2} / ${to + 3}`;
    bar.style.gridRow = gridRow;
    bar.innerHTML = `<span class="gantt-bar-title">${escapeHtml(row.sub)}</span>`;
    if (row.kind === 'issue') {
      bar.title = `${row.key} · ${row.start} → ${row.end}`;
      bar.addEventListener('click', () => openIssue(row.key));
    }
    grid.appendChild(bar);
  });

  const today = isoDate(new Date());
  if (today >= rangeStart && today <= rangeEnd) {
    const line = el('div', 'gantt-today');
    line.style.gridColumn = String(bucketIndex(today) + 2);
    line.style.gridRow = `1 / ${rows.length + 2}`;
    grid.appendChild(line);
  }

  const wrap = el('div', 'gantt-wrap');
  wrap.appendChild(grid);
  root.appendChild(wrap);

  $('btn-add-gantt-issue').addEventListener('click', () => openIssue(null));
  $('btn-gantt-legend').addEventListener('click', () => flash(t('gantt.hint'), true));
}

function renderBacklog(root) {
  const inSprint = new Set(state.issues.filter((issue) => issue.sprint).map((issue) => issue.key));
  const backlog = filteredIssues().filter((issue) => !inSprint.has(issue.key));
  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1 class="view-title">${escapeHtml(t('backlog.title'))}</h1>
        <p class="view-sub">${escapeHtml(t('backlog.count', { count: backlog.length }))}</p>
      </div>
      <div class="view-head-actions">
        <button class="btn btn-primary btn-sm" id="btn-add-backlog-issue">${escapeHtml(t('action.newIssue'))}</button>
      </div>
    </div>`;
  const rows = backlog
    .map((issue) => `
      <tr data-key="${escapeHtml(issue.key)}">
        <td style="color:var(--ink-3);font-weight:700">${escapeHtml(issue.key)}</td>
        <td><span class="tag type-${escapeHtml(issue.type)}">${escapeHtml(typeLabel(issue.type))}</span></td>
        <td>${escapeHtml(localized(issue).text)}${originalBadge(issue)}</td>
        <td><span class="status-pill">${escapeHtml(statusLabel(issue.status))}</span></td>
        <td class="prio prio-${escapeHtml(issue.priority)}">${escapeHtml(priorityLabel(issue.priority))}</td>
        <td>${escapeHtml(issue.assignee?.displayName || t('none.assignee'))}</td>
      </tr>`)
    .join('');
  const wrap = el('div', 'table-wrap');
  wrap.innerHTML = `
    <table>
      <thead><tr>
        <th>${escapeHtml(t('table.key'))}</th><th>${escapeHtml(t('table.type'))}</th>
        <th>${escapeHtml(t('table.summary'))}</th><th>${escapeHtml(t('table.status'))}</th>
        <th>${escapeHtml(t('table.priority'))}</th><th>${escapeHtml(t('table.assignee'))}</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="empty">${escapeHtml(t('backlog.empty'))}</td></tr>`}</tbody>
    </table>`;
  for (const row of wrap.querySelectorAll('tbody tr[data-key]')) {
    row.addEventListener('click', () => openIssue(row.dataset.key));
  }
  root.appendChild(wrap);
  $('btn-add-backlog-issue').addEventListener('click', () => openIssue(null));
}

/* ── ficha de incidencia ─────────────────────────────────── */

function languageOptions(selected) {
  return LANGS.map((lang) => `<option value="${lang.code}" ${lang.code === selected ? 'selected' : ''}>${escapeHtml(lang.label)}</option>`).join('');
}

function translationsBlock(issue) {
  const rows = LANGS.map((lang) => {
    const translation = issue.translations?.[lang.code];
    const isSource = issue.sourceLang === lang.code;
    return `
      <div class="tr-row" data-lang="${lang.code}">
        <span class="tr-code">${escapeHtml(lang.short)}</span>
        <span class="tr-text">${escapeHtml(translation?.summary || (isSource ? issue.summary : t('tr.missing')))}</span>
        <button class="btn btn-ghost btn-sm tr-auto" data-lang="${lang.code}" ${isSource ? 'disabled' : ''}>${escapeHtml(t('tr.auto'))}</button>
        <button class="btn btn-ghost btn-sm tr-edit" data-lang="${lang.code}">${escapeHtml(t('tr.edit'))}</button>
      </div>`;
  }).join('');

  return `
    <h3 class="section-title">${escapeHtml(t('tr.title'))}</h3>
    <div id="tr-list">${rows}</div>
    <div id="tr-editor" hidden></div>`;
}

async function openIssue(key) {
  const root = $('drawer-root');
  const drawer = $('drawer');
  const backdrop = $('drawer-backdrop');

  if (!key) {
    root.innerHTML = issueForm(null);
    drawer.hidden = false;
    backdrop.hidden = false;
    bindIssueForm(null);
    return;
  }

  root.dataset.issueKey = key;
  let issue;
  try {
    issue = await api(`/api/issues/${encodeURIComponent(key)}`);
  } catch (error) {
    flash(error.message);
    return;
  }

  const comments = (issue.comments || [])
    .map(
      (comment) => `
      <div class="comment">
        <div class="comment-author">${escapeHtml(comment.author || '—')}</div>
        <div class="comment-body">${escapeHtml(comment.body)}</div>
        <div class="comment-time">${formatDate(comment.createdAt)}</div>
      </div>`
    )
    .join('');

  root.innerHTML = `
    <div class="drawer-head">
      <span class="drawer-key">${escapeHtml(issue.key)}</span>
      <button class="icon-btn" id="drawer-close">×</button>
    </div>
    <h2 class="drawer-title">${escapeHtml(localized(issue).text)}</h2>
    ${issue.translations?.[state.lang]?.description ? `<div id="translated-description" style="white-space:pre-wrap;margin-bottom:16px">${escapeHtml(issue.translations[state.lang].description)}</div>` : ''}
    <div class="row2">
      <div>
        <label>${escapeHtml(t('drawer.status'))}</label>
        <select id="i-status">${(state.meta?.statuses ?? []).map((status) => `<option value="${status}" ${status === issue.status ? 'selected' : ''}>${escapeHtml(statusLabel(status))}</option>`).join('')}</select>
      </div>
      <div>
        <label>${escapeHtml(t('drawer.type'))}</label>
        <select id="i-type">${(state.meta?.types ?? []).map((type) => `<option value="${type}" ${type === issue.type ? 'selected' : ''}>${escapeHtml(typeLabel(type))}</option>`).join('')}</select>
      </div>
      <div>
        <label>${escapeHtml(t('drawer.priority'))}</label>
        <select id="i-priority">${(state.meta?.priorities ?? []).map((priority) => `<option value="${priority}" ${priority === issue.priority ? 'selected' : ''}>${escapeHtml(priorityLabel(priority))}</option>`).join('')}</select>
      </div>
      <div>
        <label>${escapeHtml(t('drawer.assignee'))}</label>
        <select id="i-assignee">
          <option value="">${escapeHtml(t('none.assignee'))}</option>
          ${state.users.map((user) => `<option value="${user.id}" ${issue.assignee?.id === user.id ? 'selected' : ''}>${escapeHtml(user.displayName)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="row2">
      <div>
        <label>${escapeHtml(t('drawer.start'))}</label>
        <input id="i-start" type="date" value="${escapeHtml(issue.startDate || '')}" />
      </div>
      <div>
        <label>${escapeHtml(t('drawer.due'))}</label>
        <input id="i-due" type="date" value="${escapeHtml(issue.dueDate || '')}" />
      </div>
    </div>
    <label>${escapeHtml(t('drawer.sprint'))}</label>
    <select id="i-sprint">
      <option value="">${escapeHtml(t('none.sprint'))}</option>
      ${state.sprints.map((sprint) => `<option value="${sprint.id}" ${issue.sprint?.id === sprint.id ? 'selected' : ''}>${escapeHtml(sprint.name)} (${escapeHtml(sprintStateLabel(sprint.state))})</option>`).join('')}
    </select>
    <label>${escapeHtml(t('drawer.labels'))}</label>
    <input id="i-labels" value="${escapeHtml(issue.labels.join(', '))}" />
    <label>${escapeHtml(t('drawer.description'))} · ${escapeHtml(accessText('original'))} (${escapeHtml(langShort(issue.sourceLang))})</label>
    <textarea id="i-description">${escapeHtml(issue.description)}</textarea>
    <label>${escapeHtml(t('drawer.originalLang'))}</label>
    <select id="i-source-lang">${languageOptions(issue.sourceLang)}</select>
    <div class="actions">
      <button class="btn btn-primary" id="i-save">${escapeHtml(t('action.save'))}</button>
      <button class="btn btn-danger" id="i-delete">${escapeHtml(t('action.delete'))}</button>
    </div>
    ${translationsBlock(issue)}
    <h3 class="section-title">${escapeHtml(t('drawer.comments'))}</h3>
    <div id="i-comments">${comments || `<p class="empty" style="padding:10px 0;font-size:12px">${escapeHtml(t('drawer.noComments'))}</p>`}</div>
    <label>${escapeHtml(t('drawer.newComment'))}</label>
    <textarea id="i-comment-body" style="min-height:64px"></textarea>
    <button class="btn btn-ghost btn-block" id="i-comment-add">${escapeHtml(t('drawer.addComment'))}</button>`;

  drawer.hidden = false;
  backdrop.hidden = false;

  $('drawer-close').addEventListener('click', closeDrawer);
  $('i-save').addEventListener('click', async () => {
    try {
      await api(`/api/issues/${encodeURIComponent(issue.key)}`, {
        method: 'PATCH',
        body: {
          status: $('i-status').value,
          type: $('i-type').value,
          priority: $('i-priority').value,
          assignee: $('i-assignee').value || null,
          sprintId: $('i-sprint').value || null,
          startDate: $('i-start').value || null,
          dueDate: $('i-due').value || null,
          sourceLang: $('i-source-lang').value,
          labels: $('i-labels').value.split(',').map((label) => label.trim()).filter(Boolean),
          description: $('i-description').value,
        },
      });
      flash(t('flash.saved', { key: issue.key }), true);
      closeDrawer();
      await refreshProjectData();
    } catch (error) {
      flash(error.message);
    }
  });
  $('i-delete').addEventListener('click', async () => {
    try {
      await api(`/api/issues/${encodeURIComponent(issue.key)}`, { method: 'DELETE' });
      flash(t('flash.deleted', { key: issue.key }), true);
      closeDrawer();
      await refreshProjectData();
    } catch (error) {
      flash(error.message);
    }
  });
  $('i-comment-add').addEventListener('click', async () => {
    const body = $('i-comment-body').value.trim();
    if (!body) return flash(t('drawer.newComment'));
    try {
      await api(`/api/issues/${encodeURIComponent(issue.key)}/comments`, { method: 'POST', body: { body } });
      await refreshProjectData();
      openIssue(issue.key);
    } catch (error) {
      flash(error.message);
    }
  });

  bindTranslationActions(issue);
}

function bindTranslationActions(issue) {
  for (const button of document.querySelectorAll('#drawer-root .tr-auto')) {
    button.addEventListener('click', async () => {
      const lang = button.dataset.lang;
      button.disabled = true;
      button.textContent = t('tr.generating');
      try {
        await api(`/api/issues/${encodeURIComponent(issue.key)}/translate`, { method: 'POST', body: { lang } });
        flash(t('tr.saved'), true);
        await refreshProjectData();
        openIssue(issue.key);
      } catch (error) {
        flash(error.status === 503 ? accessText('translationMissing') : error.message);
        button.disabled = false;
        button.textContent = t('tr.auto');
      }
    });
  }

  for (const button of document.querySelectorAll('#drawer-root .tr-edit')) {
    button.addEventListener('click', () => {
      const lang = button.dataset.lang;
      const translation = issue.translations?.[lang] ?? {};
      const editor = $('tr-editor');
      editor.hidden = false;
      editor.innerHTML = `
        <div class="panel" style="margin:10px 0">
          <h3>${escapeHtml(LANGS.find((item) => item.code === lang)?.label ?? lang)}</h3>
          <label>${escapeHtml(t('drawer.summary'))}</label>
          <input id="tr-summary" value="${escapeHtml(translation.summary ?? '')}" placeholder="${escapeHtml(t('tr.summaryPlaceholder'))}" />
          <label>${escapeHtml(t('drawer.description'))}</label>
          <textarea id="tr-description" placeholder="${escapeHtml(t('tr.descriptionPlaceholder'))}">${escapeHtml(translation.description ?? '')}</textarea>
          <div class="actions">
            <button class="btn btn-primary btn-sm" id="tr-save">${escapeHtml(t('action.save'))}</button>
            <button class="btn btn-ghost btn-sm" id="tr-cancel">${escapeHtml(t('action.cancel'))}</button>
          </div>
        </div>`;
      $('tr-cancel').addEventListener('click', () => {
        editor.hidden = true;
        editor.innerHTML = '';
      });
      $('tr-save').addEventListener('click', async () => {
        try {
          await api(`/api/issues/${encodeURIComponent(issue.key)}/translations/${lang}`, {
            method: 'PUT',
            body: { summary: $('tr-summary').value, description: $('tr-description').value },
          });
          flash(t('tr.saved'), true);
          await refreshProjectData();
          openIssue(issue.key);
        } catch (error) {
          flash(error.message);
        }
      });
    });
  }
}

function issueForm() {
  return `
    <div class="drawer-head">
      <span class="drawer-key">${escapeHtml(t('drawer.newIssue'))}</span>
      <button class="icon-btn" id="drawer-close">×</button>
    </div>
    <h2 class="drawer-title">${escapeHtml(t('drawer.createIssue'))}</h2>
    <label>${escapeHtml(t('drawer.summary'))}</label>
    <input id="n-summary" placeholder="${escapeHtml(t('placeholder.summary'))}" />
    <div class="row2">
      <div>
        <label>${escapeHtml(t('drawer.type'))}</label>
        <select id="n-type">${(state.meta?.types ?? []).map((type) => `<option value="${type}">${escapeHtml(typeLabel(type))}</option>`).join('')}</select>
      </div>
      <div>
        <label>${escapeHtml(t('drawer.priority'))}</label>
        <select id="n-priority">${(state.meta?.priorities ?? []).map((priority) => `<option value="${priority}">${escapeHtml(priorityLabel(priority))}</option>`).join('')}</select>
      </div>
      <div>
        <label>${escapeHtml(t('drawer.assignee'))}</label>
        <select id="n-assignee"><option value="">${escapeHtml(t('none.assignee'))}</option>${state.users.map((user) => `<option value="${user.id}">${escapeHtml(user.displayName)}</option>`).join('')}</select>
      </div>
      <div>
        <label>${escapeHtml(t('drawer.sprint'))}</label>
        <select id="n-sprint"><option value="">${escapeHtml(t('none.sprint'))}</option>${state.sprints.map((sprint) => `<option value="${sprint.id}">${escapeHtml(sprint.name)}</option>`).join('')}</select>
      </div>
    </div>
    <label>${escapeHtml(t('drawer.labels'))}</label>
    <input id="n-labels" placeholder="${escapeHtml(t('placeholder.labels'))}" />
    <div class="row2">
      <div>
        <label>${escapeHtml(t('drawer.start'))}</label>
        <input id="n-start" type="date" />
      </div>
      <div>
        <label>${escapeHtml(t('drawer.due'))}</label>
        <input id="n-due" type="date" />
      </div>
    </div>
    <label>${escapeHtml(t('drawer.originalLang'))}</label>
    <select id="n-source-lang">${languageOptions(state.lang)}</select>
    <label>${escapeHtml(t('drawer.description'))}</label>
    <textarea id="n-description"></textarea>
    <div class="actions">
      <button class="btn btn-primary" id="n-save">${escapeHtml(t('action.save'))}</button>
      <button class="btn btn-ghost" id="n-cancel">${escapeHtml(t('action.cancel'))}</button>
    </div>`;
}

function bindIssueForm() {
  $('drawer-close').addEventListener('click', closeDrawer);
  $('n-cancel').addEventListener('click', closeDrawer);
  $('n-save').addEventListener('click', async () => {
    try {
      const payload = {
        projectKey: state.projectKey,
        summary: $('n-summary').value,
        type: $('n-type').value,
        priority: $('n-priority').value,
        assignee: $('n-assignee').value || null,
        sprintId: $('n-sprint').value || null,
        sourceLang: $('n-source-lang').value,
        labels: $('n-labels').value.split(',').map((label) => label.trim()).filter(Boolean),
        description: $('n-description').value,
      };
      // Sin fechas informadas se deja que el servidor aplique los valores por defecto.
      if ($('n-start').value) payload.startDate = $('n-start').value;
      if ($('n-due').value) payload.dueDate = $('n-due').value;
      const created = await api('/api/issues', { method: 'POST', body: payload });
      flash(t('flash.created', { key: created.key }), true);
      closeDrawer();
      await refreshProjectData();
      if (created.translationsPending) {
        flash(t('tr.generating'));
        awaitTranslations(created.key);
      }
    } catch (error) {
      flash(error.message);
    }
  });
}

function closeDrawer() {
  $('drawer').hidden = true;
  $('drawer-backdrop').hidden = true;
}

/* ── modales ─────────────────────────────────────────────── */

function openModal(title, fieldsHtml, onSubmit) {
  const modal = $('modal');
  modal.innerHTML = `
    <h3>${escapeHtml(title)}</h3>
    <form id="modal-form">
      ${fieldsHtml}
      <div class="actions">
        <button type="submit" class="btn btn-primary">${escapeHtml(t('action.save'))}</button>
        <button type="button" class="btn btn-ghost" id="modal-cancel">${escapeHtml(t('action.cancel'))}</button>
      </div>
    </form>`;
  $('modal-backdrop').hidden = false;
  $('modal-cancel').addEventListener('click', closeModal);
  $('modal-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = {};
    for (const field of modal.querySelectorAll('input, select, textarea')) {
      data[field.name] = field.value;
    }
    try {
      await onSubmit(data);
      closeModal();
    } catch (error) {
      flash(error.message);
    }
  });
  const first = modal.querySelector('input, select, textarea');
  if (first) first.focus();
}

function closeModal() {
  $('modal-backdrop').hidden = true;
  $('modal').innerHTML = '';
}

/* ── idioma ──────────────────────────────────────────────── */

function setLang(lang) {
  if (!I18N[lang]) return;
  state.lang = lang;
  if (window.TasksI18n?.language() !== lang) window.TasksI18n?.set(lang);
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* almacenamiento no disponible: el idioma dura lo que la sesión */
  }
  const select = $('lang-select');
  if (select) select.value = lang;
  applyStaticLabels();
  render();
  if (!$('drawer').hidden && $('drawer-root').dataset.issueKey) openIssue($('drawer-root').dataset.issueKey);
}

function applyStaticLabels() {
  $('search').placeholder = t('search.placeholder');
  $('btn-new-issue').textContent = t('action.newIssue');
  $('btn-new-project').textContent = t('action.newProject');
  $('btn-new-sprint').textContent = t('action.newSprint');
  $('btn-new-user').textContent = t('action.newMember');
  $('lang-select').setAttribute('aria-label', accessText('language'));
  $('project-select').setAttribute('aria-label', t('project.label'));
  $('views-title').textContent = t('nav.views');
  $('sprints-title').textContent = t('nav.sprints');
  $('team-title').textContent = t('nav.team');
  for (const button of document.querySelectorAll('.view-btn')) {
    button.textContent = t(`nav.${button.dataset.view}`);
  }
}

/* ── eventos ─────────────────────────────────────────────── */

function bindStaticEvents() {
  $('project-select').addEventListener('change', async (event) => {
    state.projectKey = event.target.value;
    state.activeSprintId = null;
    state.search = '';
    $('search').value = '';
    await refreshProjectData();
  });

  $('lang-select').addEventListener('change', (event) => setLang(event.target.value));
  window.addEventListener('tasks-language-change', event => { if (state.lang !== event.detail) setLang(event.detail); });

  $('search').addEventListener('input', (event) => {
    state.search = event.target.value;
    render();
  });

  for (const button of document.querySelectorAll('.view-btn')) {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      syncViewButtons();
      render();
    });
  }

  $('btn-new-issue').addEventListener('click', () => openIssue(null));
  $('btn-new-project').addEventListener('click', () => {
    openModal(
      t('modal.newProject'),
      `<label>${escapeHtml(t('modal.key'))}</label><input name="key" placeholder="${escapeHtml(t('placeholder.key'))}" />
       <label>${escapeHtml(t('modal.name'))}</label><input name="name" placeholder="${escapeHtml(t('placeholder.name'))}" />
       <label>${escapeHtml(t('modal.description'))}</label><textarea name="description"></textarea>`,
      async (data) => {
        await api('/api/projects', { method: 'POST', body: data });
        flash(t('flash.projectCreated', { key: data.key.toUpperCase() }), true);
        state.projectKey = data.key.toUpperCase();
        await refreshProjects();
      }
    );
  });

  $('btn-new-sprint').addEventListener('click', () => {
    openModal(
      t('modal.newSprint'),
      `<label>${escapeHtml(t('modal.name'))}</label><input name="name" placeholder="${escapeHtml(t('placeholder.sprint'))}" />
       <label>${escapeHtml(t('modal.goal'))}</label><textarea name="goal"></textarea>
       <label>${escapeHtml(t('modal.start'))}</label><input name="startDate" type="date" />
       <label>${escapeHtml(t('modal.end'))}</label><input name="endDate" type="date" />`,
      async (data) => {
        const sprint = await api('/api/sprints', {
          method: 'POST',
          body: { projectKey: state.projectKey, ...data },
        });
        flash(t('flash.sprintCreated', { name: sprint.name }), true);
        state.activeSprintId = sprint.id;
        await refreshProjectData();
      }
    );
  });

  $('btn-new-user').addEventListener('click', () => {
    if (window.DepdoitAuth) { location.assign('/admin'); return; }
    openModal(
      t('modal.newMember'),
      `<label>${escapeHtml(t('modal.name'))}</label><input name="displayName" placeholder="${escapeHtml(t('placeholder.person'))}" />
       <label>${escapeHtml(t('modal.email'))}</label><input name="email" type="email" placeholder="${escapeHtml(t('placeholder.email'))}" />`,
      async (data) => {
        await api('/api/users', { method: 'POST', body: data });
        flash(t('flash.memberAdded'), true);
        await refreshProjectData();
      }
    );
  });

  $('drawer-backdrop').addEventListener('click', closeDrawer);
  $('modal-backdrop').addEventListener('click', (event) => {
    if (event.target === $('modal-backdrop')) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeDrawer();
      closeModal();
    }
  });
}

async function init() {
  bindStaticEvents();

  const langSelect = $('lang-select');
  langSelect.innerHTML = LANGS.map((lang) => `<option value="${lang.code}">${escapeHtml(lang.label)}</option>`).join('');

  let saved = null;
  try {
    saved = localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    saved = null;
  }
  state.lang = I18N[saved] ? saved : 'es';
  langSelect.value = state.lang;
  document.documentElement.lang = state.lang;
  applyStaticLabels();

  try {
    await loadConfig();
    if (window.DepdoitAuth) { await window.DepdoitAuth.ensure(); window.DepdoitAuth.mount(); }
    state.meta = await api('/api/meta');
    const notice = $('notice');
    if (notice) { notice.hidden = Boolean(state.meta.translation.available); notice.textContent = accessText('translationMissing'); }
    await refreshProjects();
  } catch (error) {
    $('view-root').innerHTML = `<div class="empty"><p>${escapeHtml(error.message)}</p><a href="/admin">${escapeHtml(accessText('teamInvites'))}</a> · <button class="btn" onclick="location.reload()">${escapeHtml(accessText('retry'))}</button> · <button class="btn" onclick="window.DepdoitAPI?.signOut();location.reload()">${escapeHtml(accessText('changeAccount'))}</button></div>`;
  }
}

init();
