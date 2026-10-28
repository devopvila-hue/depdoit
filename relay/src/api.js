import { HttpError } from './errors.js';
import { LANGS } from './store.js';

/**
 * API REST local de Relay. Sin ninguna llamada externa.
 */
export function createApi(store, { translator } = {}) {
  const routes = [];

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
      available: Boolean(translator?.available),
      provider: translator?.provider ?? 'manual',
    },
  }));

  route('GET', '/api/users', () => store.listUsers());
  route('POST', '/api/users', ({ body }) => store.createUser(body));

  route('GET', '/api/projects', () => store.listProjects());
  route('POST', '/api/projects', ({ body }) => store.createProject(body));
  route('GET', '/api/projects/:key', ({ params }) => store.getProject(params.key));
  route('PATCH', '/api/projects/:key', ({ params, body }) => store.updateProject(params.key, body));

  route('GET', '/api/issues', ({ query }) => store.listIssues(query));
  route('POST', '/api/issues', ({ body }) => {
    const issue = store.createIssue(body);
    scheduleAutoTranslate(issue);
    return withPending(issue);
  });
  route('GET', '/api/issues/:key', ({ params }) => withPending(store.getIssue(params.key)));
  route('PATCH', '/api/issues/:key', ({ params, body }) => store.updateIssue(params.key, body));
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
    if (!translator) throw new HttpError(503, 'La traducción automática no está configurada en este servidor');
    const issue = store.getIssue(params.key);
    const result = await translator.translate({
      summary: issue.summary,
      description: issue.description,
      targetLang: params.lang,
      sourceLang: issue.sourceLang,
    });
    return store.setTranslation(params.key, params.lang, result, result.provider ?? 'llm');
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
    if (!translator?.available) return [];
    return LANGS.filter((lang) => lang !== issue.sourceLang && !issue.translations?.[lang]?.summary);
  }

  function withPending(issue) {
    return { ...issue, translationsPending: pendingLanguages(issue).length };
  }

  /**
   * Traduce en segundo plano la incidencia recién creada al resto de idiomas.
   * La respuesta al cliente no espera a la traducción: se guarda cada
   * resultado en cuanto llega y el cliente la consulta con `translationsPending`.
   */
  function scheduleAutoTranslate(issue) {
    const targets = pendingLanguages(issue);
    if (!targets.length) return;
    for (const lang of targets) {
      translator
        .translate({
          summary: issue.summary,
          description: issue.description,
          targetLang: lang,
          sourceLang: issue.sourceLang,
        })
        .then((result) => {
          store.setTranslation(issue.key, lang, result, result.provider ?? 'llm');
        })
        .catch((error) => {
          console.error(`[relay] no se pudo traducir ${issue.key} a ${lang}: ${error.message}`);
        });
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
