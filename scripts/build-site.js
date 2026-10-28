import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
const out = new URL('../site/', import.meta.url);
const root = new URL('../', import.meta.url);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(new URL('relay/public/', root), out, { recursive: true });
for (const name of ['board', 'admin.html', 'admin.js', 'backend-client.js', 'auth.js', 'auth.css', 'sync.js', 'favicon.ico', 'favicon-32.png', 'apple-touch-icon.png']) {
  cpSync(new URL(name, root), new URL(name, out), { recursive: true });
}
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (url && key) {
  writeFileSync(new URL('config.js', out), `window.DEPDOIT_CONFIG = ${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key })};\n`);
} else if (existsSync(new URL('config.js', root))) {
  cpSync(new URL('config.js', root), new URL('config.js', out));
} else {
  throw new Error('Configure SUPABASE_URL and SUPABASE_ANON_KEY before publishing. No unauthenticated fallback.');
}
console.log('Built Relay + shared Supabase access + admin + original board → site/');
