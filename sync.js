/* ============================================================
   sync.js — puente entre la app y el backend de tareas
   ============================================================
   Decisiones:

   1. Los ids se generan en el cliente como UUID v4 (ver uid() en app.js).
      Así el id local ES el id del servidor desde el primer instante: no hay
      tabla de traducción que se pueda desincronizar.

   2. Un único punto de enganche: mutate() en app.js calcula el antes y el
      después del estado y llama a onDiff(). No se instrumenta cada handler
      por separado, así que ningún camino nuevo puede "olvidarse" de guardar.

   3. El estado local manda para pintar. La red va detrás: si falla, la
      operación se encola y se reintenta. La app nunca se queda bloqueada
      esperando al servidor.

   4. Sin backend configurado, o si el servidor falla, la app sigue
      funcionando en local (modo original). No se rompe la promesa del
      proyecto: abrir y trabajar.
   ============================================================ */
(function () {
'use strict';

const API = window.DepdoitAPI;
let ctx = null;
let overlay = null;
let queue = [];
let flushing = false;

const enabled = () => Boolean(API && API.enabled());
const members = () => (ctx ? ctx.members : []);

/* ── Pantalla de acceso ───────────────────────────────── */

function showLogin(onDone) {
  if (overlay) overlay.remove();

  // Mientras se pide el login, el tablero local no debe verse detrás: confunde
  // (parece que ya hay datos de la empresa cuando son de demo).
  document.body.classList.add('auth-locked');

  overlay = document.createElement('div');
  overlay.className = 'auth-overlay';
  overlay.innerHTML = `
    <form class="auth-card" id="authForm" autocomplete="on">
      <img class="auth-logo" src="/favicon-32.png" alt="" width="40" height="40">
      <h1 class="auth-title">Tareas</h1>
      <p class="auth-sub">Entra para ver las tareas de tu empresa.</p>
      <label class="field-label" for="authEmail">Email</label>
      <input class="input" id="authEmail" type="email" autocomplete="username" required>
      <label class="field-label" for="authPass">Contraseña</label>
      <input class="input" id="authPass" type="password" autocomplete="current-password" required>
      <p class="auth-error" id="authError" hidden></p>
      <button class="btn btn-primary auth-submit" type="submit">Entrar</button>
      <div class="auth-sep"><span>o</span></div>
      <button class="btn auth-google" type="button" id="authGoogle">
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.3 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.5 7l7.6 5.9c4.4-4.1 6.6-10.1 6.6-17.4z"/><path fill="#FBBC05" d="M10.4 28.7a14.5 14.5 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.8 2.3-8.3 2.3-6.4 0-11.7-3.8-13.6-9.1l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
        Entrar con Google
      </button>
      <p class="auth-alt">¿Sin cuenta?
        <button type="button" class="link-btn" id="authSwap">Crear una</button>
      </p>
      <button type="button" class="link-btn auth-local" id="authLocal">Seguir sin cuenta (local)</button>
    </form>`;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('#authForm');
  const errEl = overlay.querySelector('#authError');
  const submit = overlay.querySelector('button[type="submit"]');
  let mode = 'signin';

  overlay.querySelector('#authSwap').addEventListener('click', () => {
    mode = mode === 'signin' ? 'signup' : 'signin';
    submit.textContent = mode === 'signin' ? 'Entrar' : 'Crear cuenta';
    overlay.querySelector('#authSwap').textContent = mode === 'signin' ? 'Crear una' : 'Entrar';
    errEl.hidden = true;
  });

  const googleBtn = overlay.querySelector('#authGoogle');
  if (googleBtn) {
    googleBtn.addEventListener('click', () => {
      // Vuelve a esta misma página; el token llega en el fragmento de la URL.
      API.signInWithGoogle(location.origin + '/');
    });
  }

  overlay.querySelector('#authLocal').addEventListener('click', () => {
    overlay.remove();
    overlay = null;
    document.body.classList.remove('auth-locked');
    onDone(false);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    submit.disabled = true;
    const email = overlay.querySelector('#authEmail').value.trim();
    const password = overlay.querySelector('#authPass').value;
    try {
      if (mode === 'signin') await API.signIn(email, password);
      else await API.signUp(email, password);
      overlay.remove();
      overlay = null;
      document.body.classList.remove('auth-locked');
      onDone(true);
    } catch (err) {
      errEl.textContent = err.message || 'No se pudo entrar.';
      errEl.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
}

/* ── Cola de escritura ────────────────────────────────── */

function push(op) {
  if (!enabled() || !ctx) return;
  queue.push(op);
  flush();
}

async function flush() {
  if (flushing || !queue.length) return;
  flushing = true;
  try {
    while (queue.length) {
      await queue[0]();
      queue.shift();
    }
  } catch (err) {
    console.warn('[sync] pendiente:', err.message);
  } finally {
    flushing = false;
  }
}

window.addEventListener('online', () => flush());
document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });

/* ── Diff: qué cambió entre dos fotos del estado ──────── */

function diff(before, after) {
  const ops = [];

  // Tableros nuevos
  for (const id of after.boardOrder) {
    if (!before.boards[id]) {
      const b = after.boards[id];
      ops.push(() => API.createBoard(ctx.organizationId, b.name, id));
    }
  }

  // Listas nuevas (después de los tableros: respeta la FK)
  for (const id of Object.keys(after.lists)) {
    if (!before.lists[id]) {
      const l = after.lists[id];
      const pos = (after.boards[l.boardId]?.lists || []).indexOf(id);
      ops.push(() => API.createList(l.boardId, l.name, pos < 0 ? 0 : pos, l.wip, id));
    }
  }

  // Tarjetas nuevas
  for (const id of Object.keys(after.cards)) {
    if (!before.cards[id]) {
      const c = after.cards[id];
      const pos = (after.lists[c.listId]?.cards || []).indexOf(id);
      ops.push(() => API.createCard(c.listId, {
        id,
        title: c.name,
        description: c.desc,
        start: c.start,
        end: c.end,
        kind: c.kind,
        severity: c.severity,
        expected: c.expected,
        actual: c.actual,
        position: pos < 0 ? 0 : pos,
      }));
    }
  }

  // Tarjetas borradas
  for (const id of Object.keys(before.cards)) {
    if (!after.cards[id]) ops.push(() => API.archiveCard(id));
  }

  // Tarjetas modificadas o movidas
  for (const id of Object.keys(after.cards)) {
    const a = after.cards[id];
    const b = before.cards[id];
    if (!b) continue;

    if (b.listId !== a.listId) {
      const pos = (after.lists[a.listId]?.cards || []).indexOf(id);
      ops.push(() => API.moveCard(id, a.listId, pos < 0 ? 0 : pos));
    }
    if (b.name !== a.name || b.desc !== a.desc || b.start !== a.start ||
        b.end !== a.end || Boolean(b.done) !== Boolean(a.done)) {
      ops.push(() => API.updateCard(id, {
        title: a.name,
        description: a.desc,
        start: a.start,
        end: a.end,
        completed: Boolean(a.done),
      }));
    }

    // Evidencia de QA: se envía aparte para no reescribir campos que la
    // persona no ha tocado.
    if (b.kind !== a.kind || b.severity !== a.severity ||
        b.expected !== a.expected || b.actual !== a.actual) {
      ops.push(() => API.updateCard(id, {
        kind: a.kind,
        severity: a.severity,
        expected: a.expected,
        actual: a.actual,
      }));
    }
  }

  return ops;
}

/* ── API pública ──────────────────────────────────────── */

const sync = {
  enabled,
  members,
  context: () => ctx,

  /**
   * Arranque del backend.
   * done(state, ctx|null) → state es el tablero del servidor, o null si se
   * trabaja en local. Toda la función es tolerante a fallos: si algo va mal,
   * se cae a modo local en vez de dejar la app en blanco.
   */
  async boot(done) {
    if (!enabled()) return done(null, null);

    // ¿Está el backend migrado? Si no, se trabaja en local y se avisa una vez.
    // Sin esto, el usuario vería un login que no puede funcionar.
    // Vuelta de Google: el token viene en el fragmento de la URL.
    API.consumeOAuthRedirect();
    if (API.readSession() && !(API.currentUser() || {}).id) {
      await API.fetchUser();
    }

    const ready = await API.health();
    if (!ready) {
      if (window.DepdoitUI && window.DepdoitUI.toast) {
        window.DepdoitUI.toast('El servidor de tareas aún no está activado. Trabajas en local.');
      }
      return done(null, null);
    }

    // Enlace de invitación: /?invite=TOKEN
    // Se guarda antes de cualquier redirección porque el login recarga la página.
    const params = new URLSearchParams(location.search);
    const inviteToken = params.get('invite');
    if (inviteToken) {
      try { sessionStorage.setItem('depdoit:invite', inviteToken); } catch (e) {}
    }

    if (!API.readSession()) {
      showLogin((ok) => (ok ? sync.boot(done) : done(null, null)));
      return;
    }

    // Con sesión: primero canjear la invitación si venía en la URL.
    let pendingInvite = null;
    try { pendingInvite = sessionStorage.getItem('depdoit:invite'); } catch (e) {}
    if (pendingInvite) {
      try {
        await API.rpc('task_redeem_invitation', { p_token: pendingInvite });
        try { sessionStorage.removeItem('depdoit:invite'); } catch (e) {}
        if (window.DepdoitUI && window.DepdoitUI.toast) {
          window.DepdoitUI.toast('Ya formas parte de la empresa.');
        }
        // Se limpia el parámetro para que recargar no reintente un token usado.
        history.replaceState({}, '', location.pathname);
      } catch (err) {
        // Token caducado o de otro email: se avisa y se sigue con lo que haya.
        if (window.DepdoitUI && window.DepdoitUI.toast) {
          window.DepdoitUI.toast(err.message || 'La invitación no es válida.');
        }
        try { sessionStorage.removeItem('depdoit:invite'); } catch (e) {}
      }
    }

    try {
      ctx = await API.loadContext();
    } catch (err) {
      if (err.status === 401) {
        API.signOut();
        showLogin((ok) => (ok ? sync.boot(done) : done(null, null)));
        return;
      }
      // Servidor caído o tablas sin migrar: no se bloquea al usuario.
      console.warn('[sync] sin contexto:', err.message);
      return done(null, null);
    }

    if (!ctx) return done(null, null);

    let state = null;
    try {
      state = await API.loadBoard(ctx.organizationId);
    } catch (err) {
      console.warn('[sync] sin tablero:', err.message);
    }

    done(state, ctx);
  },

  /** Se llama desde mutate() con el antes y el después. */
  onDiff(before, after) {
    if (!enabled() || !ctx) return;
    for (const op of diff(before, after)) push(op);
  },

  /**
   * Guarda la evidencia de una tarjeta. Se llama al salir del campo, no en
   * cada tecla: no tiene sentido una petición por carácter.
   */
  async saveEvidence(card) {
    if (!enabled() || !ctx || !card) return;
    try {
      await API.updateCard(card.id, {
        kind: card.kind || 'task',
        severity: card.severity || null,
        expected: card.expected || '',
        actual: card.actual || '',
      });
    } catch (err) {
      console.warn('[sync] evidencia no guardada:', err.message);
      if (window.DepdoitUI && window.DepdoitUI.toast) {
        window.DepdoitUI.toast('No se pudo guardar la evidencia');
      }
    }
  },

  /** Marca la tarjeta como verificada. */
  async verify(cardId) {
    if (!enabled() || !ctx) return;
    return API.verifyCard(cardId);
  },

  async assign(cardId, userId, isAssigned) {
    if (isAssigned) {
      return API.assign(cardId, userId);
    }
    return API.unassign(cardId, userId);
  },

  signOut() {
    API.signOut();
    location.reload();
  },
};

window.DepdoitSync = sync;
})();
