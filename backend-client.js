/* ============================================================
   backend-client.js — cliente del backend de tareas Departify
   Sin dependencias. Habla con Supabase (Auth + PostgREST) por HTTPS.

   Por qué no se usa el SDK: la app es estática y sin build. Un cliente
   mínimo de fetch mantiene la promesa del proyecto (4 archivos, cero
   dependencias) y no añade 100 KB de bundle para seis llamadas.
   ============================================================ */
(function () {
'use strict';

const CFG = window.DEPDOIT_CONFIG || {};
const URL_BASE = CFG.supabaseUrl || '';
const ANON = CFG.supabaseAnonKey || '';
const STORE = 'depdoit:session';

const enabled = () => Boolean(URL_BASE && ANON);

/* ── Sesión ───────────────────────────────────────────── */

function readSession() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.access_token) return null;
    // Margen de 30 s para no usar un token que caduca a mitad de petición.
    if (s.expires_at && Date.now() > s.expires_at - 30000) return { ...s, expired: true };
    return s;
  } catch (e) { return null; }
}

function writeSession(payload) {
  if (!payload) { localStorage.removeItem(STORE); return null; }
  const session = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: Date.now() + (payload.expires_in || 3600) * 1000,
    user: payload.user || null,
  };
  localStorage.setItem(STORE, JSON.stringify(session));
  return session;
}

/**
 * Tras un login OAuth el payload no trae el usuario: se pide aparte con el
 * token ya guardado. created_by y la sesión lo necesitan.
 */
async function fetchUser() {
  const s = readSession();
  if (!s || !s.access_token) return null;
  const res = await fetch(`${URL_BASE}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${s.access_token}` },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  if (user && user.id) {
    localStorage.setItem(STORE, JSON.stringify({ ...s, user }));
    return user;
  }
  return null;
}

async function authRequest(path, body) {
  const res = await fetch(`${URL_BASE}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || data.message || `Error de acceso (${res.status})`);
  }
  return data;
}

async function signIn(email, password) {
  const data = await authRequest('token?grant_type=password', { email, password });
  return writeSession(data);
}

/**
 * Acceso con Google (OAuth). Es como entran los founders: sus cuentas de
 * Supabase no tienen contraseña, solo identidad de Google.
 */
async function signInWithGoogle(redirectTo) {
  const url = `${URL_BASE}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo || location.href)}`;
  location.href = url;
}

/**
 * Recoge la sesión que Supabase deja en el fragmento de la URL tras volver
 * de Google. Formato: #access_token=...&refresh_token=...&expires_in=...
 */
function consumeOAuthRedirect() {
  const hash = location.hash || '';
  if (!hash.includes('access_token=')) return null;

  const params = new URLSearchParams(hash.slice(1));
  const access = params.get('access_token');
  if (!access) return null;

  const session = writeSession({
    access_token: access,
    refresh_token: params.get('refresh_token'),
    expires_in: Number(params.get('expires_in') || 3600),
  });

  // El token viaja en la URL: se limpia en cuanto se guarda.
  history.replaceState({}, '', location.pathname + location.search);
  return session;
}

async function sendMagicLink(email, redirectTo) {
  return authRequest(`otp?redirect_to=${encodeURIComponent(redirectTo || location.origin + '/')}`, {
    email, create_user: true,
  });
}

async function signUp(email, password) {
  const data = await authRequest('signup', { email, password });
  // Con confirmación desactivada, signup devuelve sesión directamente.
  if (data.access_token) return writeSession(data);
  // Si el proyecto exige confirmar email, no hay sesión todavía.
  throw new Error('Cuenta creada. Confirma el email antes de entrar.');
}

async function refresh() {
  const s = readSession();
  if (!s || !s.refresh_token) return null;
  try {
    const data = await authRequest('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
    return writeSession(data);
  } catch (e) {
    writeSession(null);
    return null;
  }
}

async function token() {
  let s = readSession();
  if (s && s.expired) s = await refresh();
  return s ? s.access_token : null;
}

function signOut() {
  writeSession(null);
}

function currentUser() {
  const s = readSession();
  return s && s.user ? s.user : null;
}

/* ── REST ─────────────────────────────────────────────── */

async function rest(path, init = {}) {
  const t = await token();
  if (!t) throw new Error('Sesión caducada');
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch (e) { body = text; } }
  if (!res.ok) {
    const msg = (body && (body.message || body.hint)) || `Error ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

const rpc = (fn, args) => rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });

/* ── Operaciones de dominio ───────────────────────────── */

// Mi organización: se toma la primera membresía. Departify es una instancia
// privada por empresa, así que en la práctica hay exactamente una.
/**
 * Elección de la empresa activa.
 *
 * Un founder pertenece a VARIAS organizaciones (la suya vieja "Mi empresa" y
 * la de pruebas). Coger `memberships[0]` sin ordenar hacía que la app abriera
 * una empresa vacía al azar, y las invitaciones se crearan en la equivocada.
 *
 * Criterio, en este orden:
 *   1. La que el usuario eligió la última vez (guardada en el navegador).
 *   2. La que tiene tableros de tareas (es donde se trabaja de verdad).
 *   3. La de nombre "Founders" si existe.
 *   4. La primera por nombre, para que sea estable y no aleatoria.
 */
const ORG_KEY = 'depdoit:org';

async function loadContext() {
  const memberships = await rest(
    'organization_memberships?select=organization_id,role,organizations(id,name)'
  );
  if (!memberships || !memberships.length) return null;

  const candidates = memberships.map((m) => ({
    organizationId: m.organization_id,
    role: m.role,
    name: (m.organizations && m.organizations.name) || 'Mi empresa',
  }));

  // Cuántos tableros tiene cada una. RLS ya limita a las que perteneces.
  let boardCount = {};
  try {
    const boards = await rest('task_boards?select=organization_id&archived_at=is.null');
    for (const b of boards || []) {
      boardCount[b.organization_id] = (boardCount[b.organization_id] || 0) + 1;
    }
  } catch (e) {
    boardCount = {};
  }

  let stored = null;
  try { stored = localStorage.getItem(ORG_KEY); } catch (e) {}

  const finalChoice = candidates.find(c => c.organizationId === stored) ||
    candidates.slice().sort((a, b) =>
      (boardCount[b.organizationId] || 0) - (boardCount[a.organizationId] || 0) ||
      Number(/founders/i.test(b.name)) - Number(/founders/i.test(a.name)) ||
      a.name.localeCompare(b.name) || a.organizationId.localeCompare(b.organizationId)
    )[0];

  try { localStorage.setItem(ORG_KEY, finalChoice.organizationId); } catch (e) {}

  const members = await rpc('task_list_members', { p_organization_id: finalChoice.organizationId });

  return {
    organizationId: finalChoice.organizationId,
    organizationName: finalChoice.name,
    role: finalChoice.role,
    members: members || [],
    organizations: candidates,
    boardCounts: boardCount,
  };
}

/** Cambia de empresa activa y recarga. */
function setOrganization(organizationId) {
  try { localStorage.setItem(ORG_KEY, organizationId); } catch (e) {}
  location.reload();
}

// Tablero completo en una llamada. El backend devuelve filas planas
// (una por tarjeta); aquí se rearma la forma que espera la app.
/**
 * Tablero de UNA empresa concreta.
 *
 * Sin el filtro por organization_id se cargaban todos los tableros que el
 * usuario podía ver: con varias empresas, los tableros se mezclaban en el
 * mismo lienzo. La RLS impide ver los de otros, pero no impide que los
 * propios se sumen entre sí.
 */
async function loadBoard(organizationId) {
  const filter = organizationId ? `&organization_id=eq.${organizationId}` : '';
  const rows = await rest(
    `task_board_view?select=*&order=list_position.asc,card_position.asc${filter}`
  );
  if (!rows || !rows.length) return null;

  const boards = {};
  const lists = {};
  const cards = {};
  const boardOrder = [];

  for (const r of rows) {
    if (!boards[r.board_id]) {
      boards[r.board_id] = { id: r.board_id, name: r.board_name, lists: [], createdAt: Date.now() };
      boardOrder.push(r.board_id);
    }
    if (!lists[r.list_id]) {
      lists[r.list_id] = {
        id: r.list_id,
        boardId: r.board_id,
        name: r.list_name,
        cards: [],
        wip: r.wip_limit,
        done: false,
      };
      boards[r.board_id].lists.push(r.list_id);
    }
    if (r.card_id) {
      cards[r.card_id] = {
        id: r.card_id,
        listId: r.list_id,
        name: r.title,
        desc: r.description || '',
        labels: [],
        start: r.start_date,
        end: r.due_date,
        checklists: [],
        assignees: r.assignees || [],
        // Evidencia de QA (migración 005): qué es, cuánto duele, qué se
        // esperaba y qué pasó. Sin esto un reporte no es reproducible.
        kind: r.kind || 'task',
        severity: r.severity || null,
        expected: r.expected || '',
        actual: r.actual || '',
        verifiedBy: r.verified_by || null,
        verifiedAt: r.verified_at || null,
        createdAt: Date.now(),
        done: Boolean(r.completed_at),
      };
      lists[r.list_id].cards.push(r.card_id);
    }
  }

  // Una lista "Hecho" se marca por nombre; es lo que usa la app para el flujo
  // de autocompletado de checklist.
  for (const l of Object.values(lists)) {
    if (/^(hecho|done|terminado|finalizat)$/i.test(l.name.trim())) l.done = true;
  }

  return { boards, lists, cards, boardOrder };
}

async function createBoard(organizationId, name, id) {
  const rows = await rest('task_boards', {
    method: 'POST',
    body: JSON.stringify({
      ...(id ? { id } : {}),
      organization_id: organizationId,
      name,
      created_by: (currentUser() || {}).id,
    }),
  });
  return rows && rows[0];
}

async function createList(boardId, name, position, wipLimit, id) {
  const rows = await rest('task_lists', {
    method: 'POST',
    body: JSON.stringify({
      ...(id ? { id } : {}),
      board_id: boardId,
      name,
      position,
      wip_limit: wipLimit ?? null,
    }),
  });
  return rows && rows[0];
}

async function createCard(listId, payload) {
  const rows = await rest('task_cards', {
    method: 'POST',
    body: JSON.stringify({
      // El id viene del cliente para que id local === id servidor.
      ...(payload.id ? { id: payload.id } : {}),
      list_id: listId,
      title: payload.title || 'Sin título',
      description: payload.description || '',
      position: payload.position ?? 0,
      start_date: payload.start || null,
      due_date: payload.end || null,
      kind: payload.kind || 'task',
      severity: payload.severity || null,
      expected: payload.expected || '',
      actual: payload.actual || '',
      created_by: (currentUser() || {}).id,
    }),
  });
  return rows && rows[0];
}

async function updateCard(id, patch) {
  const body = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.start !== undefined) body.start_date = patch.start;
  if (patch.end !== undefined) body.due_date = patch.end;
  if (patch.completed !== undefined) body.completed_at = patch.completed ? new Date().toISOString() : null;
  if (patch.position !== undefined) body.position = patch.position;
  if (patch.kind !== undefined) body.kind = patch.kind;
  if (patch.severity !== undefined) body.severity = patch.severity;
  if (patch.expected !== undefined) body.expected = patch.expected;
  if (patch.actual !== undefined) body.actual = patch.actual;
  if (Object.keys(body).length === 0) return null;
  const rows = await rest(`task_cards?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  return rows && rows[0];
}

async function moveCard(id, targetListId, position) {
  return rpc('task_move_card', {
    p_card_id: id,
    p_target_list_id: targetListId,
    p_position: position ?? 0,
  });
}

/** Marca una tarjeta como verificada (cierra la evidencia de QA). */
async function verifyCard(id) {
  return rpc('task_verify_card', { p_card_id: id });
}

async function archiveCard(id) {
  return rest(`task_cards?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ archived_at: new Date().toISOString() }),
  });
}

async function assign(cardId, userId) {
  return rpc('task_assign_card', { p_card_id: cardId, p_user_id: userId });
}

async function unassign(cardId, userId) {
  return rpc('task_unassign_card', { p_card_id: cardId, p_user_id: userId });
}

async function cardAssignees(cardId) {
  return rest('task_card_assignees?select=user_id,assigned_at&card_id=eq.' + cardId);
}

/**
 * ¿Está el backend listo (tablas migradas)?
 * Devuelve false si el esquema no existe, para que la app caiga a modo local
 * en vez de mostrar un login que no puede funcionar.
 */
async function health() {
  if (!enabled()) return false;
  try {
    const res = await fetch(`${URL_BASE}/rest/v1/task_boards?select=id&limit=1`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    if (res.status === 404) return false;
    const text = await res.text();
    // PGRST205 = tabla inexistente en el schema cache.
    if (text.includes('PGRST205') || text.includes('does not exist')) return false;
    return res.ok;
  } catch (e) {
    return false;
  }
}

window.DepdoitAPI = {
  enabled, health,
  signIn, signUp, signInWithGoogle, consumeOAuthRedirect, signOut, refresh,
  currentUser, readSession, fetchUser, token, sendMagicLink,
  loadContext, loadBoard, setOrganization,
  createBoard, createList, createCard, updateCard, moveCard, archiveCard, verifyCard,
  assign, unassign, cardAssignees,
  rest, rpc,
};
})();
