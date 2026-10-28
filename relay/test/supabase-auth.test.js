import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { createServer } from '../src/server.js';
import { createSupabaseVerifier } from '../src/supabase-auth.js';

describe('sesión de Supabase compartida', () => {
  it('valida el token contra la API de Auth y devuelve el usuario', async () => {
    const calls = [];
    const verifier = createSupabaseVerifier({
      url: 'https://proyecto.supabase.co',
      anonKey: 'clave-anonima',
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({ id: 'user-1', email: 'ana@equipo.local' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    assert.equal(verifier.available, true);
    const user = await verifier.verify('token-valido');
    assert.equal(user.id, 'user-1');
    assert.equal(user.email, 'ana@equipo.local');
    assert.equal(calls[0].url, 'https://proyecto.supabase.co/auth/v1/user');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer token-valido');
  });

  it('devuelve null si el token no vale o falta', async () => {
    const verifier = createSupabaseVerifier({
      url: 'https://proyecto.supabase.co',
      anonKey: 'clave-anonima',
      fetchImpl: async () => new Response('{}', { status: 401 }),
    });
    assert.equal(await verifier.verify('token-caducado'), null);
    assert.equal(await verifier.verify(''), null);
  });

  it('queda deshabilitado sin url o clave', async () => {
    const verifier = createSupabaseVerifier({ url: '', anonKey: '' });
    assert.equal(verifier.available, false);
    assert.equal(await verifier.verify('lo-que-sea'), null);
  });

  it('el servidor acepta la sesión de Supabase y rechaza lo que no lo es', async () => {
    const db = openDb(':memory:');
    const store = createStore(db);
    const supabase = {
      available: true,
      verify: async (token) => (token === 'token-valido' ? { id: 'user-1' } : null),
    };
    const server = createServer({ store, supabase });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const denied = await fetch(`${base}/api/projects`);
    assert.equal(denied.status, 401);

    const wrong = await fetch(`${base}/api/projects`, { headers: { authorization: 'Bearer otro' } });
    assert.equal(wrong.status, 401);

    const allowed = await fetch(`${base}/api/projects`, { headers: { authorization: 'Bearer token-valido' } });
    assert.equal(allowed.status, 200);

    server.close();
  });

  it('el servidor con token estático y sin Supabase mantiene su comportamiento', async () => {
    const db = openDb(':memory:');
    const store = createStore(db);
    const server = createServer({ store, token: 'secreto' });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    assert.equal((await fetch(`${base}/api/projects`)).status, 401);
    assert.equal(
      (await fetch(`${base}/api/projects`, { headers: { authorization: 'Bearer secreto' } })).status,
      200
    );

    server.close();
  });
});
