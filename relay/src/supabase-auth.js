/**
 * Verificador de sesión Supabase.
 *
 * La app de tareas (tasks.departify.app) ya autentica contra Supabase con
 * email+contraseña y Google OAuth, y guarda la sesión en
 * `localStorage['depdoit:session']`. Si Relay se sirve en el mismo origen,
 * lee esa misma sesión: no hay un segundo login, ni un segundo sistema de
 * invitaciones, ni que volver a apuntar nada.
 *
 * El token se valida contra la API de Auth de Supabase (igual que hace el
 * cliente de la app de tareas), no contra una tabla propia.
 */
export function createSupabaseVerifier({ url, anonKey, fetchImpl = fetch, requireMembership = false }) {
  const base = String(url || '').replace(/\/+$/, '');
  const key = String(anonKey || '');
  const available = Boolean(base && key);

  if (!available) {
    return {
      available: false,
      async verify() {
        return null;
      },
    };
  }

  async function verify(token, organizationId) {
    if (!token) return null;
    try {
      const response = await fetchImpl(`${base}/auth/v1/user`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return null;
      const user = await response.json().catch(() => null);
      if (!user?.id) return null;
      let membership = null;
      if (requireMembership) {
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(organizationId || '')) return null;
        const members = await fetchImpl(`${base}/rest/v1/organization_memberships?select=organization_id,role&user_id=eq.${encodeURIComponent(user.id)}&organization_id=eq.${organizationId}`, {
          headers: { apikey: key, Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!members.ok) return null;
        const rows = await members.json();
        membership = Array.isArray(rows) && rows.find(row => row.organization_id.toLowerCase() === organizationId.toLowerCase());
        if (!membership) return null;
      }
      return {
        id: user.id,
        email: user.email ?? null,
        role: membership?.role ?? user.role ?? null,
        organization: membership?.organization_id ?? null,
      };
    } catch {
      // Supabase caído o inaccesible: el token no se puede validar.
      return null;
    }
  }

  async function rest(token, route, init = {}) {
    const response = await fetchImpl(`${base}/rest/v1/${route}`, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('No se pudieron cargar los datos del equipo');
    return response.json();
  }
  async function members(token, organizationId) {
    return rest(token, 'rpc/task_list_members', { method: 'POST', body: JSON.stringify({ p_organization_id: organizationId }) });
  }
  async function legacyBoards(token, organizationId) {
    // PostgREST paginates; never silently truncate the imported board at 1000 rows.
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const page = await rest(token, `task_board_view?select=*&organization_id=eq.${organizationId}&order=board_id.asc,list_position.asc,card_position.asc,card_id.asc&limit=500&offset=${offset}`);
      if (!Array.isArray(page)) throw new Error('Invalid legacy board response');
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  }
  return { available: true, verify, members, legacyBoards, url: base };
}
