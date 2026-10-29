import { HttpError } from './errors.js';
import { LANGS } from './store.js';

/**
 * API REST de Relay. La traducción usa el proveedor configurado en el servidor.
 */
export function createApi(store, { translator } = {}) {
  const routes = [];
  const getTranslator = () => typeof translator === 'function' ? translator() : translator;
  const jobs = new Map();
  const failures = new Map();
  const fingerprint = issue => JSON.stringify([issue.summary, issue.description, issue.sourceLang]);

  const route = (method, pattern, handler) => {
    const names = [];
    const regex = new RegExp(
      '^' +
        pattern.replace(/:([A-Za-z]+)/g, (_, name) => {
          names.push(name);
          return '([^/]+)';
        }) +
        '$'
    );
    routes.push({ method, regex, names, handler });
  };

  route('GET', '/api/meta', () => ({
    ...store.meta(),
    langs: LANGS,
    translation: {
      available: Boolean(getTranslator()?.available),
      provider: getTranslator()?.provider ?? 'manual',
    },
  }));

  route('GET', '/api/users', () => store.listUsers());
  route('POST', '/api/users', ({ body }) => store.createUser(body));

  route('GET', '/api/projects', () => store.listProjects());
  route('POST', '/api/projects', ({ body }) => store.createProject(body));
  route('GET', '/api/projects/:key', ({ params }) => store.getProject(params.key));
  route('PATCH', '/api/projects/:key', ({ params, body }) => store.updateProject(params.key, body));

  route('GET', '/api/issues', ({ query }) => store.listIssues(query).map(issue => {
    scheduleAutoTranslate(issue); return withPending(issue);
  }));
  route('POST', '/api/issues', ({ body }) => {
    const issue = store.createIssue(body);
    scheduleAutoTranslate(issue);
    return withPending(issue);
  });
  route('GET', '/api/issues/:key', ({ params }) => {
    const issue = store.getIssue(params.key); scheduleAutoTranslate(issue); return withPending(issue);
  });
  route('PATCH', '/api/issues/:key', ({ params, body }) => {
    const issue = store.updateIssue(params.key, body); scheduleAutoTranslate(issue); return withPending(issue);
  });
  route('DELETE', '/api/issues/:key', ({ params }) => store.deleteIssue(params.key));
  route('POST', '/api/issues/:key/comments', ({ params, body }) => store.addComment(params.key, body));

  route('GET', '/api/issues/:key/translations', ({ params }) => store.listTranslations(params.key));
  route('PUT', '/api/issues/:key/translations/:lang', ({ params, body }) =>
    store.setTranslation(params.key, params.lang, body)
  );
  route('DELETE', '/api/issues/:key/translations/:lang', ({ params }) =>
    store.deleteTranslation(params.key, params.lang)
  );
  route('POST', '/api/issues/:key/translate', async ({ params, body }) => {
    const lang = body.lang;
    if (!LANGS.includes(lang)) throw new HttpError(400, 'Unsupported language');
    const active = getTranslator();
    if (!active?.available) throw new HttpError(503, 'Automatic translation is not configured');
    const issue = store.getIssue(params.key);
    if (lang === issue.sourceLang) return withPending(issue);
    const result = await active.translate({ summary: issue.summary, description: issue.description, targetLang: lang, sourceLang: issue.sourceLang });
    const current = store.getIssue(params.key);
    if (fingerprint(current) !== fingerprint(issue)) throw new HttpError(409, 'Task changed during translation; retry');
    failures.delete(`${issue.key}:${lang}`);
    return store.setTranslation(issue.key, lang, result, result.provider ?? 'llm');
  });

  route('GET', '/api/sprints', ({ query }) => store.listSprints(query));
  route('POST', '/api/sprints', ({ body }) => store.createSprint(body));
  route('GET', '/api/sprints/:id', ({ params }) => store.getSprint(params.id));
  route('PATCH', '/api/sprints/:id', ({ params, body }) => store.updateSprint(params.id, body));
  route('DELETE', '/api/sprints/:id', ({ params }) => store.deleteSprint(params.id));
  route('POST', '/api/sprints/:id/state', ({ params, body }) => store.setSprintState(params.id, body.state));
  route('POST', '/api/sprints/:id/issues', ({ params, body }) => store.addIssueToSprint(params.id, body.issueKey));
  route('DELETE', '/api/sprints/:id/issues/:key', ({ params }) => store.removeIssueFromSprint(params.id, params.key));

  route('GET', '/api/board', ({ query }) => store.board(query.project));

  /** Idiomas que aún no tienen traducción para esta incidencia. */
  function pendingLanguages(issue) {
    if (!getTranslator()?.available) return [];
    return LANGS.filter((lang) => lang !== issue.sourceLang && !issue.translations?.[lang]?.summary);
  }

  function withPending(issue) {
    return { ...issue, translationsPending: pendingLanguages(issue).length,
      translationsFailed: pendingLanguages(issue).filter(lang => failures.has(`${issue.key}:${lang}`)).length };
  }

  /**
   * Traduce en segundo plano las incidencias nuevas, existentes o editadas.
   * La respuesta al cliente no espera a la traducción: se guarda cada
   * resultado en cuanto llega y el cliente la consulta con `translationsPending`.
   */
  function scheduleAutoTranslate(issue) {
    for (const lang of pendingLanguages(issue)) {
      const id = `${issue.key}:${lang}`;
      if (jobs.has(id) || Date.now() - (failures.get(id) || 0) < 60000) continue;
      const snapshot = fingerprint(issue);
      const job = Promise.resolve().then(() => {
        const active = getTranslator();
        if (!active?.available) return null;
        return active.translate({summary: issue.summary, description: issue.description, targetLang: lang, sourceLang: issue.sourceLang});
      }).then(result => {
        if (!result || !getTranslator()?.available) return;
        let current;
        try { current = store.getIssue(issue.key); } catch { return; }
        // An old response must never overwrite new source text or a manual edit.
        if (fingerprint(current) !== snapshot || current.translations?.[lang]?.summary) return;
        store.setTranslation(issue.key, lang, result, result.provider ?? 'llm');
        failures.delete(id);
      }).catch(() => {
        failures.set(id, Date.now());
        console.error(`[relay] translation failed: ${issue.key} / ${lang}`);
      }).finally(() => jobs.delete(id));
      jobs.set(id, job);
    }
  }

  return {
    /** Devuelve { handler, params } o null si la ruta no existe. Lanza 405 si el método no encaja. */
    match(method, pathname) {
      let pathExists = false;
      for (const entry of routes) {
        const found = entry.regex.exec(pathname);
        if (!found) continue;
        pathExists = true;
        if (entry.method !== method) continue;
        const params = {};
        entry.names.forEach((name, index) => {
          params[name] = decodeURIComponent(found[index + 1]);
        });
        return { handler: entry.handler, params };
      }
      if (pathExists) throw new HttpError(405, `Método no permitido: ${method} ${pathname}`);
      return null;
    },
  };
}

export { HttpError };
