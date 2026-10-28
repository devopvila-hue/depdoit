/* ============================================================
   Minimal Board — lógica de aplicación
   Sin dependencias, sin build, sin framework.
   i18n en inglés, rumano y español (ver i18n.js).
   ============================================================ */
(function () {
'use strict';

const { t, labelName, locale, getLang, setLang } = window.I18N;

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const uid = () => {
  // UUID v4. Los ids se generan en el cliente para que el id local sea
  // exactamente el id del servidor: sin tabla de traducción que desincronizar.
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  const b = new Uint8Array(16);
  (window.crypto || {}).getRandomValues
    ? window.crypto.getRandomValues(b)
    : b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); });
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const clone = (o) => JSON.parse(JSON.stringify(o));

const debounce = (fn, ms) => {
  let tmr;
  return function (...a) { clearTimeout(tmr); tmr = setTimeout(() => fn.apply(this, a), ms); };
};

const isTypingTarget = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
         el.tagName === 'SELECT' || el.isContentEditable);

/* ═══════════════ 1. Fechas ═══════════════ */

const MS_DAY = 86400000;
const iso = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const todayISO = () => iso(new Date());
const parseISO = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const daysUntil = (s) =>
  Math.round((parseISO(s).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / MS_DAY);

/* Palabras clave en los tres idiomas: el parser acepta cualquiera de ellas
   sea cual sea el idioma de la interfaz. */
const KW = {
  today:  ['hoy', 'today', 'azi'],
  tomorrow: ['mañana', 'manana', 'tomorrow', 'mâine', 'maine'],
  yesterday: ['ayer', 'yesterday', 'ieri'],
  day: ['d', 'día', 'dia', 'dias', 'días', 'day', 'days', 'zi', 'zile'],
  week: ['sem', 'semana', 'semanas', 'week', 'weeks',
         'săptămână', 'săptămâni', 'saptamana', 'saptamani'],
  weekdays: [
    'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado',
    'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
    'duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă',
  ],
  NUM: { hoy: 0, today: 0, azi: 0, mañana: 1, manana: 1, tomorrow: 1, 'mâine': 1, maine: 1,
         ayer: -1, yesterday: -1, ieri: -1, pasado: -1 },
};

const norm = (s) => String(s).toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Texto natural (es/en/ro) → fecha ISO. Devuelve null si no lo entiende. */
function parseNaturalDate(raw) {
  const txt = String(raw).trim().toLowerCase();
  if (!txt) return null;
  const nrm = norm(txt);
  const d = new Date();
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const add = (x) => { base.setDate(base.getDate() + x); return iso(base); };

  if (KW.NUM[nrm] !== undefined) return add(KW.NUM[nrm]);

  let m = txt.match(/^(?:(?:in|în|en)\s+)?(\d+)\s*(.+)$/);
  if (m) {
    const unit = norm(m[2]);
    if (KW.week.some((w) => norm(w) === unit)) return add(parseInt(m[1], 10) * 7);
    if (KW.day.some((w) => norm(w) === unit)) return add(parseInt(m[1], 10));
  }

  const wd = KW.weekdays.findIndex((x) => norm(x) === nrm);
  if (wd >= 0) {
    let delta = (wd - base.getDay() + 7) % 7;
    if (delta === 0) delta = 7;              // el día actual significa el próximo
    return add(delta);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) return txt;
  m = txt.match(/^(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{2,4}))?$/);
  if (m) {
    const day = +m[1], mon = +m[2];
    let year = m[3] ? +m[3] : base.getFullYear();
    if (year < 100) year += 2000;
    const out = new Date(year, mon - 1, day);
    if (out.getDate() === day && out.getMonth() === mon - 1) return iso(out);
  }
  return null;
}

function dateMeta(dateStr) {
  const n = daysUntil(dateStr);
  if (n === null || Number.isNaN(n)) return { cls: '', text: '' };
  if (n < 0) return { cls: 'is-overdue', text: t('due.overdue', { 0: Math.abs(n) }) };
  if (n === 0) return { cls: 'is-today', text: t('due.today') };
  if (n === 1) return { cls: '', text: t('due.tomorrow') };
  if (n <= 7) return { cls: '', text: t('due.inDays', { 0: n }) };
  return { cls: '', text: fmtShort(dateStr) };
}

/** Solo la primera letra en mayúscula: "octubre de 2026" → "Octubre de 2026". */
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** 24 oct / 24 Dec / 24 dec — formato corto del idioma activo. */
const fmtShort = (d) =>
  new Date(parseISO(d)).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

/** Rango inicio→fin para la tarjeta. Cae a una sola fecha si falta un extremo. */
function rangeText(c) {
  const s = c.start, e = c.end;
  if (s && e) {
    const overdue = daysUntil(e) < 0 && !c.done;
    return { cls: overdue ? 'is-overdue' : '', text: `${fmtShort(s)} – ${fmtShort(e)}` };
  }
  if (e) return dateMeta(e);
  if (s) return dateMeta(s);
  return null;
}

/* ═══════════════ 2. Etiquetas ═══════════════ */

const LABELS = [
  { id: 'bug',     bg: '#fee2e2', fg: '#991b1b' },
  { id: 'feature', bg: '#dbeafe', fg: '#1e40af' },
  { id: 'mejora',  bg: '#dcfce7', fg: '#166534' },
  { id: 'doc',     bg: '#f3e8ff', fg: '#6b21a8' },
  { id: 'deuda',   bg: '#fef3c7', fg: '#92400e' },
  { id: 'urgente', bg: '#ffe4e6', fg: '#9f1239' },
];
const labelById = (id) => LABELS.find((l) => l.id === id);

/* ═══════════════ 3. Estado ═══════════════ */

const STORAGE_KEY = 'minimal-board:v1';

let S = null;
let undoStack = [];
let redoStack = [];
let view = {
  boardId: null,
  selectedId: null,
  query: '',
  labelFilter: null,
  quick: new Set(),
  drafts: {},
  composing: null,
  editingTitle: null,
  editingCheck: null,
  menu: null,
};

function blankStore() {
  return { boards: {}, lists: {}, cards: {}, boardOrder: [], ui: {}, __demo: false };
}

function newList(boardId, name, opts = {}) {
  const id = uid();
  S.lists[id] = {
    id, boardId, name: name || t('list.addList'),
    cards: [], wip: opts.wip ?? null, done: !!opts.done,
  };
  S.boards[boardId].lists.push(id);
  return id;
}

function newCard(listId, name) {
  const id = uid();
  S.cards[id] = {
    id, listId,
    name: name || '',
    desc: '',
    labels: [],
    start: null,
    end: null,
    checklists: [],
    createdAt: Date.now(),
    done: false,
  };
  S.lists[listId].cards.push(id);
  return id;
}

function seed() {
  S = blankStore();
  const b = uid();
  S.boards[b] = { id: b, name: t('seed.board'), lists: [], createdAt: Date.now() };
  S.boardOrder.push(b);

  const ideas  = newList(b, t('seed.list.ideas'));
  const doing  = newList(b, t('seed.list.doing'), { wip: 3 });
  const review = newList(b, t('seed.list.review'), { wip: 2 });
  const done   = newList(b, t('seed.list.done'), { done: true });

  newCard(ideas, t('seed.c1'));
  newCard(ideas, t('seed.c2'));
  newCard(ideas, t('seed.c3'));

  const c1 = newCard(doing, t('seed.c4'));
  S.cards[c1].labels = ['feature'];
  S.cards[c1].start = parseNaturalDate('today');
  S.cards[c1].end = parseNaturalDate('in 3 days');
  S.cards[c1].checklists = [{
    id: uid(), name: t('seed.checklist'),
    items: [
      { id: uid(), name: t('seed.item.wireframes'), done: true },
      { id: uid(), name: t('seed.item.copy'), done: true },
      { id: uid(), name: t('seed.item.impl'), done: false },
    ],
  }];

  const c2 = newCard(doing, t('seed.c5'));
  S.cards[c2].labels = ['bug', 'urgente'];
  S.cards[c2].end = parseNaturalDate('today');

  newCard(doing, t('seed.c6'));

  const c3 = newCard(review, t('seed.c7'));
  S.cards[c3].labels = ['mejora'];
  S.cards[c3].start = parseNaturalDate('in 5 days');
  S.cards[c3].end = parseNaturalDate('in 9 days');

  const c4 = newCard(done, t('seed.c8'));
  S.cards[c4].done = true;
  const c5 = newCard(done, t('seed.c9'));
  S.cards[c5].done = true;
  S.cards[c5].labels = ['doc'];

  view.boardId = b;
  S.__demo = true;      // mientras siga así, la demo se regenera al cambiar de idioma
}

/* ═══════════════ 4. Persistencia ═══════════════ */

const save = debounce(() => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v: 1,
      boards: S.boards, lists: S.lists, cards: S.cards,
      boardOrder: S.boardOrder,
      currentBoard: view.boardId,
      demo: !!S.__demo,
      lang: getLang(),
    }));
  } catch (e) {
    toast(t('toast.saveFail'));
  }
}, 250);

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw);
    if (!p || !p.boards || !Array.isArray(p.boardOrder) || !p.boardOrder.length) return false;
    S = { boards: p.boards, lists: p.lists, cards: p.cards, boardOrder: p.boardOrder, ui: {}, __demo: !!p.demo };
    // Migración: las tarjetas guardadas con un único "due" pasan a fecha de fin.
    let touched = false;
    for (const c of Object.values(S.cards)) {
      if (c.due && !c.end) { c.end = c.due; touched = true; }
      if (c.due) delete c.due;
      if (!('start' in c)) c.start = null;
      if (!('end' in c)) c.end = null;
    }
    view.boardId = S.boards[p.currentBoard] ? p.currentBoard : S.boardOrder[0];
    if (touched) save();
    return true;
  } catch (e) {
    return false;
  }
}

/* ═══════════════ 5. Deshacer / rehacer ═══════════════ */

const HISTORY_CAP = 80;

const snapshot = () => JSON.stringify({
  boards: S.boards, lists: S.lists, cards: S.cards, boardOrder: S.boardOrder, demo: !!S.__demo,
});

function mutate(fn) {
  const before = snapshot();
  if (fn() === false) return false;
  S.__demo = false;          // cualquier acción del usuario invalida la demo
  undoStack.push(before);
  if (undoStack.length > HISTORY_CAP) undoStack.shift();
  redoStack.length = 0;
  save();
  render();
  // Un solo punto de enganche con el backend: se compara el antes y el
  // después. Así ningún camino nuevo puede olvidarse de persistir.
  if (window.DepdoitSync) {
    try { window.DepdoitSync.onDiff(JSON.parse(before), JSON.parse(snapshot())); }
    catch (e) { console.warn('[sync] diff falló:', e.message); }
  }
  return true;
}

function undo() {
  if (!undoStack.length) return toast(t('toast.noUndo'));
  redoStack.push(snapshot());
  const prev = JSON.parse(undoStack.pop());
  S.boards = prev.boards; S.lists = prev.lists; S.cards = prev.cards; S.boardOrder = prev.boardOrder;
  S.__demo = !!prev.demo;
  if (!S.boards[view.boardId]) view.boardId = S.boardOrder[0] || null;
  view.selectedId = null; view.composing = null;
  save(); render(); toast(t('toast.undone'));
}

function redo() {
  if (!redoStack.length) return toast(t('toast.noRedo'));
  undoStack.push(snapshot());
  const next = JSON.parse(redoStack.pop());
  S.boards = next.boards; S.lists = next.lists; S.cards = next.cards; S.boardOrder = next.boardOrder;
  S.__demo = !!next.demo;
  if (!S.boards[view.boardId]) view.boardId = S.boardOrder[0] || null;
  save(); render(); toast(t('toast.redone'));
}

/* ═══════════════ 6. Selectores ═══════════════ */

const board   = () => S.boards[view.boardId] || null;
const lists   = () => { const b = board(); return b ? b.lists.map((id) => S.lists[id]).filter(Boolean) : []; };
const cardsOf = (listId) => S.lists[listId].cards.map((id) => S.cards[id]).filter(Boolean);
const card    = (id) => S.cards[id] || null;

function allBoardCards() {
  const out = [];
  for (const l of lists()) for (const c of cardsOf(l.id)) out.push(c);
  return out;
}

function checklistStats(c) {
  let total = 0, done = 0;
  for (const cl of c.checklists || []) {
    total += cl.items.length;
    done += cl.items.filter((i) => i.done).length;
  }
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}

/* Reconoce «Hecho» en los tres idiomas. */
const DONE_RE = /^(hecho|done|completado|completada|terminado|terminada|listo|lista|gata|finalizat|finalizată|terminat|terminată|incheiat|încheiat)s?$/i;
const isDoneList = (l) => l.done || DONE_RE.test(l.name.trim());

function matchesQuery(c, q) {
  if (!q) return true;
  const hay = `${c.name} ${c.desc} ${(c.labels || []).map((id) => labelName(id)).join(' ')}`;
  return q.toLowerCase().split(/\s+/).filter(Boolean)
    .every((term) => hay.toLowerCase().includes(term));
}

function cardVisible(c) {
  if (!matchesQuery(c, view.query)) return false;
  if (view.labelFilter && !(c.labels || []).includes(view.labelFilter)) return false;
  const today = todayISO();
  for (const f of view.quick) {
    if (f === 'overdue' && !(c.end && daysUntil(c.end) < 0 && !c.done)) return false;
    if (f === 'today' && c.start !== today && c.end !== today) return false;
    if (f === 'nodue' && (c.start || c.end || (c.checklists || []).length)) return false;
    if (f === 'checked' && !(c.checklists || []).length) return false;
  }
  return true;
}

const filtersActive = () => !!view.query || !!view.labelFilter || view.quick.size > 0;

/* ═══════════════ 7. Toasts ═══════════════ */

function toast(msg, actionLabel, action) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.append(document.createTextNode(msg));
  if (actionLabel && action) {
    const b = document.createElement('button');
    b.textContent = actionLabel;
    b.onclick = () => { el.remove(); action(); };
    el.append(b);
  }
  $('#toasts').append(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s, transform .2s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 220);
  }, actionLabel ? 6000 : 2600);
}

/* ═══════════════ 8. Mutaciones ═══════════════ */

function removeCard(id) {
  const c = card(id);
  if (!c) return false;
  const list = S.lists[c.listId];
  const i = list.cards.indexOf(id);
  if (i >= 0) list.cards.splice(i, 1);
  delete S.cards[id];
  if (view.selectedId === id) view.selectedId = null;
  return true;
}

function moveCard(id, toListId, toIndex) {
  const c = card(id);
  if (!c || !S.lists[toListId]) return false;
  const from = S.lists[c.listId];
  const fromIdx = from.cards.indexOf(id);
  if (fromIdx >= 0) from.cards.splice(fromIdx, 1);
  c.listId = toListId;
  const target = S.lists[toListId].cards;
  let idx = toIndex;
  if (idx === undefined || idx === null || idx > target.length) idx = target.length;
  target.splice(idx, 0, id);
  c.done = isDoneList(S.lists[toListId]) ? true : false;
  return true;
}

function allCardsInOrder() {
  const out = [];
  for (const l of lists()) out.push(...cardsOf(l.id).filter(cardVisible));
  return out;
}

function createBoard(name) {
  const id = uid();
  const label = name || t('toast.newBoard');
  mutate(() => {
    S.boards[id] = { id, name: label, lists: [], createdAt: Date.now() };
    S.boardOrder.push(id);
    newList(id, t('seed.list.ideas'));
    newList(id, t('seed.list.doing'), { wip: 3 });
    newList(id, t('seed.list.done'), { done: true });
    view.boardId = id;
    view.selectedId = null;
    view.composing = null;
  });
  toast(t('toast.boardCreated', { 0: label }));
}

function deleteBoard(id) {
  const b = S.boards[id];
  if (!b) return;
  if (S.boardOrder.length === 1) return toast(t('toast.lastBoard'));
  mutate(() => {
    for (const lid of b.lists) {
      for (const cid of (S.lists[lid]?.cards || [])) delete S.cards[cid];
      delete S.lists[lid];
    }
    delete S.boards[id];
    S.boardOrder = S.boardOrder.filter((x) => x !== id);
    if (view.boardId === id) { view.boardId = S.boardOrder[0]; view.selectedId = null; }
  });
  toast(t('toast.boardDeleted', { 0: b.name }), t('toast.undo'), undo);
}

function completeCard(id) {
  const c = card(id);
  if (!c) return;
  const target = lists().find(isDoneList);
  if (!target) return toast(t('toast.noDoneList'));
  if (c.listId === target.id) return;
  mutate(() => moveCard(id, target.id));
  toast(t('toast.moved', { 0: truncate(c.name, 28), 1: target.name }), t('toast.undo'), undo);
}

function deleteCard(id) {
  const c = card(id);
  if (!c) return;
  const title = c.name;
  mutate(() => removeCard(id));
  toast(t('toast.deleted', { 0: truncate(title, 30) }), t('toast.undo'), undo);
}

function truncate(s, n) {
  const x = String(s || '').trim() || t('card.untitled');
  return x.length > n ? x.slice(0, n - 1) + '…' : x;
}

function maybeAutoComplete(id) {
  const c = card(id);
  if (!c) return;
  const st = checklistStats(c);
  if (!st.total || st.pct < 100 || c.done) return;
  const target = lists().find((l) => isDoneList(l) && l.id !== c.listId);
  if (!target) return;
  toast(t('toast.checklistDone'), t('toast.moveTo', { 0: target.name }), () => {
    mutate(() => moveCard(id, target.id));
  });
}

/* ═══════════════ 9. Render ═══════════════ */

function render() {
  renderTopbar();
  renderFilters();
  renderBoard();
  renderPanel();
  renderHelp();
}

function renderTopbar() {
  const b = board();
  $('#boardName').textContent = b ? b.name : '—';
  $('#searchClear').hidden = !view.query;
  const ls = $('#langSelect');
  if (ls && ls.value !== getLang()) ls.value = getLang();

  // Empresa activa: si el usuario pertenece a varias, debe poder verlo y
  // cambiarlo. Un founder con "Mi empresa" y "Founders" necesita saber en
  // cuál está trabajando.
  const sync = window.DepdoitSync;
  const ctx = sync && sync.context ? sync.context() : null;
  const orgs = (ctx && ctx.organizations) || [];
  let sel = $('#orgSwitchBoard');

  if (orgs.length > 1) {
    if (!sel) {
      sel = document.createElement('select');
      sel.id = 'orgSwitchBoard';
      sel.className = 'org-switch';
      sel.title = 'Empresa activa';
      sel.setAttribute('aria-label', 'Empresa activa');
      const topbar = $('.topbar');
      const brand = $('.brand', topbar);
      if (brand && brand.nextSibling) topbar.insertBefore(sel, brand.nextSibling);
    }
    sel.innerHTML = orgs.map((o) =>
      `<option value="${o.organizationId}" ${o.organizationId === ctx.organizationId ? 'selected' : ''}>${esc(o.name)}</option>`
    ).join('');
    sel.hidden = false;
    if (!sel.dataset.bound) {
      sel.addEventListener('change', () => {
        if (window.DepdoitAPI && window.DepdoitAPI.setOrganization) {
          window.DepdoitAPI.setOrganization(sel.value);
        }
      });
      sel.dataset.bound = '1';
    }
  } else if (sel) {
    sel.hidden = true;
  }
}

/* ── Filtros ─────────────────────────────────────── */

const QUICK = ['overdue', 'today', 'checked', 'nodue'];

function renderFilters() {
  const used = new Set();
  for (const c of allBoardCards()) for (const l of c.labels || []) used.add(l);

  $('#labelFilters').innerHTML = LABELS
    .filter((l) => used.has(l.id))
    .map((l) => `<button class="chip ${view.labelFilter === l.id ? 'is-on' : ''}" data-label="${l.id}">
        <span class="chip-dot" style="background:${l.bg};box-shadow:inset 0 0 0 1px ${l.fg}"></span>${esc(labelName(l.id))}
      </button>`).join('');

  $('#quickFilters').innerHTML = QUICK
    .map((q) => `<button class="chip ${view.quick.has(q) ? 'is-on' : ''}" data-quick="${q}">${esc(t('filter.' + q))}</button>`)
    .join('');

  const total = allBoardCards().length;
  const shown = allBoardCards().filter(cardVisible).length;
  const fc = $('#filterCount');
  if (filtersActive()) {
    // Se escapa primero y después se resalta la cifra, así el texto traducido
    // nunca pasa por el HTML sin escapar.
    const txt = esc(t('filter.countOf', { 0: shown, 1: total }));
    fc.innerHTML = txt.replace(String(shown), `<b>${shown}</b>`) +
      ` · <button class="chip" id="clearFilters" style="margin-left:4px">${esc(t('filter.clear'))}</button>`;
  } else {
    fc.textContent = t('filter.count', { 0: total });
  }
}

/* ── Tablero ─────────────────────────────────────── */

function renderBoard() {
  const host = $('#board');
  const b = board();
  if (!b) { host.innerHTML = ''; return; }

  const visible = allBoardCards().filter(cardVisible).length;

  let html = lists().map((l) => renderList(l)).join('');

  html += `<div class="add-list">
      <button class="add-list-btn" id="addListBtn">＋ ${esc(t('list.addList'))}</button>
      <input class="add-list-input" id="addListInput" placeholder="${esc(t('list.name'))}"
             style="display:none" maxlength="60">
    </div>`;

  if (!visible && filtersActive()) {
    html += `<div class="board-empty"><div class="board-empty-inner">
        <h3>${esc(t('card.noMatchTitle'))}</h3>
        <p>${esc(t('card.noMatchBody'))}</p>
        <button class="btn" id="clearFilters2" style="margin-top:12px">${esc(t('card.clearFilters'))}</button>
      </div></div>`;
  }

  host.innerHTML = html;
  restoreFocus();
}

function renderList(l) {
  const cards = cardsOf(l.id);
  const shown = cards.filter(cardVisible);
  const overWip = l.wip != null && cards.length > l.wip;

  const body = shown.length
    ? shown.map(renderCard).join('')
    : `<div class="empty-list">${cards.length ? esc(t('list.noMatch')) : esc(t('list.empty'))}</div>`;

  return `<section class="list ${overWip ? 'is-over-wip' : ''}" data-list="${l.id}" role="listitem">
      <header class="list-head">
        <span class="list-title">${esc(l.name)}</span>
        <span class="list-count" title="${esc(overWip ? t('list.overWip', { 0: l.wip }) : t('list.cards'))}">${cards.length}${l.wip ? `/${l.wip}` : ''}</span>
        <button class="list-menu-btn" data-list-menu="${l.id}" aria-label="${esc(t('list.options'))}">⋯</button>
      </header>
      <div class="list-body" data-list-body="${l.id}">
        ${body}
        ${view.composing === l.id ? renderComposer() : ''}
      </div>
      <div class="list-foot">
        ${view.composing === l.id ? '' : `<button class="add-card-btn" data-add-card="${l.id}">＋ ${esc(t('list.addCard'))}</button>`}
      </div>
    </section>`;
}

function renderComposer() {
  return `<div class="composer">
      <textarea class="composer-input" id="composerInput" rows="1" placeholder="${esc(t('composer.ph'))}"
        >${esc(view.drafts.__new || '')}</textarea>
      <div class="composer-hint">
        <span><kbd>Enter</kbd> ${esc(t('composer.create'))}</span>
        <span><kbd>Shift</kbd>+<kbd>Enter</kbd> ${esc(t('composer.line'))}</span>
        <span><kbd>Esc</kbd> ${esc(t('composer.cancel'))}</span>
      </div>
    </div>`;
}

function renderCard(c) {
  const st = checklistStats(c);
  const labels = (c.labels || []).map(labelById).filter(Boolean);
  const rng = rangeText(c);

  return `<article class="card ${view.selectedId === c.id ? 'is-selected' : ''} ${c.done ? 'is-done' : ''}"
      data-card="${c.id}" role="listitem" tabindex="-1">
      ${labels.length ? `<div class="card-labels">${labels.map((l) =>
        `<span class="label-pill" style="background:${l.bg};color:${l.fg}">${esc(labelName(l.id))}</span>`).join('')}</div>` : ''}
      ${view.editingTitle === c.id
        ? `<input class="inline-input" id="titleEdit" value="${esc(c.name)}" maxlength="200">`
        : `<div class="card-title">${esc(c.name || t('card.untitled'))}</div>`}
      ${c.desc ? `<div class="card-desc">${esc(c.desc)}</div>` : ''}
      ${(c.kind === 'bug' || c.kind === 'improvement' || c.severity) ? `<div class="card-kind-row">
        ${c.kind === 'bug' || c.kind === 'improvement'
          ? `<span class="card-kind kind-${c.kind}">${esc(t('panel.kind.' + c.kind))}</span>` : ''}
        ${c.severity ? `<span class="card-sev sev-${c.severity}">${esc(t('panel.severity.' + c.severity))}</span>` : ''}
      </div>` : ''}
      <div class="card-meta">
        ${rng ? `<span class="badge badge-due ${rng.cls}">📅 ${esc(rng.text)}</span>` : ''}
        ${st.total ? `<span class="badge badge-check ${st.pct === 100 ? 'is-complete' : ''}">☑ ${st.done}/${st.total}</span>` : ''}
        ${c.desc ? `<span class="badge badge-desc">≡ ${c.desc.length}</span>` : ''}
      </div>
      ${st.total && st.pct < 100 ? `<div class="card-checkbar"><div class="card-checkbar-fill" style="width:${st.pct}%"></div></div>` : ''}
    </article>`;
}

/* ── Panel ───────────────────────────────────────── */

function renderPanel() {
  const panel = $('#panel');
  const c = view.selectedId ? card(view.selectedId) : null;
  document.body.classList.toggle('panel-open', !!c);

  if (!c) {
    closeCalendar();
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('panel-open');
    $('#panelBody').innerHTML = '';
    $('#panelFoot').innerHTML = '';
    return;
  }

  panel.classList.add('is-open');
  panel.setAttribute('aria-hidden', 'false');

  const list = S.lists[c.listId];
  $('#panelBreadcrumb').textContent = `${board()?.name || ''} · ${list ? list.name : ''}`;

  const st = checklistStats(c);

  $('#panelBody').innerHTML = `
    <h2 class="panel-title" id="panelTitle">${esc(c.name || t('card.untitled'))}</h2>

    <div class="field">
      <label class="field-label" for="descEditor">${esc(t('panel.description'))}</label>
      <textarea class="desc-editor" id="descEditor"
        placeholder="${esc(t('panel.descPh'))}">${esc(c.desc)}</textarea>
    </div>

    <div class="field">
      <label class="field-label" for="listSelect">${esc(t('panel.list'))}</label>
      <div class="select-row">
        <select class="input select" id="listSelect">
          ${lists().map((l) => `<option value="${l.id}" ${l.id === c.listId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
        </select>
      </div>
    </div>

    ${assigneeField(c)}

    ${dateField(c, 'start')}
    ${dateField(c, 'end')}

    <div class="field">
      <span class="field-label">${esc(t('panel.labels'))}</span>
      <div class="label-grid">
        ${LABELS.map((l) => `<button class="label-toggle ${(c.labels || []).includes(l.id) ? 'is-on' : ''}"
            data-label-toggle="${l.id}" style="background:${l.bg};color:${l.fg}">${esc(labelName(l.id))}</button>`).join('')}
      </div>
    </div>

    ${evidenceField(c)}

    <div class="field">
      <span class="field-label">${esc(t('panel.checklists'))}${st.total ? ` · ${st.done}/${st.total}` : ''}</span>
      ${(c.checklists || []).map((cl) => renderChecklist(cl)).join('')}
      <input class="input" id="addChecklistInput" placeholder="${esc(t('panel.addChecklist'))}" autocomplete="off">
      ${c.checklists.length ? `<button class="btn btn-ghost" id="delChecklist" style="margin-top:8px">${esc(t('panel.delChecklist'))}</button>` : ''}
    </div>`;

  $('#panelFoot').innerHTML = `
    <button class="btn btn-primary" id="markDone">${c.done ? '↩ ' + esc(t('panel.reopen')) : '✓ ' + esc(t('panel.complete'))}</button>
    <button class="btn" id="dupCard">${esc(t('panel.duplicate'))}</button>
    <button class="btn btn-danger" id="delCard">${esc(t('panel.delete'))}</button>`;

  restoreFocus();
}

/**
 * Bloque de evidencia de QA. Solo se pinta cuando la tarjeta es un fallo o
 * una mejora: en una tarea normal estos campos son ruido.
 */
function evidenceField(c) {
  const kind = c.kind || 'task';
  const isReport = kind === 'bug' || kind === 'improvement';

  const kindBtn = (k) => `<button class="seg-btn ${kind === k ? 'is-on' : ''}" data-kind="${k}">${esc(t('panel.kind.' + k))}</button>`;
  const sevBtn = (sv) => `<button class="sev-btn sev-${sv} ${c.severity === sv ? 'is-on' : ''}" data-severity="${sv}">${esc(t('panel.severity.' + sv))}</button>`;

  return `<div class="field">
      <span class="field-label">${esc(t('panel.kind'))}</span>
      <div class="seg-row">${['task', 'bug', 'improvement'].map(kindBtn).join('')}</div>
      ${isReport ? `
        <span class="field-label field-label-sub">${esc(t('panel.severity'))}</span>
        <div class="sev-row">${['low', 'medium', 'high', 'blocker'].map(sevBtn).join('')}</div>

        <label class="field-label field-label-sub" for="expectedInput">${esc(t('panel.expected'))}</label>
        <textarea class="desc-editor evidence-input" id="expectedInput"
          placeholder="${esc(t('panel.expected.ph'))}">${esc(c.expected || '')}</textarea>

        <label class="field-label field-label-sub" for="actualInput">${esc(t('panel.actual'))}</label>
        <textarea class="desc-editor evidence-input" id="actualInput"
          placeholder="${esc(t('panel.actual.ph'))}">${esc(c.actual || '')}</textarea>

        <div class="evidence-verify">
          ${c.verifiedAt
            ? `<span class="verified-badge">✓ ${esc(t('panel.verified'))}</span>`
            : `<button class="btn btn-sm" id="verifyCard">${esc(t('panel.verify'))}</button>`}
        </div>
      ` : ''}
    </div>`;
}

function assigneeField(c) {
  const sync = window.DepdoitSync;
  const members = sync && sync.members ? sync.members() : [];
  // Sin backend no hay a quién asignar: no se pinta un campo muerto.
  if (!members.length) return '';

  const assigned = (c.assignees || []).map((a) => a.user_id);
  return `<div class="field">
      <span class="field-label">${esc(t('panel.assignees'))}${assigned.length ? ` · ${assigned.length}` : ''}</span>
      <div class="assignee-list">
        ${members.map((m) => {
          const on = assigned.includes(m.user_id);
          const initial = (m.email || '?').trim().charAt(0).toUpperCase();
          return `<button class="assignee-chip ${on ? 'is-on' : ''}" data-assign="${m.user_id}"
            title="${esc(m.email)}" aria-pressed="${on}">
            <span class="assignee-avatar">${esc(initial)}</span>
            <span class="assignee-mail">${esc(m.email.split('@')[0])}</span>
          </button>`;
        }).join('')}
      </div>
    </div>`;
}

function renderChecklist(cl) {
  return `<div class="checklist">
      <div class="checklist-head">
        <span>${esc(cl.name)}</span>
        <span class="pct">${cl.items.filter((i) => i.done).length}/${cl.items.length}</span>
      </div>
      ${cl.items.map((i) => `
        <div class="check-item ${i.done ? 'is-done' : ''}" data-item="${i.id}">
          <button class="check-box ${i.done ? 'is-done' : ''}" data-toggle-item="${i.id}"
                  role="checkbox" aria-checked="${i.done}">✓</button>
          ${view.editingCheck === i.id
            ? `<input class="inline-input" data-check-edit="${i.id}" value="${esc(i.name)}">`
            : `<span class="check-text" data-edit-item="${i.id}">${esc(i.name)}</span>`}
          <button class="check-del" data-del-item="${i.id}" aria-label="${esc(t('panel.itemDelete'))}">✕</button>
        </div>`).join('')}
      <input class="input" data-add-item="${cl.id}" placeholder="${esc(t('panel.addItem'))}" autocomplete="off"
             style="margin-top:4px;font-size:12.5px;padding:5px 8px">
    </div>`;
}

/* ── Campo de fecha con botón de calendario ──────── */

function dateField(c, which) {
  const v = c[which];
  const meta = v ? dateMeta(v) : null;
  const label = which === 'start' ? t('panel.start') : t('panel.end');
  return `<div class="field">
      <span class="field-label">${esc(label)}</span>
      <div class="date-row">
        <input class="input" id="${which}Input" type="text" autocomplete="off"
               placeholder="${esc(t('panel.datePh'))}"
               value="${v ? `${v}  ·  ${meta.text}` : ''}">
        <button class="cal-btn" data-cal-for="${which}"
                aria-label="${esc(t('panel.pickDate'))}" title="${esc(t('panel.pickDate'))}">📅</button>
      </div>
      ${v ? `<div style="margin-top:6px"><button class="btn btn-ghost btn-danger" data-clear-date="${which}">${esc(t('panel.clearDate'))}</button></div>` : ''}
    </div>`;
}

/* ═══════════════ 9b. Calendario emergente ═══════════════ */

const cal = { open: false, target: null, y: 0, m: 0 };

/** Fija una fecha de la tarjeta manteniendo el orden inicio ≤ fin. */
function setCardDate(c, which, value) {
  if (!c) return false;
  if (which === 'start') {
    c.start = value;
    if (value && c.end && value > c.end) c.end = value;   // no permitir inicio > fin
  } else {
    c.end = value;
    if (value && c.start && value < c.start) c.start = value;
  }
  return true;
}

function openCalendar(which) {
  const c = card(view.selectedId);
  if (!c) return;
  const anchor = $(`[data-cal-for="${which}"]`);
  if (!anchor) return;

  cal.open = true;
  cal.target = which;
  const base = c[which] ? parseISO(c[which]) : new Date();
  cal.y = base.getFullYear();
  cal.m = base.getMonth();

  const pop = $('#calPop');
  pop.hidden = false;
  renderCalendar();

  // colocar debajo del botón, ajustado a la ventana
  const r = anchor.getBoundingClientRect();
  pop.style.visibility = 'hidden';
  pop.style.left = '0px';
  pop.style.top = '0px';
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - pw - 12);
  let top = r.bottom + 6;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top = top + 'px';
  pop.style.visibility = 'visible';
}

function closeCalendar() {
  cal.open = false;
  cal.target = null;
  const pop = $('#calPop');
  if (pop) pop.hidden = true;
}

function renderCalendar() {
  const c = card(view.selectedId);
  const pop = $('#calPop');
  if (!pop || !cal.open) return;

  const first = new Date(cal.y, cal.m, 1);
  const offset = (first.getDay() + 6) % 7;            // semana empezando en lunes
  const daysInMonth = new Date(cal.y, cal.m + 1, 0).getDate();
  const today = todayISO();
  const sel = c ? c[cal.target] : null;

  // semana completa lunes→domingo, en el idioma activo
  const weekdayFmt = new Intl.DateTimeFormat(locale(), { weekday: 'short' });
  const weekdays = [];
  for (let i = 0; i < 7; i++) {
    weekdays.push(cap(weekdayFmt.format(new Date(2024, 0, 1 + i))));   // 1 ene 2024 = lunes
  }

  const lo = c && c.start && c.end ? (c.start < c.end ? c.start : c.end) : null;
  const hi = c && c.start && c.end ? (c.start > c.end ? c.start : c.end) : null;

  let cells = '';
  for (let i = 0; i < offset; i++) cells += '<div class="cal-day is-blank"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = iso(new Date(cal.y, cal.m, d));
    const cls = [
      'cal-day',
      ds === today ? 'is-today' : '',
      ds === sel ? 'is-sel' : '',
      (lo && hi && ds > lo && ds < hi) ? 'is-range' : '',
    ].filter(Boolean).join(' ');
    cells += `<button class="${cls}" data-cal-date="${ds}">${d}</button>`;
  }

  const monthLabel = cap(first.toLocaleDateString(locale(), { month: 'long', year: 'numeric' }));

  pop.innerHTML = `
    <div class="cal-head">
      <button class="cal-nav" data-cal-nav="-1" aria-label="${esc(t('cal.prev'))}">‹</button>
      <span class="cal-month">${esc(monthLabel)}</span>
      <button class="cal-nav" data-cal-nav="1" aria-label="${esc(t('cal.next'))}">›</button>
    </div>
    <div class="cal-week">${weekdays.map((w) => `<span>${esc(w)}</span>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-quick">
      <button class="cal-qbtn" data-cal-quick="0">${esc(t('cal.today'))}</button>
      <button class="cal-qbtn" data-cal-quick="1">${esc(t('cal.tomorrow'))}</button>
      <button class="cal-qbtn" data-cal-quick="7">${esc(t('cal.week'))}</button>
      <button class="cal-qbtn is-danger" data-cal-quick="clear">${esc(t('cal.clear'))}</button>
    </div>
    <input class="cal-input" id="calInput" placeholder="${esc(t('panel.datePh'))}" autocomplete="off">
    <div class="cal-dur" id="calDur"></div>`;

  updateDuration();
}

function updateDuration() {
  const c = card(view.selectedId);
  const el = $('#calDur');
  if (!el || !c) return;
  if (c.start && c.end) {
    const days = Math.round((parseISO(c.end) - parseISO(c.start)) / MS_DAY) + 1;
    el.textContent = t('cal.duration', { 0: Math.max(1, days) });
  } else {
    el.textContent = '';
  }
}

$('#calPop').addEventListener('click', (e) => {
  const c = card(view.selectedId);
  if (!c || !cal.open) return;

  const day = e.target.closest('[data-cal-date]');
  if (day) {
    mutate(() => setCardDate(c, cal.target, day.dataset.calDate));
    renderCalendar();
    return;
  }

  const nav = e.target.closest('[data-cal-nav]');
  if (nav) {
    cal.m += +nav.dataset.calNav;
    if (cal.m < 0) { cal.m = 11; cal.y--; }
    if (cal.m > 11) { cal.m = 0; cal.y++; }
    renderCalendar();
    return;
  }

  const quick = e.target.closest('[data-cal-quick]');
  if (quick) {
    const v = quick.dataset.calQuick;
    if (v === 'clear') {
      mutate(() => setCardDate(c, cal.target, null));
      closeCalendar();
      return;
    }
    const d = new Date();
    d.setDate(d.getDate() + parseInt(v, 10));
    mutate(() => setCardDate(c, cal.target, iso(d)));
    renderCalendar();
  }
});

$('#calPop').addEventListener('input', (e) => {
  if (e.target.id !== 'calInput') return;
  const c = card(view.selectedId);
  if (!c) return;
  const parsed = parseNaturalDate(e.target.value);
  if (parsed) { setCardDate(c, cal.target, parsed); save(); updateDuration(); }
});

$('#calPop').addEventListener('keydown', (e) => {
  const c = card(view.selectedId);
  if (!c || e.target.id !== 'calInput') return;
  if (e.key === 'Enter') {
    e.preventDefault();
    const parsed = parseNaturalDate(e.target.value);
    mutate(() => setCardDate(c, cal.target, parsed));
    closeCalendar();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeCalendar();
  }
});

/* ── Ayuda ───────────────────────────────────────── */

function renderHelp() {
  const host = $('#helpContent');
  if (!host) return;
  const sections = t('help.sections');
  host.innerHTML = `
    <h2>${esc(t('help.title'))}</h2>
    <p class="sub">${esc(t('help.sub'))}</p>
    ${sections.map((s) => `
      <h3>${esc(s.h)}</h3>
      ${s.rows.map((r) => `<div class="help-row">
          <span class="d">${esc(r[0])}</span>
          <span>${String(r[1]).split(/(\s+)/).map((x) =>
            x.trim() ? `<kbd>${esc(x)}</kbd>` : ' ').join('')}</span>
        </div>`).join('')}
    `).join('')}`;
}

/* ═══════════════ 10. Foco ═══════════════ */

function restoreFocus() {
  if (view.composing) {
    const ta = $('#composerInput');
    if (ta) {
      ta.focus();
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 220) + 'px';
    }
  } else if (view.editingTitle) {
    const ti = $('#titleEdit');
    if (ti) { ti.focus(); ti.select(); }
  } else if (view.editingCheck) {
    const ce = $(`[data-check-edit="${view.editingCheck}"]`);
    if (ce) { ce.focus(); ce.select(); }
  }
}

/* ═══════════════ 11. Selección ═══════════════ */

function selectCard(id, opts = {}) {
  view.selectedId = id;
  if (!opts.noRender) renderBoard();
  renderPanel();
  if (id) {
    const el = $(`[data-card="${id}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function moveSelection(delta) {
  const order = allCardsInOrder();
  if (!order.length) return;
  let i = order.findIndex((c) => c.id === view.selectedId);
  i = i < 0 ? (delta > 0 ? 0 : order.length - 1) : i + delta;
  i = Math.max(0, Math.min(order.length - 1, i));
  selectCard(order[i].id);
}

function activeListId() {
  const c = view.selectedId ? card(view.selectedId) : null;
  if (c) return c.listId;
  return lists()[0]?.id || null;
}

function focusList(n) {
  const l = lists()[n];
  if (!l) return;
  const el = $(`[data-list="${l.id}"]`);
  if (el) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  const first = cardsOf(l.id)[0];
  if (first) selectCard(first.id);
}

/* ═══════════════ 12. Compositor ═══════════════ */

function openComposer(listId) {
  view.composing = listId;
  view.drafts.__new = '';
  renderBoard();
  const list = S.lists[listId];
  const el = list && $(`[data-list="${listId}"] .list-body`);
  if (el) el.scrollTop = el.scrollHeight;
}

function closeComposer() {
  view.composing = null;
  view.drafts.__new = '';
  renderBoard();
}

function submitComposer() {
  const listId = view.composing;
  if (!listId) return;
  const ta = $('#composerInput');
  const text = (ta ? ta.value : view.drafts.__new || '').trim();
  if (!text) return closeComposer();

  let newId = null;
  mutate(() => {
    newId = newCard(listId, text);
    view.selectedId = newId;
  });

  view.composing = null;
  view.drafts.__new = '';
  render();
  const el = newId && $(`[data-card="${newId}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });
}

/* ═══════════════ 13. Menús ═══════════════ */

function openBoardMenu() {
  closeMenus();
  view.menu = { kind: 'board' };
  const btn = $('#boardPickerBtn');
  btn.setAttribute('aria-expanded', 'true');

  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = `
    <div class="menu-head">${esc(t('menu.boards'))}</div>
    ${S.boardOrder.map((id) => `<button class="menu-item ${id === view.boardId ? 'is-active' : ''}" data-switch-board="${id}">
        <span class="tick">${id === view.boardId ? '●' : ''}</span>
        <span class="label">${esc(S.boards[id]?.name || '—')}</span>
      </button>`).join('')}
    <div class="menu-sep"></div>
    <button class="menu-item" id="renameBoard"><span class="tick">✎</span><span class="label">${esc(t('menu.renameBoard'))}</span></button>
    <button class="menu-item" id="newBoard"><span class="tick">＋</span><span class="label">${esc(t('menu.newBoard'))}</span></button>
    <button class="menu-item" id="exportBoard"><span class="tick">↓</span><span class="label">${esc(t('menu.export'))}</span></button>
    <button class="menu-item" id="importBoard"><span class="tick">↑</span><span class="label">${esc(t('menu.import'))}</span></button>
    <div class="menu-sep"></div>
    <button class="menu-item" id="delBoard"><span class="tick">🗑</span><span class="label">${esc(t('menu.deleteBoard'))}</span></button>`;

  btn.parentElement.append(menu);
}

function openListMenu(listId) {
  closeMenus();
  view.menu = { kind: 'list', id: listId };
  const anchor = $(`[data-list-menu="${listId}"]`);
  if (!anchor) return;

  const mi = (act, ico, label) =>
    `<button class="menu-item" data-lm="${act}"><span class="tick">${ico}</span><span class="label">${esc(label)}</span></button>`;

  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.style.minWidth = '212px';
  menu.innerHTML = [
    mi('rename', '✎', t('list.rename')),
    mi('wip', '⚠', t('list.wip')),
    mi('copy', '⧉', t('list.copy')),
    '<div class="menu-sep"></div>',
    mi('sort', '⇅', t('list.sort')),
    mi('sortdue', '📅', t('list.sortdue')),
    '<div class="menu-sep"></div>',
    mi('clear', '✕', t('list.clear')),
    mi('delete', '🗑', t('list.delete')),
  ].join('');

  anchor.parentElement.style.position = 'relative';
  anchor.parentElement.append(menu);
}

function closeMenus() {
  $$('.menu').forEach((m) => m.remove());
  view.menu = null;
  $('#boardPickerBtn')?.setAttribute('aria-expanded', 'false');
}

function listAction(action, listId) {
  const l = S.lists[listId];
  if (!l) return;

  if (action === 'rename') {
    const name = prompt(t('ask.listName'), l.name);
    if (name != null && name.trim()) mutate(() => { l.name = name.trim(); });
  }
  if (action === 'wip') {
    const v = prompt(t('ask.wip'), l.wip == null ? '' : String(l.wip));
    if (v != null) mutate(() => { l.wip = v.trim() === '' ? null : Math.max(0, parseInt(v, 10) || 0); });
  }
  if (action === 'copy') {
    mutate(() => {
      const nid = newList(l.boardId, l.name + ' (copy)', { wip: l.wip, done: l.done });
      for (const c of cardsOf(l.id)) {
        const nc = newCard(nid, c.name);
        S.cards[nc].desc = c.desc;
        S.cards[nc].labels = [...(c.labels || [])];
        S.cards[nc].start = c.start;
        S.cards[nc].end = c.end;
        S.cards[nc].checklists = clone(c.checklists || []);
      }
      const bi = S.boards[l.boardId].lists;
      bi.splice(bi.indexOf(l.id) + 1, 0, nid);
    });
  }
  if (action === 'sort') {
    mutate(() => { l.cards.sort((a, b) => (card(a)?.name || '').localeCompare(card(b)?.name || '', getLang())); });
  }
  if (action === 'sortdue') {
    mutate(() => {
      l.cards.sort((a, b) => {
        const x = card(a), y = card(b);
        const da = x?.start || x?.end, db = y?.start || y?.end;
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da < db ? -1 : da > db ? 1 : 0;
      });
    });
  }
  if (action === 'clear') {
    if (!cardsOf(l.id).length) return;
    const n = cardsOf(l.id).length;
    mutate(() => { l.cards.forEach((id) => delete S.cards[id]); l.cards = []; });
    toast(t('toast.listCleared', { 0: n, 1: l.name }), t('toast.undo'), undo);
  }
  if (action === 'delete') {
    const n = cardsOf(l.id).length;
    mutate(() => {
      for (const cid of l.cards) delete S.cards[cid];
      const bl = S.boards[l.boardId].lists;
      bl.splice(bl.indexOf(l.id), 1);
      delete S.lists[l.id];
      if (view.selectedId && !S.cards[view.selectedId]) view.selectedId = null;
    });
    toast(t('toast.listDeleted', { 0: n }), t('toast.undo'), undo);
  }
}

/* ═══════════════ 14. Importar / exportar ═══════════════ */

function exportJSON() {
  const blob = new Blob([JSON.stringify({
    v: 1, boards: S.boards, lists: S.lists, cards: S.cards, boardOrder: S.boardOrder,
  }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(board()?.name || 'minimal-board').replace(/[^\w\-]+/g, '_')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(t('toast.exported'));
}

function importJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const p = JSON.parse(String(fr.result));
        if (!p.boards || !p.lists || !p.cards || !Array.isArray(p.boardOrder)) throw new Error('bad');
        mutate(() => {
          S.boards = p.boards; S.lists = p.lists; S.cards = p.cards; S.boardOrder = p.boardOrder;
          view.boardId = S.boardOrder[0];
          view.selectedId = null;
        });
        toast(t('toast.imported', { 0: S.boards[view.boardId]?.name || '' }));
      } catch (e) {
        toast(t('toast.badFile'));
      }
    };
    fr.readAsText(file);
  };
  input.click();
}

/* ═══════════════ 15. Arrastrar y soltar ═══════════════ */

const dnd = {
  active: false, id: null, ghost: null, ph: null,
  startX: 0, startY: 0, offX: 0, offY: 0, lastList: null, pending: null,
};

function dndStart(e) {
  const el = e.target.closest('.card');
  if (!el) return;
  dnd.id = el.dataset.card;
  dnd.startX = e.clientX;
  dnd.startY = e.clientY;
  dnd.pending = { el, x: e.clientX, y: e.clientY };
}

function dndBegin() {
  const src = $(`[data-card="${dnd.id}"]`);
  if (!src) return cleanupDnd();

  const rect = src.getBoundingClientRect();
  dnd.offX = dnd.startX - rect.left;
  dnd.offY = dnd.startY - rect.top;

  const ghost = src.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.width = rect.width + 'px';
  document.body.append(ghost);
  dnd.ghost = ghost;

  const ph = document.createElement('div');
  ph.className = 'drag-placeholder';
  ph.style.height = rect.height + 'px';
  src.parentNode.insertBefore(ph, src.nextSibling);
  dnd.ph = ph;

  src.classList.add('is-dragging');
  dnd.active = true;
  document.body.style.cursor = 'grabbing';
  positionGhost(dnd.startX, dnd.startY);
}

function positionGhost(x, y) {
  if (!dnd.ghost) return;
  dnd.ghost.style.transform = `translate(${x - dnd.offX}px, ${y - dnd.offY}px)`;
}

function dndPlace(x, y) {
  const under = document.elementFromPoint(x, y);
  const listEl = under?.closest('.list');
  if (!listEl || !dnd.ph) return;

  const body = listEl.querySelector('.list-body');
  if (!body) return;

  const cards = $$('.card:not(.is-dragging)', body);
  let placed = false;
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (y < r.top + r.height / 2) { body.insertBefore(dnd.ph, c); placed = true; break; }
  }
  if (!placed) body.append(dnd.ph);

  if (dnd.lastList !== listEl) {
    dnd.lastList?.classList.remove('is-over');
    listEl.classList.add('is-over');
    dnd.lastList = listEl;
  }
}

function dndEnd() {
  if (!dnd.active) return cleanupDnd();

  const ph = dnd.ph;
  const listEl = dnd.lastList || ph?.closest('.list');
  if (!listEl) return cleanupDnd();

  const toListId = listEl.dataset.list;
  const body = listEl.querySelector('.list-body');
  // Índice SIN la tarjeta arrastrada: si no, al reordenar dentro de la misma
  // lista cada destino caería una posición más abajo.
  const kids = Array.from(body.children).filter(
    (n) => (n.classList.contains('card') && !n.classList.contains('is-dragging')) || n === ph
  );
  const toIndex = Math.max(0, kids.indexOf(ph));

  const id = dnd.id;
  cleanupDnd();

  if (!toListId) return;
  const before = card(id)?.listId;
  const c = card(id);
  mutate(() => moveCard(id, toListId, toIndex));
  if (c && before !== toListId && isDoneList(S.lists[toListId])) {
    toast(t('toast.completed', { 0: truncate(c.name, 26) }), t('toast.undo'), undo);
  }
}

function cleanupDnd() {
  dnd.ghost?.remove();
  dnd.ph?.remove();
  dnd.lastList?.classList.remove('is-over');
  $$('.card.is-dragging').forEach((e) => e.classList.remove('is-dragging'));
  document.body.style.cursor = '';
  dnd.active = false; dnd.id = null; dnd.ghost = null; dnd.ph = null; dnd.lastList = null; dnd.pending = null;
}

function dndAutoScroll(x, y) {
  const b = $('#board');
  const r = b.getBoundingClientRect();
  const EDGE = 70, SPEED = 14;
  if (x - r.left < EDGE) b.scrollLeft -= SPEED;
  else if (r.right - x < EDGE) b.scrollLeft += SPEED;
  if (y - r.top < EDGE) b.scrollTop -= SPEED;
  else if (r.bottom - y < EDGE) b.scrollTop += SPEED;
}

/* ═══════════════ 16. Paleta de comandos ═══════════════ */

function commands() {
  return [
    { id: 'card',    name: t('cmd.newCard'),      ico: '＋', keys: 'N',   run: () => { const l = activeListId(); if (l) openComposer(l); } },
    { id: 'list',    name: t('cmd.newList'),      ico: '＋', keys: '⇧N',  run: () => { const b = board(); if (b) mutate(() => newList(b.id, t('list.addList'))); } },
    { id: 'board',   name: t('cmd.newBoard'),     ico: '＋', keys: '',    run: () => createBoard('') },
    { id: 'done',    name: t('cmd.complete'),     ico: '✓', keys: '␣',   run: () => view.selectedId && completeCard(view.selectedId) },
    { id: 'archive', name: t('cmd.delete'),       ico: '🗑', keys: 'X',   run: () => view.selectedId && deleteCard(view.selectedId) },
    { id: 'undo',    name: t('cmd.undo'),         ico: '↶', keys: '⌘Z',  run: undo },
    { id: 'redo',    name: t('cmd.redo'),         ico: '↷', keys: '⇧⌘Z', run: redo },
    { id: 'export',  name: t('menu.export'),      ico: '↓', keys: '',    run: exportJSON },
    { id: 'import',  name: t('menu.import'),      ico: '↑', keys: '',    run: importJSON },
    { id: 'clearf',  name: t('cmd.clearFilters'), ico: '✕', keys: '',    run: () => { view.query = ''; view.labelFilter = null; view.quick.clear(); $('#search').value = ''; render(); } },
    { id: 'theme',   name: t('cmd.theme'),        ico: '◐', keys: '',    run: toggleTheme },
    { id: 'help',    name: t('cmd.help'),         ico: '?', keys: '?',   run: openHelp },
  ];
}

let palIndex = 0;
let palItems = [];

function openPalette() {
  $('#paletteOverlay').hidden = false;
  const inp = $('#paletteInput');
  inp.value = '';
  palIndex = 0;
  renderPalette();
  inp.focus();
}
function closePalette() { $('#paletteOverlay').hidden = true; }

function renderPalette() {
  const q = $('#paletteInput').value.trim().toLowerCase();
  palItems = commands().filter((c) => !q || c.name.toLowerCase().includes(q));
  if (!palItems.length) {
    $('#paletteList').innerHTML = `<div class="palette-empty">${esc(t('cmd.empty', { 0: q }))}</div>`;
    return;
  }
  palIndex = Math.max(0, Math.min(palIndex, palItems.length - 1));
  $('#paletteList').innerHTML = palItems.map((c, i) => `
    <button class="palette-item ${i === palIndex ? 'is-active' : ''}" data-cmd="${c.id}">
      <span class="ico">${c.ico}</span>
      <span class="txt">${esc(c.name)}</span>
      ${c.keys ? `<span class="sc">${esc(c.keys)}</span>` : ''}
    </button>`).join('');
}

function openHelp() { $('#helpOverlay').hidden = false; }
function closeHelp() { $('#helpOverlay').hidden = true; }

/* ═══════════════ 17. Tema ═══════════════ */

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('minimal-board:theme', next); } catch (e) {}
}

/* ═══════════════ 18. Eventos ═══════════════ */

document.addEventListener('click', (e) => {
  if (view.menu && !e.target.closest('.menu') && !e.target.closest('[data-list-menu]') && !e.target.closest('#boardPickerBtn')) {
    closeMenus();
  }

  const tEl = e.target;

  const cardEl = tEl.closest('.card');
  if (cardEl && !cardEl.classList.contains('is-dragging')) {
    selectCard(cardEl.dataset.card);
    return;
  }

  if (tEl.closest('[data-list-menu]')) {
    const id = tEl.closest('[data-list-menu]').dataset.listMenu;
    view.menu?.kind === 'list' && view.menu.id === id ? closeMenus() : openListMenu(id);
    return;
  }

  const lm = tEl.closest('[data-lm]');
  if (lm) { const id = view.menu?.id; closeMenus(); if (id) listAction(lm.dataset.lm, id); return; }

  if (tEl.closest('#addListBtn')) {
    $('#addListBtn').style.display = 'none';
    const inp = $('#addListInput');
    inp.style.display = 'block';
    inp.focus();
    return;
  }

  const addCardBtn = tEl.closest('[data-add-card]');
  if (addCardBtn) { openComposer(addCardBtn.dataset.addCard); return; }

  const lf = tEl.closest('[data-label]');
  if (lf) { view.labelFilter = view.labelFilter === lf.dataset.label ? null : lf.dataset.label; render(); return; }

  const qf = tEl.closest('[data-quick]');
  if (qf) {
    const id = qf.dataset.quick;
    view.quick.has(id) ? view.quick.delete(id) : view.quick.add(id);
    render();
    return;
  }

  if (tEl.closest('#clearFilters') || tEl.closest('#clearFilters2')) {
    view.query = ''; view.labelFilter = null; view.quick.clear();
    $('#search').value = '';
    render();
    return;
  }

  if (tEl.closest('#boardPickerBtn')) {
    view.menu?.kind === 'board' ? closeMenus() : openBoardMenu();
    return;
  }
  const sw = tEl.closest('[data-switch-board]');
  if (sw) {
    closeMenus();
    view.boardId = sw.dataset.switchBoard;
    view.selectedId = null; view.composing = null;
    save(); render();
    return;
  }
  if (tEl.closest('#newBoard'))     { closeMenus(); createBoard(''); return; }
  if (tEl.closest('#exportBoard'))  { closeMenus(); exportJSON(); return; }
  if (tEl.closest('#importBoard'))  { closeMenus(); importJSON(); return; }
  if (tEl.closest('#renameBoard')) {
    closeMenus();
    const b = board();
    const n = prompt(t('ask.boardName'), b.name);
    if (n != null && n.trim()) mutate(() => { b.name = n.trim(); });
    return;
  }
  if (tEl.closest('#delBoard')) {
    closeMenus();
    const b = board();
    if (confirm(t('ask.deleteBoard', { 0: b.name }))) deleteBoard(b.id);
    return;
  }
  if (tEl.closest('#newCardBtn')) { const l = activeListId(); if (l) openComposer(l); return; }
  if (tEl.closest('#paletteBtn'))  { openPalette(); return; }
  if (tEl.closest('#helpBtn'))     { openHelp(); return; }
  if (tEl.closest('#themeBtn'))    { toggleTheme(); return; }
  if (tEl.closest('#searchClear')) {
    view.query = ''; $('#search').value = '';
    render(); $('#search').focus();
    return;
  }
  if (tEl.closest('#panelClose'))   { selectCard(null); return; }

  if (tEl.closest('#paletteOverlay') && !tEl.closest('.palette')) closePalette();
  if (tEl.closest('#helpOverlay') && !tEl.closest('.help')) closeHelp();

  // composedPath() y no closest(): al pulsar un día el popover se reconstruye,
  // e.target queda desacoplado del DOM y closest() devolvería null — cerrando
  // el calendario justo después de usarlo. composedPath se calcula al despachar.
  if (cal.open) {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const inside = path.includes($('#calPop')) || !!tEl.closest('#calPop');
    if (!inside && !tEl.closest('[data-cal-for]')) closeCalendar();
  }
});

/* — selector de idioma — */
$('#langSelect').addEventListener('change', (e) => {
  setLang(e.target.value);
  // La demo sigue al idioma; los datos del usuario nunca se tocan.
  if (S.__demo) { seed(); view.selectedId = null; view.composing = null; }
  view.query = $('#search').value.trim();
  save();
  render();
});

/* — panel — */
$('#panelBody').addEventListener('click', (e) => {
  const c = card(view.selectedId);
  if (!c) return;
  const tEl = e.target;

  const tg = tEl.closest('[data-toggle-item]');
  if (tg) {
    const id = tg.dataset.toggleItem;
    mutate(() => {
      for (const cl of c.checklists) {
        const it = cl.items.find((i) => i.id === id);
        if (it) it.done = !it.done;
      }
    });
    const cl = c.checklists.find((x) => x.items.some((i) => i.id === id));
    if (cl && cl.items.every((i) => i.done) && !c.done) maybeAutoComplete(c.id);
    return;
  }

  const del = tEl.closest('[data-del-item]');
  if (del) {
    mutate(() => {
      for (const cl of c.checklists) cl.items = cl.items.filter((i) => i.id !== del.dataset.delItem);
    });
    return;
  }

  const ed = tEl.closest('[data-edit-item]');
  if (ed) { view.editingCheck = ed.dataset.editItem; renderPanel(); return; }

  const lt = tEl.closest('[data-label-toggle]');
  if (lt) {
    const id = lt.dataset.labelToggle;
    mutate(() => {
      const i = c.labels.indexOf(id);
      i >= 0 ? c.labels.splice(i, 1) : c.labels.push(id);
    });
    return;
  }

  const kindBtn = tEl.closest('[data-kind]');
  if (kindBtn) {
    const k = kindBtn.dataset.kind;
    mutate(() => { c.kind = k; if (k === 'task') c.severity = null; });
    return;
  }

  const sevBtn = tEl.closest('[data-severity]');
  if (sevBtn) {
    mutate(() => { c.severity = sevBtn.dataset.severity; });
    return;
  }

  if (tEl.closest('#verifyCard')) {
    window.DepdoitSync.verify(c.id)
      .then(() => { c.verifiedAt = new Date().toISOString(); renderPanel(); toast(t('panel.verified')); })
      .catch((err) => toast(err.message || 'No se pudo verificar'));
    return;
  }

  // Asignar / desasignar. Va contra el backend, no contra el estado local:
  // la asignación es un hecho del dominio, no un array suelto en la tarjeta.
  const asg = tEl.closest('[data-assign]');
  if (asg) {
    const userId = asg.dataset.assign;
    const current = (c.assignees || []).map((a) => a.user_id);
    const isOn = current.includes(userId);
    const email = (window.DepdoitSync.members().find((m) => m.user_id === userId) || {}).email || '';

    // Optimista: se pinta ya. Si el servidor lo rechaza, se revierte.
    c.assignees = isOn
      ? (c.assignees || []).filter((a) => a.user_id !== userId)
      : [...(c.assignees || []), { user_id: userId, email }];
    renderPanel();

    window.DepdoitSync.assign(c.id, userId, !isOn).catch((err) => {
      toast(err.message || 'No se pudo asignar');
      c.assignees = isOn
        ? [...(c.assignees || []), { user_id: userId, email }]
        : (c.assignees || []).filter((a) => a.user_id !== userId);
      renderPanel();
    });
    return;
  }

  if (tEl.closest('[data-cal-for]')) {
    openCalendar(tEl.closest('[data-cal-for]').dataset.calFor);
    return;
  }

  const clearDate = tEl.closest('[data-clear-date]');
  if (clearDate) {
    const which = clearDate.dataset.clearDate;
    mutate(() => setCardDate(c, which, null));
    return;
  }

  if (tEl.closest('#delChecklist')) { mutate(() => { c.checklists = []; }); return; }
});

$('#panelBody').addEventListener('input', (e) => {
  const c = card(view.selectedId);
  if (!c) return;
  const tEl = e.target;

  if (tEl.id === 'descEditor') {
    c.desc = tEl.value;                      // sin re-render: no pierde el cursor
    save();
    return;
  }
  if (tEl.id === 'expectedInput') {
    c.expected = tEl.value;
    save();
    return;
  }
  if (tEl.id === 'actualInput') {
    c.actual = tEl.value;
    save();
    return;
  }
  if (tEl.id === 'startInput' || tEl.id === 'endInput') {
    const which = tEl.id === 'startInput' ? 'start' : 'end';
    const parsed = parseNaturalDate(tEl.value.split('  ·  ')[0]);
    if (parsed) { setCardDate(c, which, parsed); save(); }
    return;
  }
  if (tEl.dataset?.addItem || tEl.id === 'addChecklistInput' || tEl.dataset?.checkEdit) return;
});

/* Los campos que crean contenido se confirman con Enter, no en cada tecla:
   re-renderizar mientras se escribe robaría el foco. */
$('#panelBody').addEventListener('keydown', (e) => {
  const c = card(view.selectedId);
  if (!c) return;
  const tEl = e.target;

  if (e.key === 'Enter' && tEl.dataset?.addItem) {
    e.preventDefault();
    const name = tEl.value.trim();
    if (!name) return;
    mutate(() => {
      const cl = c.checklists.find((x) => x.id === tEl.dataset.addItem);
      if (cl) cl.items.push({ id: uid(), name, done: false });
    });
    return;
  }

  if (e.key === 'Enter' && tEl.id === 'addChecklistInput') {
    e.preventDefault();
    const name = tEl.value.trim();
    if (!name) return;
    mutate(() => { c.checklists.push({ id: uid(), name, items: [] }); });
    return;
  }

  if (e.key === 'Enter' && tEl.dataset?.checkEdit) {
    e.preventDefault();
    const id = tEl.dataset.checkEdit;
    const v = tEl.value.trim();
    view.editingCheck = null;
    mutate(() => {
      for (const cl of c.checklists) {
        const it = cl.items.find((i) => i.id === id);
        if (it) it.name = v || it.name;
      }
    });
  }
});

// Los textareas de evidencia no re-renderizan al escribir (perderían el
// cursor), así que el envío al backend se hace al salir del campo con una
// llamada explícita, no fabricando un diff falso.
$('#panelBody').addEventListener('focusout', (e) => {
  const c = card(view.selectedId);
  if (!c) return;
  if (e.target.id === 'expectedInput' || e.target.id === 'actualInput') {
    window.DepdoitSync.saveEvidence(c);
  }
});

$('#panelBody').addEventListener('change', (e) => {
  const c = card(view.selectedId);
  if (!c) return;
  if (e.target.id === 'listSelect') {
    const to = e.target.value;
    mutate(() => moveCard(c.id, to));
    return;
  }
  if (e.target.id === 'startInput' || e.target.id === 'endInput') {
    const which = e.target.id === 'startInput' ? 'start' : 'end';
    const parsed = parseNaturalDate(e.target.value.split('  ·  ')[0]);
    mutate(() => setCardDate(c, which, parsed));
  }
});

$('#panelFoot').addEventListener('click', (e) => {
  const c = card(view.selectedId);
  if (!c) return;
  const tEl = e.target;

  if (tEl.closest('#markDone')) {
    if (c.done) mutate(() => { c.done = false; moveCard(c.id, (lists().find((l) => !isDoneList(l)) || S.lists[c.listId]).id); });
    else completeCard(c.id);
    return;
  }
  if (tEl.closest('#dupCard')) {
    mutate(() => {
      const nid = newCard(c.listId, c.name);
      const nc = S.cards[nid];
      nc.desc = c.desc; nc.labels = [...(c.labels || [])];
      nc.start = c.start; nc.end = c.end;
      nc.checklists = clone(c.checklists || []);
      view.selectedId = nid;
    });
    return;
  }
  if (tEl.closest('#delCard')) deleteCard(c.id);
});

$('#panelPrev').addEventListener('click', () => moveSelection(-1));
$('#panelNext').addEventListener('click', () => moveSelection(1));

/* — búsqueda — */
$('#search').addEventListener('input', (e) => {
  view.query = e.target.value.trim();
  render();
  const s = $('#search');
  s.focus();
  s.setSelectionRange(s.value.length, s.value.length);
});

/* — paleta — */
$('#paletteInput').addEventListener('input', () => { palIndex = 0; renderPalette(); });
$('#paletteInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palIndex = Math.min(palIndex + 1, palItems.length - 1); renderPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palIndex = Math.max(palIndex - 1, 0); renderPalette(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const c = palItems[palIndex];
    if (c) { closePalette(); c.run(); }
  }
});
$('#paletteList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (!b) return;
  const c = commands().find((x) => x.id === b.dataset.cmd);
  closePalette();
  if (c) c.run();
});

/* — teclado global — */
document.addEventListener('keydown', (e) => {
  const typing = isTypingTarget(e.target);

  if (!$('#paletteOverlay').hidden) {
    if (e.key === 'Escape') { closePalette(); e.preventDefault(); }
    return;
  }
  if (!$('#helpOverlay').hidden) {
    if (e.key === 'Escape' || e.key === '?') { closeHelp(); e.preventDefault(); }
    return;
  }
  if (cal.open && !$('#calPop').contains(e.target)) {
    if (e.key === 'Escape') { closeCalendar(); e.preventDefault(); return; }
  }

  if ((e.metaKey || e.ctrlKey)) {
    if (e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    return;
  }

  if (view.composing) {
    const ta = $('#composerInput');
    if (e.key === 'Escape') {
      e.preventDefault();
      view.drafts.__new = '';
      closeComposer();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitComposer();
    } else if (ta) {
      view.drafts.__new = ta.value;
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 220) + 'px';
    }
    return;
  }

  if (view.editingTitle) {
    const ti = $('#titleEdit');
    if (e.key === 'Enter') {
      e.preventDefault();
      const id = view.editingTitle;
      const v = ti.value.trim();
      view.editingTitle = null;
      mutate(() => { S.cards[id].name = v || t('card.untitled'); });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      view.editingTitle = null;
      renderBoard();
    }
    return;
  }

  if (view.editingCheck) {
    const ce = $(`[data-check-edit="${view.editingCheck}"]`);
    if (e.key === 'Enter') {
      e.preventDefault();
      const id = view.editingCheck;
      const v = ce.value.trim();
      view.editingCheck = null;
      mutate(() => {
        const c = card(view.selectedId);
        if (!c) return;
        for (const cl of c.checklists) {
          const it = cl.items.find((i) => i.id === id);
          if (it) it.name = v || it.name;
        }
      });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      view.editingCheck = null;
      renderPanel();
    }
    return;
  }

  if (typing) return;

  if (e.key === 'Escape' && cal.open) {
    e.preventDefault();
    closeCalendar();
    return;
  }

  switch (e.key) {
    case '/':
      e.preventDefault();
      $('#search').focus();
      $('#search').select();
      return;
    case '?':
      e.preventDefault();
      openHelp();
      return;
    case 'Escape':
      if (view.selectedId) selectCard(null);
      else closeMenus();
      return;
    case 'j': case 'J': case 'ArrowDown': e.preventDefault(); moveSelection(1); return;
    case 'k': case 'K': case 'ArrowUp':   e.preventDefault(); moveSelection(-1); return;
    case 'n': case 'N':
      e.preventDefault();
      if (e.shiftKey) {
        const b = board();
        if (b) mutate(() => newList(b.id, t('list.addList')));
      } else {
        const l = activeListId();
        if (l) openComposer(l);
      }
      return;
    case 'e': case 'E':
      e.preventDefault();
      if (view.selectedId) { view.editingTitle = view.selectedId; renderBoard(); }
      return;
    case 'd': case 'D':
      e.preventDefault();
      if (view.selectedId) { renderPanel(); $('#descEditor')?.focus(); }
      return;
    case 'f': case 'F':
      e.preventDefault();
      if (view.selectedId) { renderPanel(); $('#endInput')?.focus(); }
      return;
    case 'x': case 'X':
      e.preventDefault();
      if (view.selectedId) deleteCard(view.selectedId);
      return;
    case ' ':
      e.preventDefault();
      if (view.selectedId) {
        const c = card(view.selectedId);
        if (c && !c.done) completeCard(c.id);
        else if (c) mutate(() => { c.done = false; });
      }
      return;
    case 'Tab':
      if (view.selectedId) {
        e.preventDefault();
        const c = card(view.selectedId);
        const order = lists();
        const i = order.findIndex((l) => l.id === c.listId);
        if (order[i + 1]) mutate(() => moveCard(c.id, order[i + 1].id));
      }
      return;
  }

  if (/^[1-9]$/.test(e.key)) { e.preventDefault(); focusList(+e.key - 1); }
});

/* — lista nueva — */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'addListInput') {
    e.preventDefault();
    commitNewList();
  } else if (e.key === 'Escape' && e.target.id === 'addListInput') {
    e.preventDefault();
    resetAddListInput();
  }
});

document.addEventListener('focusout', (e) => {
  if (e.target.id === 'addListInput') commitNewList();
});

function commitNewList() {
  const inp = $('#addListInput');
  const b = board();
  if (!inp || !b) return;
  const name = inp.value.trim();
  if (name) mutate(() => newList(b.id, name));
  resetAddListInput();
}

function resetAddListInput() {
  const btn = $('#addListBtn'), inp = $('#addListInput');
  if (btn) btn.style.display = '';
  if (inp) { inp.style.display = 'none'; inp.value = ''; }
}

/* — puntero: arrastre — */
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (isTypingTarget(e.target)) return;
  if (e.target.closest('button') && !e.target.closest('.card')) return;
  dndStart(e);
});

document.addEventListener('pointermove', (e) => {
  if (dnd.pending && !dnd.active) {
    const dx = e.clientX - dnd.pending.x, dy = e.clientY - dnd.pending.y;
    if (Math.hypot(dx, dy) > 5) {
      dnd.id = dnd.pending.el.dataset.card;
      dnd.startX = dnd.pending.x; dnd.startY = dnd.pending.y;
      dndBegin();
    }
  }
  if (!dnd.active) return;
  e.preventDefault();
  positionGhost(e.clientX, e.clientY);
  dndPlace(e.clientX, e.clientY);
  dndAutoScroll(e.clientX, e.clientY);
}, { passive: false });

document.addEventListener('pointerup', () => {
  if (dnd.active) dndEnd();
  else dnd.pending = null;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dnd.active) cleanupDnd();
});

/* ═══════════════ 19. Arranque ═══════════════ */

function init() {
  try {
    const th = localStorage.getItem('minimal-board:theme');
    if (th) document.documentElement.dataset.theme = th;
    else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      document.documentElement.dataset.theme = 'dark';
    }
  } catch (e) {}

  const hadData = load();
  // Si la partida guardada venía de otra versión (sin datos en el idioma actual),
  // se regenera la demo para que no queden cadenas en un idioma ya cambiado.
  if (hadData && !Array.isArray(S.boards[S.boardOrder[0]]?.lists)) hadData = false;

  window.I18N.initLang();
  const ls = $('#langSelect');
  if (ls) {
    ls.innerHTML = window.I18N.LANGS
      .map((c) => `<option value="${c}">${esc(window.I18N.langEndonym(c))}</option>`).join('');
    ls.value = getLang();
  }
  window.I18N.applyStatic();

  if (!hadData) { localStorage.removeItem(STORAGE_KEY); seed(); }
  render();

  // Con backend configurado, el tablero real sustituye a lo local en cuanto
  // haya sesión. Sin sesión, la app sigue funcionando en local como antes.
  if (window.DepdoitSync && window.DepdoitSync.enabled()) {
    window.DepdoitSync.boot((state, ctx) => {
      if (state) {
        S = {
          boards: state.boards,
          lists: state.lists,
          cards: state.cards,
          boardOrder: state.boardOrder.length ? state.boardOrder : S.boardOrder,
          ui: {},
          __demo: false,
        };
        // Si el servidor llega vacío (empresa nueva), se siembra un tablero
        // mínimo en lugar de dejar al usuario mirando una pantalla en blanco.
        if (!S.boardOrder.length) {
          const b = uid();
          S.boards[b] = { id: b, name: 'Tareas', lists: [], createdAt: Date.now() };
          S.boardOrder.push(b);
        }
        view.boardId = S.boardOrder[0];
        view.selectedId = null;
        save();
        render();
      }
    });
  }

  setTimeout(() => {
    if (!localStorage.getItem(STORAGE_KEY)) toast(t('toast.welcome'));
  }, 700);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

// Puente mínimo para que el backend pueda avisar al usuario con el toast de la
// propia app, en vez de inventar una segunda forma de notificar.
window.DepdoitUI = { toast };

})();