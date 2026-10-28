/* One Supabase session for Relay, the original board and team invitations. */
(function () {
'use strict';
const API = window.DepdoitAPI;
const INVITE_KEY = 'depdoit:invite';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let context = null;
let activeLogin = null;
const params = new URLSearchParams(location.search);
if (params.get('invite')) {
  sessionStorage.setItem(INVITE_KEY, params.get('invite'));
  params.delete('invite');
  history.replaceState({}, '', location.pathname + (params.size ? '?' + params : '') + location.hash);
}

function redirectTarget() {
  const target = new URL('/', location.origin);
  const invite = sessionStorage.getItem(INVITE_KEY);
  if (invite) target.searchParams.set('invite', invite);
  return target.href;
}

function showLogin(message = '') {
  if (activeLogin) return activeLogin;
  activeLogin = new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'shared-auth';
    overlay.innerHTML = `<form class="shared-auth-card">
      <img src="/favicon-32.png" width="36" height="36" alt="Departify">
      <h1>Relay · Departify</h1><p>Entra con tu cuenta para trabajar con tu equipo.</p>
      <button type="button" class="btn btn-primary" id="shared-google">Continuar con Google</button>
      <label for="shared-email">Email</label><input id="shared-email" type="email" autocomplete="username" required>
      <button type="button" class="btn" id="shared-magic">Recibir enlace de acceso</button>
      <details><summary>Entrar con contraseña</summary>
        <label for="shared-password">Contraseña</label><input id="shared-password" type="password" autocomplete="current-password">
        <button type="submit" class="btn">Entrar</button>
      </details>
      <p role="status" id="shared-message">${esc(message)}</p>
      <small>El enlace de acceso inicia sesión. La invitación de tu equipo conserva sus permisos.</small>
    </form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const notice = overlay.querySelector('#shared-message');
    const email = overlay.querySelector('#shared-email');
    overlay.querySelector('#shared-google').onclick = () => API.signInWithGoogle(redirectTarget());
    overlay.querySelector('#shared-magic').onclick = async () => {
      if (!email.reportValidity()) return;
      const button = overlay.querySelector('#shared-magic'); button.disabled = true;
      try { await API.sendMagicLink(email.value.trim(), redirectTarget()); notice.textContent = 'Revisa tu correo y abre el enlace para entrar.'; }
      catch (error) { notice.textContent = error.message; }
      finally { button.disabled = false; }
    };
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]'); button.disabled = true;
      try {
        await API.signIn(email.value.trim(), overlay.querySelector('#shared-password').value);
        overlay.remove(); activeLogin = null; resolve();
      } catch (error) { notice.textContent = error.message; }
      finally { button.disabled = false; }
    };
  });
  return activeLogin;
}

async function ensure() {
  if (!API?.enabled()) throw new Error('El acceso del equipo no está configurado.');
  API.consumeOAuthRedirect();
  const authError = new URLSearchParams(location.hash.slice(1)).get('error_description');
  if (authError) {
    history.replaceState({}, '', location.pathname + location.search);
    await showLogin(authError);
  }
  while (!await API.token()) await showLogin();
  if (!API.currentUser()?.id) {
    const user = await API.fetchUser();
    if (!user) { API.signOut(); await showLogin('Tu sesión ha caducado. Vuelve a entrar.'); return ensure(); }
  }
  const invite = sessionStorage.getItem(INVITE_KEY);
  if (invite) {
    // Never discard a failed invitation or silently enter a different team.
    const organizationId = await API.rpc('task_redeem_invitation', { p_token: invite });
    sessionStorage.removeItem(INVITE_KEY);
    if (typeof organizationId === 'string') localStorage.setItem('depdoit:org', organizationId);
  }
  context = await API.loadContext();
  if (!context) throw new Error('Tu cuenta aún no tiene acceso a un equipo. Pide una invitación al responsable.');
  return context;
}

function mount() {
  const host = document.getElementById('workspace-access');
  if (!host || !context) return;
  host.replaceChildren();
  const org = document.createElement('select'); org.id = 'organization-select'; org.setAttribute('aria-label', 'Empresa activa');
  for (const item of context.organizations) {
    const option = document.createElement('option'); option.value = item.organizationId; option.textContent = item.name;
    option.selected = item.organizationId === context.organizationId; org.appendChild(option);
  }
  org.onchange = () => API.setOrganization(org.value);
  const team = document.createElement('a'); team.href = '/admin'; team.className = 'btn btn-ghost'; team.textContent = 'Equipo e invitaciones';
  const old = document.createElement('a'); old.href = '/board/'; old.className = 'btn btn-ghost'; old.textContent = 'Tablero anterior';
  const logout = document.createElement('button'); logout.className = 'btn btn-ghost'; logout.textContent = 'Salir';
  logout.onclick = () => { API.signOut(); location.assign('/'); };
  host.append(org, team, old, logout);
}

window.addEventListener('storage', event => {
  if (event.key === 'depdoit:session' && !event.newValue || event.key === 'depdoit:org') location.reload();
});
window.DepdoitAuth = { ensure, mount, context: () => context, showLogin };
})();
