/* ============================================================
   admin.js — administración del equipo
   ============================================================
   Invitación por ENLACE, sin envío de correo: el owner genera un token de un
   solo uso y lo entrega por donde quiera. Decisión de producto, no carencia.

   Seguridad: el alta de usuarios en Supabase requiere service_role, que no
   puede estar aquí. Por eso el admin no crea cuentas: invita. La persona se
   registra y canjea el token, que solo vale para su email.
   ============================================================ */
(function () {
'use strict';

const API = window.DepdoitAPI;
const t = (key, vars) => window.TasksI18n.t(key, vars);
let translation = null;
const $ = (s, r = document) => r.querySelector(s);

let ctx = null;
let invitations = [];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/**
 * Caché local de enlaces de invitación.
 *
 * El servidor solo guarda el HASH del token: es lo correcto (quien lea la
 * tabla no puede reconstruir el enlace), pero eso significa que el enlace en
 * claro no se puede recuperar del backend. Se guarda aquí, en el navegador
 * del owner que lo generó, para que no se pierda al recargar.
 */
const LINK_STORE = 'depdoit:invite-links';

function loadLinks() {
  try { return JSON.parse(localStorage.getItem(LINK_STORE) || '{}'); } catch (e) { return {}; }
}

function saveLink(email, url) {
  const all = loadLinks();
  all[String(email).toLowerCase()] = { url, at: Date.now() };
  try { localStorage.setItem(LINK_STORE, JSON.stringify(all)); } catch (e) {}
}

function getLink(email) {
  return loadLinks()[String(email).toLowerCase()] || null;
}

function dropLink(email) {
  const all = loadLinks();
  delete all[String(email).toLowerCase()];
  try { localStorage.setItem(LINK_STORE, JSON.stringify(all)); } catch (e) {}
}

function inviteUrl(token) {
  return `${location.origin}/?invite=${token}`;
}

/* ── Arranque ─────────────────────────────────────────── */

async function boot() {
  const main = $('#adminMain');

  if (window.DepdoitAuth) {
    try { await window.DepdoitAuth.ensure(); }
    catch (err) { main.textContent = err.message; return; }
  }

  if (!API.readSession()) {
    main.innerHTML = `<div class="admin-card admin-gate">
      <h1>${esc(t('team'))}</h1>
      <p>${esc(t('gate'))}</p>
      <a class="btn btn-primary" href="/">${esc(t('gateLink'))}</a>
    </div>`;
    return;
  }

  try {
    ctx = await API.loadContext();
  } catch (err) {
    main.innerHTML = `<div class="admin-card admin-gate">
      <h1>${esc(t('loadError'))}</h1><p>${esc(err.message)}</p>
      <button class="btn" id="retry">${esc(t('retry'))}</button></div>`;
    $('#retry').addEventListener('click', boot);
    return;
  }

  if (!ctx) {
    main.innerHTML = `<div class="admin-card admin-gate">
      <h1>${esc(t('noCompany'))}</h1><p>${esc(t('noCompanyHint'))}</p></div>`;
    return;
  }

  await refresh();
}

async function refresh() {
  try {
    if (ctx.role === 'owner') {
      const inv = await API.rpc('task_list_invitations', { p_organization_id: ctx.organizationId });
      invitations = Array.isArray(inv) ? inv : [];
    }
  } catch (err) {
    invitations = [];
  }
  if (ctx.role === 'owner') {
    try { translation = await relaySettings(); }
    catch { translation = null; }
  }
  render();
}

/* ── Pintado ──────────────────────────────────────────── */

function render() {
  const main = $('#adminMain');
  const isOwner = ctx.role === 'owner';

  // La empresa activa debe verse SIEMPRE. Un founder pertenece a varias, y
  // crear invitaciones en la equivocada es un error que antes pasaba mudo.
  const orgs = ctx.organizations || [];
  if (orgs.length > 1) {
    $('#adminHeading').innerHTML = `<select class="org-switch" id="orgSwitch"
        title="${esc(t('activeOrg'))}" aria-label="${esc(t('activeOrg'))}">
        ${orgs.map((o) => `<option value="${o.organizationId}"
          ${o.organizationId === ctx.organizationId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
      </select>`;
  } else {
    $('#adminHeading').textContent = ctx.organizationName || t('team');
  }

  main.innerHTML = `
    ${isOwner ? renderInviteCard() + renderTranslationCard() : renderReadOnlyNotice()}

    <section class="admin-card">
      <h2 class="admin-h2">${esc(t('people'))} <span class="admin-count">${ctx.members.length}</span></h2>
      <div class="admin-people">
        ${ctx.members.map((m) => renderMemberRow(m, isOwner)).join('')}
      </div>
    </section>

    ${isOwner && invitations.length ? renderPendingCard() : ''}
  `;

  $('#backToBoard').textContent = t('back');
  $('#themeBtn').setAttribute('aria-label', t('theme'));
  document.title = t('team') + ' · Departify';
  bind();
}

function renderReadOnlyNotice() {
  return `<div class="admin-card admin-notice">
      <p>${esc(t('readOnly'))}</p>
    </div>`;
}

function renderInviteCard() {
  return `<section class="admin-card">
      <h2 class="admin-h2">${esc(t('invite'))}</h2>
      <p class="admin-help">${esc(t('inviteHelp'))}</p>
      <form class="admin-form" id="inviteForm">
        <input class="input" id="inviteEmail" type="email" placeholder="${esc(t('emailPlaceholder'))}" aria-label="${esc(t('email'))}"
               autocomplete="off" required>
        <select class="input select" id="inviteRole" aria-label="${esc(t('member'))}">
          <option value="member">${esc(t('member'))}</option>
          <option value="owner">${esc(t('owner'))}</option>
        </select>
        <button class="btn btn-primary" type="submit" id="inviteSubmit">${esc(t('createLink'))}</button>
      </form>
      <div class="admin-invite-result" id="inviteResult" hidden>
        <label class="field-label" for="inviteLink">${esc(t('inviteLink'))}</label>
        <div class="admin-link-row">
          <input class="input" id="inviteLink" readonly>
          <button class="btn" id="copyLink" type="button">${esc(t('copy'))}</button>
        </div>
        <p class="admin-hint">${esc(t('inviteFor'))} <strong id="inviteFor"></strong>.</p>
      </div>
    </section>`;
}

function renderMemberRow(m, isOwner) {
  const initial = (m.email || '?').trim().charAt(0).toUpperCase();
  const isOwnerRow = m.role === 'owner';
  const isMe = API.currentUser() && m.user_id === API.currentUser().id;

  return `<div class="admin-person" data-user="${m.user_id}">
      <span class="assignee-avatar admin-avatar">${esc(initial)}</span>
      <div class="admin-person-info">
        <span class="admin-person-mail">${esc(m.email)}${isMe ? ` <span class="admin-you">${esc(t('you'))}</span>` : ''}</span>
        <span class="admin-person-role ${isOwnerRow ? 'is-owner' : ''}">${isOwnerRow ? t('owner') : t('member')}</span>
      </div>
      ${isOwner ? `<div class="admin-person-actions">
        <button class="btn btn-sm" data-role="${m.user_id}" data-next="${isOwnerRow ? 'member' : 'owner'}">
          ${isOwnerRow ? t('makeMember') : t('makeOwner')}
        </button>
        ${!isOwnerRow && !isMe ? `<button class="btn btn-sm btn-danger" data-remove="${m.user_id}">${esc(t('remove'))}</button>` : ''}
      </div>` : ''}
    </div>`;
}

function renderPendingCard() {
  return `<section class="admin-card">
      <h2 class="admin-h2">${esc(t('pendingInvites'))}</h2>
      <p class="admin-help">${esc(t('pendingHelp'))}</p>
      <div class="admin-people">
        ${invitations.map((i) => {
          const cached = getLink(i.email);
          return `<div class="admin-person">
            <span class="assignee-avatar admin-avatar admin-avatar-pending">?</span>
            <div class="admin-person-info">
              <span class="admin-person-mail">${esc(i.email)}</span>
              <span class="admin-person-role">${i.expired ? t('expired') : t('pending')} ·
                ${i.role === 'owner' ? t('owner') : t('member')}</span>
            </div>
            <div class="admin-person-actions">
              ${cached
                ? `<button class="btn btn-sm" data-copy-invite="${esc(i.email)}">${esc(t('copyLink'))}</button>
                   <button class="btn btn-sm" data-regen-invite="${esc(i.email)}"
                     data-regen-role="${i.role}">${esc(t('new'))}</button>`
                : `<button class="btn btn-sm btn-primary" data-regen-invite="${esc(i.email)}"
                     data-regen-role="${i.role}">${esc(t('generateLink'))}</button>`}
            </div>
          </div>`;
        }).join('')}
      </div>
    </section>`;
}

/**
 * Muestra el enlace en el cuadro superior. Se llama DESPUÉS de refresh()
 * porque refresh() reescribe el innerHTML del contenedor.
 */
function showLink(email, url) {
  const box = $('#inviteResult');
  if (!box) return;
  $('#inviteLink').value = url;
  $('#inviteFor').textContent = email;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** Genera un enlace nuevo para un email ya invitado (el anterior queda inválido). */
async function regenerate(email, role) {
  const token = await API.rpc('task_create_invitation', {
    p_organization_id: ctx.organizationId,
    p_email: email,
    p_role: role || 'member',
  });
  const url = inviteUrl(token);
  saveLink(email, url);
  await refresh();
  showLink(email, url);
  toast(t('regenerated'));
}

async function relaySettings(body) {
  const token = await API.token();
  const response = await fetch('/api/settings/translation', {
    method: body ? 'PATCH' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'x-organization-id': ctx.organizationId, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(t('translationError'));
  return response.json();
}

function renderTranslationCard() {
  return `<section class="admin-card">
    <h2 class="admin-h2">${esc(t('translationTitle'))}</h2>
    <p class="admin-help">${esc(t('translationHelp'))}</p>
    <p id="translationStatus" role="status">${esc(t(translation?.available ? 'translationOn' : translation?.enabled === false ? 'translationOff' : 'translationMissing'))}</p>
    <form id="translationForm">
      <label><input id="translationEnabled" type="checkbox" ${translation?.enabled !== false ? 'checked' : ''}> ${esc(t('translationEnable'))}</label>
      <label for="translationKey">${esc(t('translationKey'))}</label>
      <input class="input" id="translationKey" type="password" autocomplete="new-password" spellcheck="false" aria-describedby="translationHint">
      <p id="translationHint" class="admin-help">${esc(t('translationKeyHint'))}</p>
      <button class="btn btn-primary" id="translationSave" type="submit">${esc(t('save'))}</button>
    </form>
  </section>`;
}

/* ── Eventos ──────────────────────────────────────────── */

function bind() {
  $('#translationForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('#translationSave'); button.disabled = true; button.textContent = t('saving');
    try {
      translation = await relaySettings({enabled: $('#translationEnabled').checked, apiKey: $('#translationKey').value});
      $('#translationKey').value = '';
      render(); toast(t('translationSaved'));
    } catch { toast(t('translationError')); }
    finally { button.disabled = false; button.textContent = t('save'); }
  });
  const form = $('#inviteForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#inviteEmail').value.trim();
      const role = $('#inviteRole').value;
      const btn = $('#inviteSubmit');
      btn.disabled = true;
      try {
        const token = await API.rpc('task_create_invitation', {
          p_organization_id: ctx.organizationId,
          p_email: email,
          p_role: role,
        });
        const url = inviteUrl(token);
        saveLink(email, url);
        $('#inviteEmail').value = '';
        // refresh() rehace el HTML del panel, así que primero se recarga la
        // lista y DESPUÉS se pinta el enlace. Al revés, el cuadro se borraba
        // en el mismo instante en que aparecía.
        await refresh();
        showLink(email, url);
        toast(t('created'));
      } catch (err) {
        toast(err.message || t('inviteError'));
      } finally {
        btn.disabled = false;
      }
    });
  }

  const copy = $('#copyLink');
  if (copy) {
    copy.addEventListener('click', async () => {
      const input = $('#inviteLink');
      try {
        await navigator.clipboard.writeText(input.value);
        toast(t('copied'));
      } catch (e) {
        input.select();
        document.execCommand('copy');
        toast(t('copied'));
      }
    });
  }

  // Copiar un enlace ya generado (desde el navegador de este owner).
  document.querySelectorAll('[data-copy-invite]').forEach((b) => {
    b.addEventListener('click', async () => {
      const email = b.dataset.copyInvite;
      const cached = getLink(email);
      if (!cached) return toast(t('linkMissing'));
      try {
        await navigator.clipboard.writeText(cached.url);
        toast(t('copied'));
      } catch (e) {
        const box = $('#inviteResult');
        if (box) { $('#inviteLink').value = cached.url; box.hidden = false; }
      }
    });
  });

  // Generar / renovar enlace de una invitación pendiente.
  document.querySelectorAll('[data-regen-invite]').forEach((b) => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await regenerate(b.dataset.regenInvite, b.dataset.regenRole);
      } catch (err) {
        toast(err.message || t('linkError'));
        b.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-role]').forEach((b) => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await API.rpc('task_set_member_role', {
          p_organization_id: ctx.organizationId,
          p_user_id: b.dataset.role,
          p_role: b.dataset.next,
        });
        ctx = await API.loadContext();
        await refresh();
        toast(t('roleSaved'));
      } catch (err) {
        toast(err.message || t('roleError'));
        b.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-remove]').forEach((b) => {
    b.addEventListener('click', async () => {
      const row = b.closest('.admin-person');
      const who = row.querySelector('.admin-person-mail').textContent.trim();
      if (!confirm(t('removeConfirm', {who}))) return;
      b.disabled = true;
      try {
        await API.rpc('task_remove_member', {
          p_organization_id: ctx.organizationId,
          p_user_id: b.dataset.remove,
        });
        ctx = await API.loadContext();
        await refresh();
        toast(t('removed'));
      } catch (err) {
        toast(err.message || t('removeError'));
        b.disabled = false;
      }
    });
  });

  const sw = $('#orgSwitch');
  if (sw) {
    sw.addEventListener('change', () => {
      API.setOrganization(sw.value);
    });
  }

  const theme = $('#themeBtn');
  if (theme) {
    theme.onclick = () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('minimal-board:theme', next); } catch (e) {}
    };
  }
}

window.TasksI18n.select($('#adminLang'));
$('#adminMain').textContent = t('loading');
$('#adminHeading').textContent = t('team');
$('#backToBoard').textContent = t('back');
window.addEventListener('tasks-language-change', () => { $('#adminLang').value = window.TasksI18n.language(); if (ctx) render(); });

// Tema guardado
try {
  const th = localStorage.getItem('minimal-board:theme');
  if (th) document.documentElement.dataset.theme = th;
} catch (e) {}

if (!API || typeof API.enabled !== 'function' || !API.enabled()) {
  $('#adminMain').innerHTML = `<div class="admin-card admin-gate">
    <h1>${esc(t('noBackend'))}</h1><p>${esc(t('noBackendHint'))}</p></div>`;
} else {
  boot();
}
})();
