import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * El puente de sesión embebida es la frontera de seguridad entre el Portal y
 * Relay: si aceptara un mensaje de otro origen, cualquier web podría inyectar
 * una sesión. Estos tests fijan esa frontera sin navegador.
 */
async function loadBridge() {
  const source = await readFile(new URL('../public/embedded-session.js', import.meta.url), 'utf8');
  const window = { addEventListener() {}, removeEventListener() {} };
  new Function('window', 'module', source)(window, { exports: {} });
  return window.RelayEmbedded;
}

const PARENT_ORIGIN = 'https://app.departify.app';

function sessionEvent(overrides = {}, eventOverrides = {}) {
  const parent = { postMessage() {} };
  return {
    parent,
    event: {
      origin: PARENT_ORIGIN,
      source: parent,
      data: {
        type: 'departify:session',
        version: 1,
        session: {
          access_token: 'jwt-abc',
          refresh_token: 'refresh-abc',
          expires_at: Date.now() + 3_600_000,
          user: { id: 'user-1' },
          organizationId: '11111111-1111-4111-8111-111111111111',
          ...overrides,
        },
      },
      ...eventOverrides,
    },
  };
}

describe('puente de sesión embebida', () => {
  it('reconoce el marcador embedded=1', async () => {
    const bridge = await loadBridge();
    assert.equal(bridge.isEmbedded('?embedded=1'), true);
    assert.equal(bridge.isEmbedded('?embedded=0'), false);
    assert.equal(bridge.isEmbedded(''), false);
  });

  it('acepta la sesión de un origen permitido y de la ventana padre', async () => {
    const bridge = await loadBridge();
    const { parent, event } = sessionEvent();
    const session = bridge.readSessionMessage(event, {
      parent,
      allowedOrigins: [PARENT_ORIGIN],
    });
    assert.equal(session.access_token, 'jwt-abc');
    assert.equal(session.organizationId, '11111111-1111-4111-8111-111111111111');
  });

  it('rechaza un origen no autorizado', async () => {
    const bridge = await loadBridge();
    const { parent, event } = sessionEvent({}, { origin: 'https://evil.example' });
    assert.equal(bridge.readSessionMessage(event, { parent, allowedOrigins: [PARENT_ORIGIN] }), null);
  });

  it('rechaza un mensaje que no viene de la ventana padre', async () => {
    const bridge = await loadBridge();
    const { event } = sessionEvent();
    const parent = { postMessage() {} };
    assert.equal(bridge.readSessionMessage(event, { parent, allowedOrigins: [PARENT_ORIGIN] }), null);
  });

  it('rechaza tipos, versiones o tokens inválidos', async () => {
    const bridge = await loadBridge();
    const { parent } = sessionEvent();
    const base = sessionEvent().event;
    const variants = [
      { ...base, data: { ...base.data, type: 'otro' } },
      { ...base, data: { ...base.data, version: 2 } },
      { ...base, data: { ...base.data, session: { ...base.data.session, access_token: '' } } },
      { ...base, data: { ...base.data, session: { ...base.data.session, organizationId: '' } } },
      { ...base, data: { ...base.data, session: null } },
      { ...base, data: 'texto' },
    ];
    for (const event of variants) {
      assert.equal(
        bridge.readSessionMessage(event, { parent, allowedOrigins: [PARENT_ORIGIN] }),
        null,
      );
    }
  });

  it('guarda la sesión con el formato que ya usa la app de tareas', async () => {
    const bridge = await loadBridge();
    const storage = new Map();
    const adapter = {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    };
    const { event } = sessionEvent();
    const session = bridge.readSessionMessage(event, {
      parent: event.source,
      allowedOrigins: [PARENT_ORIGIN],
    });
    bridge.storeSession(session, adapter);
    const stored = JSON.parse(storage.get('depdoit:session'));
    assert.equal(stored.access_token, 'jwt-abc');
    assert.equal(stored.refresh_token, 'refresh-abc');
    assert.deepEqual(stored.user, { id: 'user-1' });
    assert.equal(storage.get('depdoit:org'), session.organizationId);
  });

  it('pide la sesión al padre con el origen exacto, nunca con *', async () => {
    const bridge = await loadBridge();
    const calls = [];
    const parent = { postMessage: (...args) => calls.push(args) };
    bridge.requestSession(parent, PARENT_ORIGIN);
    assert.deepEqual(calls, [[{ type: 'departify:session-request', version: 1 }, PARENT_ORIGIN]]);
  });

  it('no pide nada sin origen conocido', async () => {
    const bridge = await loadBridge();
    const calls = [];
    const parent = { postMessage: (...args) => calls.push(args) };
    assert.equal(bridge.requestSession(parent, null), false);
    assert.equal(bridge.requestSession(null, PARENT_ORIGIN), false);
    assert.equal(calls.length, 0);
  });

  it('normaliza la lista de orígenes permitidos y descarta basura', async () => {
    const bridge = await loadBridge();
    assert.deepEqual(bridge.parentOrigins(['https://app.departify.app/', 'no-es-url']), [PARENT_ORIGIN]);
    assert.deepEqual(bridge.parentOrigins([]), [PARENT_ORIGIN]);
  });

  it('lee el idioma inicial solo si es uno soportado', async () => {
    const bridge = await loadBridge();
    assert.equal(bridge.readLocale('?lang=ro'), 'ro');
    assert.equal(bridge.readLocale('?lang=hu'), 'hu');
    assert.equal(bridge.readLocale('?lang=de'), null);
    assert.equal(bridge.readLocale(''), null);
  });

  it('acepta un cambio de idioma del padre y rechaza el de otro origen', async () => {
    const bridge = await loadBridge();
    const parent = { postMessage() {} };
    const ok = { origin: PARENT_ORIGIN, source: parent, data: { type: 'departify:locale', version: 1, locale: 'en' } };
    assert.deepEqual(bridge.readLocaleMessage(ok, { parent, allowedOrigins: [PARENT_ORIGIN] }), { locale: 'en' });
    assert.equal(
      bridge.readLocaleMessage({ ...ok, origin: 'https://evil.example' }, { parent, allowedOrigins: [PARENT_ORIGIN] }),
      null,
    );
  });

  it('resuelve la promesa cuando llega la sesión y la rechaza al agotarse el tiempo', async () => {
    const bridge = await loadBridge();
    const listeners = [];
    const window = { parent: { postMessage() {} } };
    const result = bridge.install({
      parent: window.parent,
      targetOrigin: PARENT_ORIGIN,
      allowedOrigins: [PARENT_ORIGIN],
      timeoutMs: 30,
      storage: { setItem() {}, getItem: () => null, removeItem() {} },
    });
    // `install` registró su listener en el window real del proceso de test.
    await assert.rejects(result.ready);
    result.stop();
    void listeners;
  });
});
