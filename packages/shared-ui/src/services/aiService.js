/**
 * Yayra AI - the browser's AI layer (Chrome-style "AI options on every
 * search").
 *
 * WHAT THIS IS TODAY (foundation, by design): the complete plumbing for
 * AI across Yayra - config + persistence, a provider-agnostic ask()
 * pipeline with conversation history, the omnibox "Ask Yayra AI" entry,
 * and the yayra://ai chat page - with TWO real provider modes:
 *
 *   - 'yayra'  (default): Yayra's own backend at the updates-API worker
 *     (POST /api/ai). Server-side it runs on a POOL of NVIDIA NIM keys
 *     (worker/update-worker.mjs) - round-robin + failover across many
 *     keys so users never crowd a single one. No API key needed from
 *     users; until the keys are bound on the worker, ask() reports an
 *     HONEST "backend not deployed yet" error rather than fabricating
 *     answers.
 *   - 'openai-compatible': ANY OpenAI-style /chat/completions endpoint
 *     (OpenAI, Groq, Ollama, LM Studio, OpenRouter, a self-hosted vLLM,
 *     ...) configured from Settings with endpoint + key + model. This
 *     works end-to-end TODAY for users who plug in their own provider.
 *
 * Deliberately NOT here: fake/canned "AI" answers. If nothing can answer,
 * the user is told exactly why and how to set it up.
 *
 * Storage shape (STORAGE_KEY): { enabled, provider, endpoint, apiKey,
 * model, suggestInOmnibox }. Same async storage-adapter contract as
 * passkeyService.js ({ get, set, delete }).
 */

export const AI_STORAGE_KEY = 'yayra-ai-config-v1';

// Yayra's own backend route (same Cloudflare worker that already serves
// update manifests and search suggestions). Kept as the single source of
// truth for the endpoint contract: POST { messages:[{role,content},...] }
// -> { answer: string }.
export const YAYRA_AI_ENDPOINT = 'https://yayra-updates-api.g2code335.workers.dev/api/ai';

export const AI_DEFAULTS = Object.freeze({
  enabled: true,
  provider: 'yayra', // 'yayra' | 'openai-compatible'
  endpoint: '',      // used by 'openai-compatible' (base URL or full /chat/completions URL)
  apiKey: '',
  model: '',
  // Chrome-style: offer "Ask Yayra AI" alongside normal search suggestions.
  suggestInOmnibox: true
});

// How much conversation is replayed to the provider per ask.
const MAX_HISTORY_MESSAGES = 12;

const SYSTEM_PROMPT = 'You are Yayra AI, the built-in assistant of the Yayra browser. '
  + 'Answer concisely and helpfully. When the user asks about a web page or search query, '
  + 'give a direct useful answer first, then any brief follow-up suggestions.';

export class YayraAiService {
  constructor({ storage, fetchImpl, yayraEndpoint = YAYRA_AI_ENDPOINT } = {}) {
    this.storage = storage || null;
    this._fetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.yayraEndpoint = yayraEndpoint;
    this._configCache = null;
  }

  /* ------------------------------ config ------------------------------ */

  async getConfig() {
    if (this._configCache) return this._configCache;
    let stored = null;
    if (this.storage && typeof this.storage.get === 'function') {
      try { stored = await this.storage.get(AI_STORAGE_KEY); } catch { stored = null; }
    }
    this._configCache = { ...AI_DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) };
    return this._configCache;
  }

  async updateConfig(partial) {
    const next = { ...(await this.getConfig()), ...(partial || {}) };
    this._configCache = next;
    if (this.storage && typeof this.storage.set === 'function') {
      await this.storage.set(AI_STORAGE_KEY, next);
    }
    return next;
  }

  /** AI features are offered in the UI (omnibox row, newtab chip). */
  async isEnabled() {
    return Boolean((await this.getConfig()).enabled);
  }

  /**
   * Whether ask() has a realistic chance of answering right now:
   * 'yayra' needs only a fetch runtime (backend readiness is reported
   * honestly at ask time); 'openai-compatible' also needs an endpoint.
   */
  async isReady() {
    const cfg = await this.getConfig();
    if (!cfg.enabled || !this._fetch) return false;
    if (cfg.provider === 'openai-compatible') return Boolean(cfg.endpoint);
    return true;
  }

  /* ------------------------------- ask ------------------------------- */

  /**
   * Ask Yayra AI. `history` is the prior conversation:
   * [{ role: 'user'|'assistant', content }].
   * Resolves { success: true, answer } or { success: false, reason,
   * detail? } - reasons: 'ai-disabled', 'no-fetch-runtime',
   * 'not-configured', 'backend-not-deployed', 'auth-failed',
   * 'rate-limited', 'provider-error', 'network-error', 'empty-answer'.
   */
  async ask(prompt, { history = [], signal } = {}) {
    const text = String(prompt || '').trim();
    if (!text) return { success: false, reason: 'empty-answer' };
    const cfg = await this.getConfig();
    if (!cfg.enabled) return { success: false, reason: 'ai-disabled' };
    if (!this._fetch) return { success: false, reason: 'no-fetch-runtime' };

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .slice(-MAX_HISTORY_MESSAGES)
        .map((m) => ({ role: m.role, content: String(m.content) })),
      { role: 'user', content: text }
    ];

    if (cfg.provider === 'openai-compatible') {
      if (!cfg.endpoint) return { success: false, reason: 'not-configured' };
      return this._askOpenAiCompatible(cfg, messages, signal);
    }
    return this._askYayraBackend(messages, signal);
  }

  async _askYayraBackend(messages, signal) {
    try {
      const response = await this._fetch(this.yayraEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ messages }),
        signal
      });
      if (response.status === 404 || response.status === 501) {
        // The worker exists (it serves updates/suggestions) but the AI
        // route has not been deployed yet - say so, honestly.
        return { success: false, reason: 'backend-not-deployed' };
      }
      if (response.status === 429) return { success: false, reason: 'rate-limited' };
      if (!response.ok) return { success: false, reason: 'provider-error', detail: `HTTP ${response.status}` };
      const payload = await response.json();
      const answer = typeof payload?.answer === 'string' ? payload.answer.trim() : '';
      if (!answer) return { success: false, reason: 'empty-answer' };
      return { success: true, answer };
    } catch (err) {
      if (err?.name === 'AbortError') return { success: false, reason: 'network-error', detail: 'aborted' };
      return { success: false, reason: 'network-error', detail: String(err?.message || err) };
    }
  }

  async _askOpenAiCompatible(cfg, messages, signal) {
    const url = normalizeChatCompletionsUrl(cfg.endpoint);
    try {
      const headers = { 'content-type': 'application/json', accept: 'application/json' };
      if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
      const response = await this._fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: cfg.model || 'gpt-4o-mini',
          messages
        }),
        signal
      });
      if (response.status === 401 || response.status === 403) return { success: false, reason: 'auth-failed' };
      if (response.status === 429) return { success: false, reason: 'rate-limited' };
      if (!response.ok) return { success: false, reason: 'provider-error', detail: `HTTP ${response.status}` };
      const payload = await response.json();
      const answer = typeof payload?.choices?.[0]?.message?.content === 'string'
        ? payload.choices[0].message.content.trim()
        : '';
      if (!answer) return { success: false, reason: 'empty-answer' };
      return { success: true, answer };
    } catch (err) {
      if (err?.name === 'AbortError') return { success: false, reason: 'network-error', detail: 'aborted' };
      return { success: false, reason: 'network-error', detail: String(err?.message || err) };
    }
  }

  /** One-round-trip connectivity check for the Settings "Test" button. */
  async testConnection() {
    const result = await this.ask('Reply with the single word: ready', { history: [] });
    if (result.success) return { success: true };
    return { success: false, reason: result.reason, detail: result.detail };
  }
}

/* ------------------------------ helpers ------------------------------ */

/**
 * Accepts either a base URL ("https://api.openai.com/v1", "http://localhost:11434/v1")
 * or an already-complete chat-completions URL, and returns the full
 * /chat/completions endpoint.
 */
export function normalizeChatCompletionsUrl(endpoint) {
  const raw = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!raw) return raw;
  if (/\/chat\/completions$/.test(raw)) return raw;
  return `${raw}/chat/completions`;
}

/** Human wording for YayraAiService failure reasons. */
export function describeAiReason(reason) {
  switch (reason) {
    case 'ai-disabled': return 'Yayra AI is turned off in Settings.';
    case 'no-fetch-runtime': return 'This runtime cannot make network requests.';
    case 'not-configured': return 'No AI provider is configured yet - add one in Settings > Yayra AI.';
    case 'backend-not-deployed': return 'Yayra\u2019s built-in AI backend is not live yet. Connect your own OpenAI-compatible provider in Settings > Yayra AI to use AI today.';
    case 'auth-failed': return 'The AI provider rejected the API key.';
    case 'rate-limited': return 'The AI provider is rate-limiting requests - try again shortly.';
    case 'provider-error': return 'The AI provider returned an error.';
    case 'network-error': return 'Could not reach the AI provider (network error).';
    case 'empty-answer': return 'The AI provider returned an empty answer.';
    default: return reason || 'Unknown AI error.';
  }
}
