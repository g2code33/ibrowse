/**
 * Yayra AI - the browser's AI layer (Chrome-style "AI options on every
 * search"). See packages/shared-ui/src/services/aiService.js.
 *
 * Covers:
 *  - Config defaults, persistence, and cache behaviour.
 *  - ask() via the 'yayra' built-in backend: happy path, HONEST
 *    "backend-not-deployed" on 404 (no fake answers, ever), rate limits,
 *    network errors.
 *  - ask() via an OpenAI-compatible endpoint: request shape (url, auth
 *    header, model, system prompt + history + user message), response
 *    parsing, auth failure, missing endpoint.
 *  - normalizeChatCompletionsUrl + describeAiReason.
 *  - BrowserShell integration: omnibox "Ask Yayra AI" row, the
 *    yayra://ai page (empty state, setup notice, conversation, auto-ask
 *    from ?q= exactly once), new-tab chip, and Settings > Yayra AI.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import {
  YayraAiService,
  AI_DEFAULTS,
  AI_STORAGE_KEY,
  YAYRA_AI_ENDPOINT,
  normalizeChatCompletionsUrl,
  describeAiReason
} from '../packages/shared-ui/src/services/aiService.js';
import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';

function makeStorage() {
  const map = new Map();
  return {
    map,
    get: async (k) => (map.has(k) ? map.get(k) : null),
    set: async (k, v) => { map.set(k, v); },
    delete: async (k) => { map.delete(k); }
  };
}

function fakeFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    return responder(url, init, calls.length);
  };
  fn.calls = calls;
  return fn;
}

function jsonResponse(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

/* ------------------------------ config ------------------------------ */

test('AI: defaults are enabled + yayra provider + omnibox suggestions on', async () => {
  const svc = new YayraAiService({ storage: makeStorage(), fetchImpl: fakeFetch(() => jsonResponse(200, {})) });
  const cfg = await svc.getConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.provider, 'yayra');
  assert.equal(cfg.suggestInOmnibox, true);
  assert.equal(cfg.apiKey, '');
});

test('AI: updateConfig persists and survives a new service instance', async () => {
  const storage = makeStorage();
  const svc = new YayraAiService({ storage });
  await svc.updateConfig({ provider: 'openai-compatible', endpoint: 'https://api.groq.com/openai/v1', model: 'llama3' });
  assert.ok(storage.map.has(AI_STORAGE_KEY), 'written to storage');

  const svc2 = new YayraAiService({ storage });
  const cfg = await svc2.getConfig();
  assert.equal(cfg.provider, 'openai-compatible');
  assert.equal(cfg.model, 'llama3');
  assert.equal(cfg.enabled, true, 'unspecified keys keep defaults');
});

/* --------------------------- yayra backend --------------------------- */

test('AI: yayra provider posts {messages} to the built-in endpoint and returns the answer', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(200, { answer: 'Accra is the capital of Ghana.' }));
  const svc = new YayraAiService({ storage: makeStorage(), fetchImpl });

  const result = await svc.ask('capital of ghana?', { history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello!' }] });
  assert.equal(result.success, true);
  assert.equal(result.answer, 'Accra is the capital of Ghana.');

  const call = fetchImpl.calls[0];
  assert.equal(call.url, YAYRA_AI_ENDPOINT);
  const roles = call.body.messages.map((m) => m.role);
  assert.deepEqual(roles, ['system', 'user', 'assistant', 'user'], 'system prompt + history + question');
  assert.equal(call.body.messages.at(-1).content, 'capital of ghana?');
});

test('AI: yayra backend 404 reports backend-not-deployed - NEVER a fake answer', async () => {
  const svc = new YayraAiService({ storage: makeStorage(), fetchImpl: fakeFetch(() => jsonResponse(404, {})) });
  const result = await svc.ask('hello');
  assert.deepEqual(result, { success: false, reason: 'backend-not-deployed' });
  assert.ok(describeAiReason(result.reason).includes('not live yet'), 'copy is honest about readiness');
});

test('AI: rate limits and network failures surface as their own reasons', async () => {
  const limited = new YayraAiService({ storage: makeStorage(), fetchImpl: fakeFetch(() => jsonResponse(429, {})) });
  assert.equal((await limited.ask('x')).reason, 'rate-limited');

  const offline = new YayraAiService({ storage: makeStorage(), fetchImpl: fakeFetch(() => { throw new Error('ECONNREFUSED'); }) });
  const result = await offline.ask('x');
  assert.equal(result.reason, 'network-error');
  assert.ok(result.detail.includes('ECONNREFUSED'));
});

test('AI: disabled config refuses to ask at all', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(200, { answer: 'nope' }));
  const svc = new YayraAiService({ storage: makeStorage(), fetchImpl });
  await svc.updateConfig({ enabled: false });
  assert.equal((await svc.ask('x')).reason, 'ai-disabled');
  assert.equal(fetchImpl.calls.length, 0, 'no network traffic while disabled');
});

/* ------------------------ openai-compatible ------------------------ */

test('AI: openai-compatible posts a chat/completions request with auth + model', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(200, { choices: [{ message: { content: ' 42 ' } }] }));
  const svc = new YayraAiService({ storage: makeStorage(), fetchImpl });
  await svc.updateConfig({ provider: 'openai-compatible', endpoint: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini' });

  const result = await svc.ask('meaning of life?');
  assert.equal(result.success, true);
  assert.equal(result.answer, '42', 'answer is trimmed');

  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(call.init.headers.authorization, 'Bearer sk-test');
  assert.equal(call.body.model, 'gpt-4o-mini');
  assert.equal(call.body.messages[0].role, 'system');
});

test('AI: openai-compatible maps 401 to auth-failed and empty content to empty-answer', async () => {
  const storage = makeStorage();
  const unauthorized = new YayraAiService({ storage, fetchImpl: fakeFetch(() => jsonResponse(401, {})) });
  await unauthorized.updateConfig({ provider: 'openai-compatible', endpoint: 'https://x.test/v1', apiKey: 'bad' });
  assert.equal((await unauthorized.ask('x')).reason, 'auth-failed');

  const empty = new YayraAiService({ storage, fetchImpl: fakeFetch(() => jsonResponse(200, { choices: [] })) });
  assert.equal((await empty.ask('x')).reason, 'empty-answer');
});

test('AI: openai-compatible without an endpoint is not-configured (and isReady says so)', async () => {
  const svc = new YayraAiService({ storage: makeStorage(), fetchImpl: fakeFetch(() => jsonResponse(200, {})) });
  await svc.updateConfig({ provider: 'openai-compatible', endpoint: '' });
  assert.equal((await svc.ask('x')).reason, 'not-configured');
  assert.equal(await svc.isReady(), false);
  await svc.updateConfig({ endpoint: 'http://localhost:11434/v1' });
  assert.equal(await svc.isReady(), true);
});

test('AI: normalizeChatCompletionsUrl accepts base URLs and complete URLs', () => {
  assert.equal(normalizeChatCompletionsUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(normalizeChatCompletionsUrl('http://localhost:11434/v1/'), 'http://localhost:11434/v1/chat/completions');
  assert.equal(normalizeChatCompletionsUrl('https://x.test/v1/chat/completions'), 'https://x.test/v1/chat/completions');
});

/* ------------------------- shell integration ------------------------- */

function makeShell({ aiService } = {}) {
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, isMobile: false, aiService });
  shell.render(container);
  return { shell, container };
}

function fakeAnsweringService(answer = 'Here you go.') {
  const asked = [];
  return {
    asked,
    getConfig: async () => ({ ...AI_DEFAULTS }),
    updateConfig: async (p) => ({ ...AI_DEFAULTS, ...p }),
    ask: async (prompt, { history = [] } = {}) => {
      asked.push({ prompt, history });
      return { success: true, answer };
    },
    testConnection: async () => ({ success: true })
  };
}

test('Shell: yayra://ai renders the AI page with input + empty state', () => {
  const { shell, container } = makeShell();
  shell.state.tabs[0].url = 'yayra://ai';
  shell.render(container);
  assert.ok(container.querySelector('.fb-ai-page'), 'AI page rendered');
  assert.ok(container.querySelector('.fb-ai-input'), 'prompt input present');
  assert.ok(container.querySelector('.fb-ai-empty'), 'empty state before any question');
  assert.equal(shell.getTabTitle(shell.state.tabs[0]), 'Yayra AI');
});

test('Shell: asking appends user + assistant messages from the provider', async () => {
  const aiService = fakeAnsweringService('Paris.');
  const { shell, container } = makeShell({ aiService });
  shell.state.tabs[0].url = 'yayra://ai';
  shell.render(container);

  await shell.askYayraAi('capital of france?');

  assert.equal(aiService.asked.length, 1);
  assert.equal(shell.state.aiConversation.length, 2);
  assert.equal(shell.state.aiConversation[0].role, 'user');
  assert.equal(shell.state.aiConversation[1].content, 'Paris.');
  shell.render(container);
  const bodies = container.querySelectorAll('.fb-ai-msg-body');
  assert.equal(bodies.length, 2, 'both sides rendered');
});

test('Shell: provider failures render as honest error notices, not answers', async () => {
  const aiService = {
    ...fakeAnsweringService(),
    ask: async () => ({ success: false, reason: 'backend-not-deployed' })
  };
  const { shell } = makeShell({ aiService });
  await shell.askYayraAi('anything');
  const last = shell.state.aiConversation.at(-1);
  assert.equal(last.error, true);
  assert.equal(last.reason, 'backend-not-deployed');
  assert.ok(last.content.includes('not live yet'));
});

test('Shell: yayra://ai?q= auto-asks exactly once per navigation', async () => {
  const aiService = fakeAnsweringService();
  const { shell, container } = makeShell({ aiService });
  shell.state.tabs[0].url = `yayra://ai?q=${encodeURIComponent('weather in accra')}`;
  shell.render(container);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(aiService.asked.length, 1);
  assert.equal(aiService.asked[0].prompt, 'weather in accra');

  // Re-renders (e.g. opening a menu) must never re-ask.
  shell.render(container);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(aiService.asked.length, 1, 'no duplicate auto-ask');
});

test('Shell: omnibox suggestions lead with an "Ask Yayra AI" row that opens yayra://ai', async () => {
  const { shell, container } = makeShell();
  // Local suggestions only (no fetch in tests).
  shell.getGoogleSearchSuggestions = async (q) => [`${q} news`];
  const input = container.querySelector('.fb-omnibox-input') || container.querySelector('input');
  assert.ok(input, 'omnibox input exists');
  input.value = 'quantum computing';
  input.dispatchEvent(new Event('input'));
  await new Promise((r) => setTimeout(r, 0));

  const aiRow = container.querySelector('.fb-ai-suggestion');
  assert.ok(aiRow, 'AI row present');
  assert.ok(aiRow.textContent.includes('Ask Yayra AI'), 'labelled like Chrome AI search options');

  let opened = null;
  shell.openAiPage = (q) => { opened = q; };
  aiRow.dispatchEvent(new Event('mousedown'));
  assert.equal(opened, 'quantum computing', 'clicking hands the query to Yayra AI');
});

test('Shell: AI row honours the enabled + suggestInOmnibox config flags', async () => {
  const { shell, container } = makeShell();
  shell.getGoogleSearchSuggestions = async () => ['something'];
  shell.state.aiConfig = { ...AI_DEFAULTS, suggestInOmnibox: false };
  const input = container.querySelector('input');
  input.value = 'hello';
  input.dispatchEvent(new Event('input'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(container.querySelector('.fb-ai-suggestion'), null, 'no AI row when turned off');
});

test('Shell: new tab shows the "Ask Yayra AI" chip; Settings has the Yayra AI section', () => {
  const { shell, container } = makeShell();
  assert.ok(container.querySelector('.fb-newtab-ai-chip'), 'newtab AI chip');

  shell.state.tabs[0].url = 'yayra://settings';
  shell.state.settingsActiveCategory = 'ai';
  shell.state.activeSettingsCategory = 'ai';
  shell.render(container);
  assert.ok(container.querySelector('#sec-ai'), 'settings section exists');
  assert.ok(container.querySelector('#fb-in-set-ai-enabled'), 'enable toggle');
  assert.ok(container.querySelector('#fb-in-set-ai-provider'), 'provider select');
  assert.ok(container.querySelector('#fb-in-set-ai-endpoint'), 'endpoint field');
  assert.ok(container.querySelector('#fb-in-set-ai-test'), 'test connection button');
});
