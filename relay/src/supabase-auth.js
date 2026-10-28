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
export function createSupabaseVerifier({ url, anonKey, fetchImpl = fetch }) {
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

  async function verify(token) {
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
      return {
        id: user.id,
        email: user.email ?? null,
        role: user.role ?? null,
        organization: user.user_metadata?.organization_id ?? user.app_metadata?.organization_id ?? null,
      };
    } catch {
      // Supabase caído o inaccesible: el token no se puede validar.
      return null;
    }
  }

  return { available: true, verify, url: base };
}
