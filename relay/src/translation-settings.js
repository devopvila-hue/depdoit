import { createTranslator } from './translate.js';
import { HttpError } from './errors.js';

/** Per-company settings. Credentials never leave the server. */
export function translationSettings(workspace, fallback) {
  const db = workspace.db;
  db.exec('CREATE TABLE IF NOT EXISTS workspace_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const read = () => JSON.parse(db.prepare("SELECT value FROM workspace_settings WHERE name='translation-v1'").get()?.value || '{}');
  const effective = value => {
    if (value.enabled === false) return null;
    if (!value.apiKey) return fallback;
    if (workspace.translationKey !== value.apiKey) {
      workspace.translationKey = value.apiKey;
      workspace.translationProvider = createTranslator({ LLM_API_KEY: value.apiKey, LLM_MODEL: 'MiniMax-M2.7' });
    }
    return workspace.translationProvider;
  };
  const status = value => ({ enabled: value.enabled !== false, available: Boolean(effective(value)?.available), hasCompanyKey: Boolean(value.apiKey), hasServerKey: Boolean(fallback?.available) });
  return {
    translator: () => effective(read()),
    status: () => status(read()),
    async save(body) {
      const value = read();
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'Invalid enabled value');
        value.enabled = body.enabled;
      }
      if (body.clearKey === true) delete value.apiKey;
      if (body.apiKey !== undefined) {
        if (typeof body.apiKey !== 'string' || body.apiKey.length > 4096) throw new HttpError(400, 'Invalid API key');
        if (body.apiKey.trim()) {
          const candidate = { ...value, apiKey: body.apiKey.trim(), enabled: true };
          // Verify before replacing a working key. No private task content is sent.
          await effective(candidate).translate({summary:'Connection check',description:'',sourceLang:'en',targetLang:'es'});
          value.apiKey = candidate.apiKey;
        }
      }
      db.prepare("INSERT INTO workspace_settings (name,value) VALUES ('translation-v1',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));
      return status(value);
    },
  };
}
