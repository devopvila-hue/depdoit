import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.js';
import { HttpError } from './errors.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.resolve(HERE, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const MAX_BODY = 2 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Cuerpo de la petición demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new HttpError(400, 'JSON inválido en el cuerpo de la petición'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(PUBLIC_DIR, relative);
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Prohibido');
    return;
  }
  try {
    const data = await readFile(target);
    const type = MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'content-length': data.length,
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No encontrado');
  }
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Crea el servidor HTTP de Relay.
 * @param {{store: object, translator?: object, token?: string, supabase?: object, publicDir?: string}} options
 */
export function createServer({ store, translator, token, supabase, publicDir = PUBLIC_DIR }) {
  const api = createApi(store, { translator });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const { pathname, searchParams } = url;

    if (!pathname.startsWith('/api/')) {
      await serveStatic(res, pathname);
      return;
    }

    // Acceso: con Supabase configurado se valida su sesión (misma que usa la
    // app de tareas); si no, sirve el token estático de RELAY_TOKEN.
    const header = req.headers.authorization ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

    if (supabase?.available) {
      const user = await supabase.verify(bearer);
      if (!user) {
        sendJson(res, 401, { error: 'Sesión no válida o ausente' });
        return;
      }
      req.user = user;
    } else if (token) {
      const provided = bearer || readCookie(req, 'relay_token');
      if (provided !== token) {
        sendJson(res, 401, { error: 'Token de acceso inválido o ausente' });
        return;
      }
    }

    try {
      const match = api.match(req.method, pathname);
      if (!match) throw new HttpError(404, `Ruta no encontrada: ${req.method} ${pathname}`);
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
      const query = Object.fromEntries(searchParams.entries());
      const result = await match.handler({ params: match.params, query, body, store });
      sendJson(res, req.method === 'POST' && result?.created ? 201 : 200, result ?? { ok: true });
    } catch (error) {
      if (error?.message === '__method__') {
        sendJson(res, 405, { error: `Método no permitido: ${req.method} ${pathname}` });
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) console.error('[relay] error interno:', error);
      sendJson(res, status, {
        error: error?.message ?? 'Error interno',
        ...(error?.details ? { details: error.details } : {}),
      });
    }
  });

  server.publicDir = publicDir;
  return server;
}
