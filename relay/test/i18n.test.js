import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { createServer } from '../src/server.js';

let server;
let base;
let store;

before(async () => {
  const db = openDb(':memory:');
  store = createStore(db);
  server = createServer({ store });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
});

async function waitFor(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return false;
}

describe('diccionarios de la interfaz', () => {
  it('mantiene las mismas claves en los cuatro idiomas', async () => {
    const source = await readFile(new URL('../public/i18n.js', import.meta.url), 'utf8');
    const sandbox = { window: {} };
    new Function('window', source)(sandbox.window);

    const dicts = sandbox.window.RELAY_I18N;
    const langs = sandbox.window.RELAY_LANGS.map((lang) => lang.code);
    assert.deepEqual(langs, ['es', 'en', 'ro', 'hu']);

    const reference = Object.keys(dicts.es).sort();
    assert.ok(reference.length > 50, 'el diccionario debe tener cobertura real');
    for (const lang of ['en', 'ro', 'hu']) {
      assert.deepEqual(Object.keys(dicts[lang]).sort(), reference, `las claves de ${lang} deben coincidir con es`);
    }
  });

  it('no deja ninguna cadena de traducción vacía', async () => {
    const source = await readFile(new URL('../public/i18n.js', import.meta.url), 'utf8');
    const sandbox = { window: {} };
    new Function('window', source)(sandbox.window);
    for (const [lang, dict] of Object.entries(sandbox.window.RELAY_I18N)) {
      for (const [key, value] of Object.entries(dict)) {
        assert.equal(typeof value, 'string', `${lang}.${key} debe ser texto`);
        assert.ok(value.trim().length > 0, `${lang}.${key} no puede estar vacía`);
      }
    }
  });
});

describe('traducción automática', () => {
  it('prepara un proyecto para las pruebas de traducción', async () => {
    const res = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'I18', name: 'Traducción' }),
    });
    assert.equal(res.status, 200);
  });

  it('traduce sola la incidencia recién creada al resto de idiomas', async () => {
    const db = openDb(':memory:');
    const localStore = createStore(db);
    const translator = {
      available: true,
      provider: 'test',
      translate: async ({ summary, targetLang }) => ({
        summary: `${targetLang}:${summary}`,
        description: `desc-${targetLang}`,
        provider: 'test',
      }),
    };
    const localServer = createServer({ store: localStore, translator });
    await new Promise((resolve) => localServer.listen(0, '127.0.0.1', resolve));
    const localBase = `http://127.0.0.1:${localServer.address().port}`;

    const post = (path, body) =>
      fetch(`${localBase}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then((res) => res.json());

    await post('/api/projects', { key: 'TST', name: 'Test' });
    const created = await post('/api/issues', { projectKey: 'TST', summary: 'Hola' });

    assert.equal(created.key, 'TST-1');
    assert.equal(created.sourceLang, 'es');
    assert.equal(created.translationsPending, 3, 'faltan los tres idiomas distintos del original');

    const done = await waitFor(async () => {
      const issue = await fetch(`${localBase}/api/issues/TST-1`).then((res) => res.json());
      return issue.translationsPending === 0;
    });
    assert.equal(done, true, 'las traducciones deben completarse en segundo plano');

    const issue = await fetch(`${localBase}/api/issues/TST-1`).then((res) => res.json());
    assert.equal(issue.translations.en.summary, 'en:Hola');
    assert.equal(issue.translations.ro.summary, 'ro:Hola');
    assert.equal(issue.translations.hu.summary, 'hu:Hola');
    assert.equal(issue.translations.en.description, 'desc-en');
    assert.equal(issue.translations.es, undefined, 'el idioma original no se traduce');

    localServer.close();
  });

  it('guarda y borra traducciones escritas a mano', async () => {
    const created = await fetch(`${base}/api/issues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectKey: 'I18', summary: 'Manual' }),
    }).then((res) => res.json());

    const saved = await fetch(`${base}/api/issues/${created.key}/translations/hu`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ summary: 'Kézi', description: 'leiras' }),
    }).then((res) => res.json());
    assert.equal(saved.translations.hu.summary, 'Kézi');

    const listed = await fetch(`${base}/api/issues/${created.key}/translations`).then((res) => res.json());
    assert.equal(listed.hu.summary, 'Kézi');

    const removed = await fetch(`${base}/api/issues/${created.key}/translations/hu`, { method: 'DELETE' }).then((res) =>
      res.json()
    );
    assert.equal(removed.translations.hu, undefined);
  });

  it('rechaza un idioma no soportado', async () => {
    const created = await fetch(`${base}/api/issues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectKey: 'I18', summary: 'Idioma' }),
    }).then((res) => res.json());

    const res = await fetch(`${base}/api/issues/${created.key}/translations/fr`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ summary: 'Bonjour' }),
    });
    assert.equal(res.status, 400);
  });
});

describe('acceso con token', () => {
  it('exige credencial cuando el servidor tiene token', async () => {
    const db = openDb(':memory:');
    const localStore = createStore(db);
    const localServer = createServer({ store: localStore, token: 'secreto' });
    await new Promise((resolve) => localServer.listen(0, '127.0.0.1', resolve));
    const localBase = `http://127.0.0.1:${localServer.address().port}`;

    const denied = await fetch(`${localBase}/api/projects`);
    assert.equal(denied.status, 401);

    const allowed = await fetch(`${localBase}/api/projects`, { headers: { authorization: 'Bearer secreto' } });
    assert.equal(allowed.status, 200);

    const wrong = await fetch(`${localBase}/api/projects`, { headers: { authorization: 'Bearer otro' } });
    assert.equal(wrong.status, 401);

    // La interfaz se sigue sirviendo para que pueda pedir el token.
    const shell = await fetch(`${localBase}/`);
    assert.equal(shell.status, 200);

    localServer.close();
  });
});
