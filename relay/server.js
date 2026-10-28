import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './src/db.js';
import { createStore } from './src/store.js';
import { createServer } from './src/server.js';
import { createTranslator } from './src/translate.js';
import { createSupabaseVerifier } from './src/supabase-auth.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4310;
const HOST = process.env.HOST || '127.0.0.1';
const DB_FILE = process.env.RELAY_DB || path.join(ROOT, 'data', 'relay.db');

mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = openDb(DB_FILE);
const store = createStore(db);
const translator = createTranslator(process.env);
const token = process.env.RELAY_TOKEN?.trim() || null;
const supabase = createSupabaseVerifier({
  url: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY,
});
const server = createServer({ store, translator, token, supabase });

server.listen(PORT, HOST, () => {
  console.log(`Relay escuchando en http://${HOST}:${PORT}`);
  console.log(`Base de datos local: ${DB_FILE}`);
  console.log(
    translator.available
      ? `Traducción automática: ${translator.provider} (nuevas incidencias se traducen solas)`
      : 'Traducción automática: desactivada (sin LLM_API_KEY). Las traducciones se escriben a mano.'
  );
  if (supabase.available) {
    console.log(`Acceso: sesión de Supabase (${supabase.url}) — misma que la app de tareas.`);
  } else if (token) {
    console.log('Acceso protegido: la API exige RELAY_TOKEN.');
  } else if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.warn('ATENCIÓN: escuchando fuera de localhost sin credencial. cualquiera con la URL puede leer y escribir datos.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
