import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { createServer, normalizeBasePath } from '../src/server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '..', 'public');

let server;
let base;

before(async () => {
  const db = openDb(':memory:');
  const store = createStore(db);
  server = createServer({ store, basePath: '/relay' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
});

describe('montaje en un subdirectorio', () => {
  it('normaliza la ruta base', () => {
    assert.equal(normalizeBasePath(''), '');
    assert.equal(normalizeBasePath('/'), '');
    assert.equal(normalizeBasePath('relay'), '/relay');
    assert.equal(normalizeBasePath('/relay/'), '/relay');
    assert.equal(normalizeBasePath('  /relay  '), '/relay');
  });

  it('sirve la API bajo la ruta base', async () => {
    const res = await fetch(`${base}/relay/api/projects`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.projects ?? data));
  });

  it('no contesta en la raíz del origen', async () => {
    const res = await fetch(`${base}/api/projects`);
    assert.equal(res.status, 404);
  });

  it('redirige la ruta base sin barra final', async () => {
    const res = await fetch(`${base}/relay`, { redirect: 'manual' });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), '/relay/');
  });

  it('sirve el front y sus estáticos con rutas relativas', async () => {
    const page = await fetch(`${base}/relay/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /href="styles\.css"/);
    assert.match(html, /src="i18n\.js"/);
    assert.match(html, /src="app\.js"/);

    const css = await fetch(`${base}/relay/styles.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') ?? '', /text\/css/);
  });

  it('el front colgado del dominio no pide recursos de la raíz', async () => {
    const html = await readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /href="\/styles\.css"/);
    assert.doesNotMatch(html, /src="\/i18n\.js"/);
    assert.doesNotMatch(html, /src="\/app\.js"/);
  });
});
