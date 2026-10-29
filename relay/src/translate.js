import { readFileSync } from 'node:fs';

const LANG_NAMES = {
  es: 'español',
  en: 'english',
  ro: 'română',
  hu: 'magyar',
};

/** Lee la clave de la API desde el entorno o desde un fichero local. */
export function readApiKey(env = process.env) {
  const fromEnv = env.LLM_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const keyFile = env.RELAY_LLM_KEY_FILE?.trim();
  if (keyFile) {
    try {
      const value = readFileSync(keyFile, 'utf8').trim();
      if (value) return value;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Proveedor de traducción.
 *
 * Por defecto NO sale nada de la máquina: sin clave de API el proveedor
 * queda deshabilitado y las traducciones se escriben a mano desde la interfaz.
 * Con clave configurada se usa un endpoint de chat compatible con OpenAI
 * (MiniMax por defecto) y solo se envía el texto de la incidencia.
 */
export function createTranslator(env = process.env) {
  const apiKey = readApiKey(env);
  const baseUrl = (env.LLM_BASE_URL?.trim() || 'https://api.minimax.io/v1').replace(/\/+$/, '');
  const model = env.LLM_MODEL?.trim() || 'MiniMax-M2';

  const available = Boolean(apiKey);
  let activeCalls = 0;
  const waiting = [];
  async function acquire() {
    if (activeCalls >= 3) await new Promise(resolve => waiting.push(resolve));
    else activeCalls++;
  }
  function release() { const next = waiting.shift(); if (next) next(); else activeCalls--; }
  const providerName = available ? `llm:${model}` : 'manual';

  function chatUrl() {
    return baseUrl.includes('?')
      ? `${baseUrl}&endpoint=/chat/completions`
      : `${baseUrl}/chat/completions`;
  }

  async function translate({ summary, description, targetLang, sourceLang }) {
    if (!available) {
      const error = new Error(
        'La traducción automática no está configurada. Define LLM_API_KEY en el servidor o escribe la traducción a mano.'
      );
      error.status = 503;
      throw error;
    }
    const target = LANG_NAMES[targetLang] || targetLang;
    const source = LANG_NAMES[sourceLang] || sourceLang || 'the original language';

    const payload = {
      model,
      messages: [
        {
          role: 'system',
          content:
            `Eres un traductor. Traduce el contenido de una incidencia de tarea de ${source} a ${target}. ` +
            'Devuelve únicamente JSON con las claves "summary" y "description". ' +
            'Conserva los identificadores de código (WEB-12), etiquetas, nombres propios y URLs sin traducir. ' +
            'No añadas explicaciones.',
        },
        {
          role: 'user',
          content: JSON.stringify({ summary: summary ?? '', description: description ?? '' }),
        },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    };

    await acquire();
    try {
      const response = await fetch(chatUrl(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const error = new Error(`Translation provider unavailable (${response.status})`);
        error.status = 502;
        throw error;
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content ?? '';
      const parsed = parseJson(content);
      if (!parsed || typeof parsed.summary !== 'string' || !parsed.summary.trim() || typeof parsed.description !== 'string') {
        const error = new Error('El proveedor de traducción no devolvió JSON válido');
        error.status = 502;
        throw error;
      }
      return {
        summary: String(parsed.summary ?? '').trim(),
        description: String(parsed.description ?? '').trim(),
        provider: providerName,
      };
    } finally { release(); }
  }

  return { available, provider: providerName, translate, targetLanguageName: (code) => LANG_NAMES[code] || code };
}

/** Aísla un objeto JSON dentro de una respuesta que puede venir envuelta en texto. */
export function parseJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
