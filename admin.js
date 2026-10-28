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
      <h1>Equipo</h1>
      <p>Entra con tu cuenta para gestionar quién tiene acceso.</p>
      <a class="btn btn-primary" href="/">Ir al tablero e iniciar sesión</a>
    </div>`;
    return;
  }

  try {
    ctx = await API.loadContext();
  } catch (err) {
    main.innerHTML = `<div class="admin-card admin-gate">
      <h1>No se pudo cargar</h1><p>${esc(err.message)}</p>
      <button class="btn" id="retry">Reintentar</button></div>`;
    $('#retry').addEventListener('click', boot);
    return;
  }

  if (!ctx) {
    main.innerHTML = `<div class="admin-card admin-gate">
      <h1>Sin empresa</h1><p>Tu cuenta no pertenece a ninguna empresa.</p></div>`;
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
        title="Empresa activa" aria-label="Empresa activa">
        ${orgs.map((o) => `<option value="${o.organizationId}"
          ${o.organizationId === ctx.organizationId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
      </select>`;
  } else {
    $('#adminHeading').textContent = ctx.organizationName || 'Equipo';
  }

  main.innerHTML = `
    ${isOwner ? renderInviteCard() : renderReadOnlyNotice()}

    <section class="admin-card">
      <h2 class="admin-h2">Personas con acceso <span class="admin-count">${ctx.members.length}</span></h2>
      <div class="admin-people">
        ${ctx.members.map((m) => renderMemberRow(m, isOwner)).join('')}
      </div>
    </section>

    ${isOwner && invitations.length ? renderPendingCard() : ''}
  `;

  bind();
}

function renderReadOnlyNotice() {
  return `<div class="admin-card admin-notice">
      <p>Ves el equipo, pero solo el propietario de la empresa puede invitar,
      cambiar roles o dar de baja.</p>
    </div>`;
}

function renderInviteCard() {
  return `<section class="admin-card">
      <h2 class="admin-h2">Invitar a alguien</h2>
      <p class="admin-help">Se genera un enlace de un solo uso, válido 7 días.
      Cópialo y mándalo tú: por WhatsApp, por email, como prefieras.</p>
      <form class="admin-form" id="inviteForm">
        <input class="input" id="inviteEmail" type="email" placeholder="persona@empresa.com"
               autocomplete="off" required>
        <select class="input select" id="inviteRole">
          <option value="member">Miembro</option>
          <option value="owner">Propietario</option>
        </select>
        <button class="btn btn-primary" type="submit" id="inviteSubmit">Crear enlace</button>
      </form>
      <div class="admin-invite-result" id="inviteResult" hidden>
        <label class="field-label" for="inviteLink">Enlace de invitación</label>
        <div class="admin-link-row">
          <input class="input" id="inviteLink" readonly>
          <button class="btn" id="copyLink" type="button">Copiar</button>
        </div>
        <p class="admin-hint">Si lo reenvías, solo funcionará con la cuenta
        de <strong id="inviteFor"></strong>.</p>
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
        <span class="admin-person-mail">${esc(m.email)}${isMe ? ' <span class="admin-you">(tú)</span>' : ''}</span>
        <span class="admin-person-role ${isOwnerRow ? 'is-owner' : ''}">${isOwnerRow ? 'Propietario' : 'Miembro'}</span>
      </div>
      ${isOwner ? `<div class="admin-person-actions">
        <button class="btn btn-sm" data-role="${m.user_id}" data-next="${isOwnerRow ? 'member' : 'owner'}">
          ${isOwnerRow ? 'Hacer miembro' : 'Hacer propietario'}
        </button>
        ${!isOwnerRow && !isMe ? `<button class="btn btn-sm btn-danger" data-remove="${m.user_id}">Quitar</button>` : ''}
      </div>` : ''}
    </div>`;
}

function renderPendingCard() {
  return `<section class="admin-card">
      <h2 class="admin-h2">Invitaciones pendientes</h2>
      <p class="admin-help">El enlace no se puede recuperar del servidor (solo
      se guarda su huella). Si lo perdiste, genera uno nuevo: el anterior deja
      de funcionar.</p>
      <div class="admin-people">
        ${invitations.map((i) => {
          const cached = getLink(i.email);
          return `<div class="admin-person">
            <span class="assignee-avatar admin-avatar admin-avatar-pending">?</span>
            <div class="admin-person-info">
              <span class="admin-person-mail">${esc(i.email)}</span>
              <span class="admin-person-role">${i.expired ? 'Caducada' : 'Pendiente'} ·
                ${i.role === 'owner' ? 'Propietario' : 'Miembro'}</span>
            </div>
            <div class="admin-person-actions">
              ${cached
                ? `<button class="btn btn-sm" data-copy-invite="${esc(i.email)}">Copiar enlace</button>
                   <button class="btn btn-sm" data-regen-invite="${esc(i.email)}"
                     data-regen-role="${i.role}">Nuevo</button>`
                : `<button class="btn btn-sm btn-primary" data-regen-invite="${esc(i.email)}"
                     data-regen-role="${i.role}">Generar enlace</button>`}
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
  toast('Enlace nuevo generado. El anterior ya no sirve.');
}

/* ── Eventos ──────────────────────────────────────────── */

function bind() {
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
        toast('Enlace creado. Cópialo y mándalo.');
      } catch (err) {
        toast(err.message || 'No se pudo crear la invitación');
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
        toast('Enlace copiado');
      } catch (e) {
        input.select();
        document.execCommand('copy');
        toast('Enlace copiado');
      }
    });
  }

  // Copiar un enlace ya generado (desde el navegador de este owner).
  document.querySelectorAll('[data-copy-invite]').forEach((b) => {
    b.addEventListener('click', async () => {
      const email = b.dataset.copyInvite;
      const cached = getLink(email);
      if (!cached) return toast('Ese enlace no está en este navegador. Genera uno nuevo.');
      try {
        await navigator.clipboard.writeText(cached.url);
        toast('Enlace copiado');
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
        toast(err.message || 'No se pudo generar el enlace');
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
        toast('Rol actualizado');
      } catch (err) {
        toast(err.message || 'No se pudo cambiar el rol');
        b.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-remove]').forEach((b) => {
    b.addEventListener('click', async () => {
      const row = b.closest('.admin-person');
      const who = row.querySelector('.admin-person-mail').textContent.trim();
      if (!confirm(`¿Quitar a ${who} de la empresa?\n\nSus tareas asignadas quedarán sin asignar.`)) return;
      b.disabled = true;
      try {
        await API.rpc('task_remove_member', {
          p_organization_id: ctx.organizationId,
          p_user_id: b.dataset.remove,
        });
        ctx = await API.loadContext();
        await refresh();
        toast('Persona dada de baja');
      } catch (err) {
        toast(err.message || 'No se pudo dar de baja');
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
    theme.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('minimal-board:theme', next); } catch (e) {}
    });
  }
}

// Tema guardado
try {
  const th = localStorage.getItem('minimal-board:theme');
  if (th) document.documentElement.dataset.theme = th;
} catch (e) {}

if (!API || typeof API.enabled !== 'function' || !API.enabled()) {
  $('#adminMain').innerHTML = `<div class="admin-card admin-gate">
    <h1>Sin backend</h1><p>Este despliegue no tiene backend configurado.</p></div>`;
} else {
  boot();
}
})();
