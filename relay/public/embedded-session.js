/* ============================================================
   embedded-session.js — Relay dentro del Portal de Departify
   Sin dependencias. Carga antes que app.js.

   Cuando Relay se abre en `/operations/relay` del Portal, el usuario ya
   tiene sesión de Supabase en app.departify.app. Relay corre en
   tasks.departify.app (mismo proyecto Supabase, distinto origen), así que
   no puede leer ese localStorage. El Portal entrega su sesión ya
   verificada por postMessage, con targetOrigin explícito: el token nunca
   viaja en la URL.

   Reglas de seguridad:
   - Solo se aceptan mensajes cuyo `origin` esté en la lista permitida.
   - Solo se acepta `event.source === window.parent`.
   - El mensaje debe ser { type: 'departify:session', version: 1 } con un
     access_token de tipo string, y una organización de tipo string.
   ============================================================ */
(function () {
  'use strict';

  const SESSION_MESSAGE = 'departify:session';
  const SESSION_REQUEST = 'departify:session-request';
  const LOCALE_MESSAGE = 'departify:locale';
  const LOCALE_REQUEST = 'departify:locale-request';
  const VERSION = 1;
  const SESSION_KEY = 'depdoit:session';
  const ORG_KEY = 'depdoit:org';
  const DEFAULT_PARENT_ORIGINS = ['https://app.departify.app'];

  /** El Portal marca la superficie embebida con `?embedded=1`. */
  function isEmbedded(search) {
    try {
      return new URLSearchParams(search || '').get('embedded') === '1';
    } catch (e) {
      return false;
    }
  }

  /** Orígenes del Portal autorizados a entregar la sesión. */
  function parentOrigins(configured) {
    const list = Array.isArray(configured) && configured.length ? configured : DEFAULT_PARENT_ORIGINS;
    return list
      .map((value) => {
        try {
          return new URL(String(value)).origin;
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);
  }

  /**
   * Valida un mensaje recibido. Devuelve el payload de sesión o `null`.
   * Nunca lanza: un mensaje malformado se ignora.
   */
  function readSessionMessage(event, { parent, allowedOrigins } = {}) {
    if (!event || !event.data) return null;
    if (!allowedOrigins || !allowedOrigins.includes(event.origin)) return null;
    if (parent && event.source !== parent) return null;
    const data = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (data.type !== SESSION_MESSAGE || data.version !== VERSION) return null;
    const session = data.session;
    if (!session || typeof session !== 'object') return null;
    if (typeof session.access_token !== 'string' || !session.access_token) return null;
    const organizationId = typeof session.organizationId === 'string' ? session.organizationId : '';
    if (!organizationId) return null;
    const expiresAt = typeof session.expires_at === 'number' ? session.expires_at : null;
    return {
      access_token: session.access_token,
      refresh_token: typeof session.refresh_token === 'string' ? session.refresh_token : null,
      expires_at: expiresAt,
      user: session.user && typeof session.user === 'object' && typeof session.user.id === 'string'
        ? { id: session.user.id }
        : null,
      organizationId,
    };
  }

  /** Escribe la sesión con el formato que ya usa la app de tareas. */
  function storeSession(session, storage) {
    const target = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!target) return null;
    const value = {
      access_token: session.access_token,
      refresh_token: session.refresh_token || null,
      // Si el Portal no envía caducidad, se asume una hora: Supabase refresca.
      expires_at: session.expires_at || Date.now() + 3600 * 1000,
      user: session.user || null,
    };
    target.setItem(SESSION_KEY, JSON.stringify(value));
    target.setItem(ORG_KEY, session.organizationId);
    return value;
  }

  function requestSession(parent, targetOrigin) {
    if (!parent || !targetOrigin) return false;
    parent.postMessage({ type: SESSION_REQUEST, version: VERSION }, targetOrigin);
    return true;
  }

  function requestLocale(parent, targetOrigin) {
    if (!parent || !targetOrigin) return false;
    parent.postMessage({ type: LOCALE_REQUEST, version: VERSION }, targetOrigin);
    return true;
  }

  /** Idioma inicial desde `?lang=` (contrato de iframes del Portal). */
  function readLocale(search) {
    try {
      const value = new URLSearchParams(search || '').get('lang');
      return ['es', 'en', 'ro', 'hu'].includes(String(value)) ? String(value) : null;
    } catch (e) {
      return null;
    }
  }

  /** `{ locale }` de un `departify:locale` válido, o `null`. */
  function readLocaleMessage(event, { parent, allowedOrigins } = {}) {
    if (!event || !event.data) return null;
    if (!allowedOrigins || !allowedOrigins.includes(event.origin)) return null;
    if (parent && event.source !== parent) return null;
    const data = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (data.type !== LOCALE_MESSAGE || data.version !== VERSION) return null;
    if (!['es', 'en', 'ro', 'hu'].includes(String(data.locale))) return null;
    return { locale: String(data.locale) };
  }

  /**
   * Instala el puente. Devuelve `{ ready, stop }`:
   *   ready → promesa que resuelve con la sesión cuando el Portal la entrega,
   *           o rechaza al agotar el tiempo (el Portal no está, o no respondió).
   */
  function install(options = {}) {
    const parent = options.parent || (typeof window !== 'undefined' ? window.parent : null);
    const allowedOrigins = parentOrigins(options.allowedOrigins || (typeof window !== 'undefined' ? window.RELAY_PARENT_ORIGINS : undefined));
    const targetOrigin = options.targetOrigin || allowedOrigins[0];
    const timeoutMs = Number(options.timeoutMs) || 15000;
    const storage = options.storage;
    let settle;
    let timer;
    const ready = new Promise((resolve, reject) => {
      settle = { resolve, reject };
      timer = setTimeout(() => reject(new Error('Sin sesión del Portal')), timeoutMs);
    });

    function onMessage(event) {
      const session = readSessionMessage(event, { parent, allowedOrigins });
      if (session) {
        clearTimeout(timer);
        storeSession(session, storage);
        settle.resolve(session);
        return;
      }
      const locale = readLocaleMessage(event, { parent, allowedOrigins });
      if (locale && typeof options.onLocale === 'function') options.onLocale(locale.locale);
    }

    if (typeof window !== 'undefined') window.addEventListener('message', onMessage);
    requestSession(parent, targetOrigin);

    return {
      ready,
      allowedOrigins,
      targetOrigin,
      stop() {
        clearTimeout(timer);
        if (typeof window !== 'undefined') window.removeEventListener('message', onMessage);
      },
    };
  }

  const api = {
    VERSION,
    SESSION_MESSAGE,
    SESSION_REQUEST,
    LOCALE_MESSAGE,
    LOCALE_REQUEST,
    isEmbedded,
    parentOrigins,
    readSessionMessage,
    readLocale,
    readLocaleMessage,
    storeSession,
    requestSession,
    requestLocale,
    install,
  };

  if (typeof window !== 'undefined') window.RelayEmbedded = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
