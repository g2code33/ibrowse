import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/update-worker.mjs';

test('update worker serves manifest with cache, cors, etag and HEAD support', async () => {
  const request = new Request('https://yayra-updates-api.g2code335.workers.dev/updates/manifest.json');
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.ok(response.headers.get('etag'));
  const body = await response.json();
  assert.equal(body.schema, 1);
  const head = await worker.fetch(new Request('https://yayra-updates-api.g2code335.workers.dev/updates/manifest.json', { method: 'HEAD', headers: { 'if-none-match': response.headers.get('etag') } }), {});
  assert.equal(head.status, 304);
});

test('update worker proxies browser-safe suggestions and release metadata with CORS', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (target, options) => {
    requests.push({ target: String(target), options });
    if (String(target).includes('suggestqueries.google.com')) {
      return new Response(JSON.stringify(['gha', ['ghana', 'ghana news']]), { status: 200 });
    }
    return new Response(JSON.stringify({ tag_name: 'v0.1.8', body: 'release notes' }), { status: 200 });
  };
  try {
    const suggestions = await worker.fetch(new Request('https://yayra-updates-api.g2code335.workers.dev/api/suggestions?q=ghana'), {});
    assert.equal(suggestions.status, 200);
    assert.deepEqual(await suggestions.json(), ['gha', ['ghana', 'ghana news']]);
    assert.equal(suggestions.headers.get('access-control-allow-origin'), '*');

    const release = await worker.fetch(new Request('https://yayra-updates-api.g2code335.workers.dev/api/latest-release'), {});
    assert.equal(release.status, 200);
    assert.equal((await release.json()).tag_name, 'v0.1.8');
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// GitHub's unauthenticated REST API quota (60 requests/hour) is shared
// across Cloudflare's entire egress IP range, not just this Worker's own
// traffic - it can be exhausted by load this Worker never generated. An
// optional GITHUB_TOKEN binding raises that to the authenticated 5,000/hour
// quota instead; this proves the header is actually attached when present,
// and that we still work (just unauthenticated) when it isn't configured.
test('update worker attaches GITHUB_TOKEN as a Bearer header when bound, and omits it when not configured', async () => {
  const originalFetch = globalThis.fetch;
  const seenHeaders = [];
  globalThis.fetch = async (target, options) => {
    seenHeaders.push(options?.headers || {});
    return new Response(JSON.stringify({ tag_name: 'v0.1.9' }), { status: 200 });
  };
  try {
    await worker.fetch(new Request('https://yayra-updates-api.g2code335.workers.dev/api/latest-release'), {});
    assert.equal(seenHeaders[0].Authorization, undefined, 'no token configured -> no Authorization header sent');

    await worker.fetch(new Request('https://yayra-updates-api.g2code335.workers.dev/api/latest-release'), { GITHUB_TOKEN: 'secret-test-token' });
    assert.equal(seenHeaders[1].Authorization, 'Bearer secret-test-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// The edge Cache API layer is the primary defense against GitHub's shared
// rate limit: once a response is cached, repeat requests for the same
// upstream URL never leave the Worker, regardless of how many different
// client IPs are asking. Node has no global `caches`, so this installs a
// minimal in-memory stand-in to prove the integration is wired correctly
// (cache.match consulted first, cache.put called on a real upstream MISS).
test('update worker serves a cached response on a repeat request instead of re-hitting the upstream API', async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify({ tag_name: 'v0.1.9' }), { status: 200 });
  };
  globalThis.caches = { default: makeFakeEdgeCache() };
  try {
    const first = await worker.fetch(new Request('https://yayra-updates-api.g2code335.workers.dev/api/latest-release'), {});
    assert.equal(first.headers.get('x-yayra-cache'), 'MISS');
    assert.equal(upstreamCalls, 1);

    const second = await worker.fetch(new Request('https://yayra-updates-api.g2code335.workers.dev/api/latest-release'), {});
    assert.equal(second.headers.get('x-yayra-cache'), 'HIT');
    assert.equal(upstreamCalls, 1, 'the second request must be served from the edge cache, not a new upstream call');
    assert.equal((await second.json()).tag_name, 'v0.1.9');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

// --- /auth/google/exchange (Web/PWA sign-in, server-side half) -----------
// The browser half (src/services/googleAuthWeb.js) never sees a client
// secret or a token; these tests prove the Worker holds up its side of that
// contract: secret attached server-side only, profile-only response, and
// honest errors when unconfigured or when Google rejects the code.

const EXCHANGE_URL = 'https://yayra-updates-api.g2code335.workers.dev/auth/google/exchange';
const AUTH_ENV = { GOOGLE_WEB_CLIENT_ID: 'web-id.apps.googleusercontent.com', GOOGLE_WEB_CLIENT_SECRET: 'server-side-secret' };

function exchangeRequest(body, method = 'POST') {
  return new Request(EXCHANGE_URL, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined
  });
}

test('auth exchange returns 501 not_configured when the Google client bindings are missing', async () => {
  const response = await worker.fetch(exchangeRequest({ code: 'c', codeVerifier: 'v', redirectUri: 'https://yayra.pages.dev/auth/callback' }), {});
  assert.equal(response.status, 501);
  assert.equal((await response.json()).error, 'not_configured');
});

test('auth exchange only accepts POST and rejects malformed bodies before touching Google', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('must not reach upstream'); };
  try {
    const get = await worker.fetch(new Request(EXCHANGE_URL), AUTH_ENV);
    assert.equal(get.status, 405);

    const badJson = await worker.fetch(new Request(EXCHANGE_URL, { method: 'POST', body: 'not json' }), AUTH_ENV);
    assert.equal(badJson.status, 400);
    assert.equal((await badJson.json()).error, 'invalid_json');

    const missing = await worker.fetch(exchangeRequest({ code: 'c' }), AUTH_ENV);
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error, 'missing_fields');

    const badUri = await worker.fetch(exchangeRequest({ code: 'c', codeVerifier: 'v', redirectUri: 'http://evil.example/cb' }), AUTH_ENV);
    assert.equal(badUri.status, 400);
    assert.equal((await badUri.json()).error, 'invalid_redirect_uri');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('auth exchange attaches the client secret server-side, forwards PKCE verifier, and returns ONLY the profile', async () => {
  const originalFetch = globalThis.fetch;
  const upstream = [];
  globalThis.fetch = async (target, options) => {
    upstream.push({ target: String(target), options });
    if (String(target).includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'ya29.secret', id_token: 'jwt.secret', refresh_token: 'should-not-exist' }), { status: 200 });
    }
    return new Response(JSON.stringify({ sub: '42', name: 'Ama Mensah', email: 'ama@example.com', picture: 'https://lh3.googleusercontent.com/a/p', email_verified: true }), { status: 200 });
  };
  try {
    const response = await worker.fetch(exchangeRequest({ code: 'one-shot-code', codeVerifier: 'pkce-verifier', redirectUri: 'https://yayra.pages.dev/auth/callback' }), AUTH_ENV);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('cache-control'), 'no-store');

    const tokenCall = upstream.find((u) => u.target.includes('/token'));
    const params = new URLSearchParams(tokenCall.options.body);
    assert.equal(params.get('code'), 'one-shot-code');
    assert.equal(params.get('code_verifier'), 'pkce-verifier');
    assert.equal(params.get('client_secret'), 'server-side-secret');
    assert.equal(params.get('grant_type'), 'authorization_code');

    const userinfoCall = upstream.find((u) => u.target.includes('userinfo'));
    assert.equal(userinfoCall.options.headers.Authorization, 'Bearer ya29.secret');

    const body = await response.json();
    assert.deepEqual(body, { profile: { sub: '42', name: 'Ama Mensah', email: 'ama@example.com', picture: 'https://lh3.googleusercontent.com/a/p' } });
    const raw = JSON.stringify(body);
    for (const needle of ['access_token', 'id_token', 'refresh_token', 'ya29.secret', 'jwt.secret']) {
      assert.equal(raw.includes(needle), false, `response must never contain ${needle}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('auth exchange serves Android/iOS clients WITHOUT a secret (public native clients) and accepts custom-scheme redirects', async () => {
  const originalFetch = globalThis.fetch;
  const upstream = [];
  globalThis.fetch = async (target, options) => {
    upstream.push({ target: String(target), options });
    if (String(target).includes('/token')) return new Response(JSON.stringify({ access_token: 'ya29.mobile' }), { status: 200 });
    return new Response(JSON.stringify({ sub: '9', name: 'Kofi', email: 'kofi@example.com', picture: 'p' }), { status: 200 });
  };
  const env = { GOOGLE_ANDROID_CLIENT_ID: 'android-id.apps.googleusercontent.com' };
  try {
    const response = await worker.fetch(exchangeRequest({ code: 'c', codeVerifier: 'v', redirectUri: 'com.yayra.app:/oauth2redirect', platform: 'android' }), env);
    assert.equal(response.status, 200);
    const params = new URLSearchParams(upstream[0].options.body);
    assert.equal(params.get('client_id'), 'android-id.apps.googleusercontent.com');
    assert.equal(params.get('client_secret'), null, 'native clients have no secret - Google rejects one it never issued');
    assert.equal(params.get('redirect_uri'), 'com.yayra.app:/oauth2redirect');
    assert.deepEqual(await response.json(), { profile: { sub: '9', name: 'Kofi', email: 'kofi@example.com', picture: 'p' } });

    // The same request without the matching platform binding is honestly unconfigured.
    const unconfigured = await worker.fetch(exchangeRequest({ code: 'c', codeVerifier: 'v', redirectUri: 'com.yayra.app:/oauth2redirect', platform: 'ios' }), env);
    assert.equal(unconfigured.status, 501);

    // And a web-platform request must NOT accept a custom-scheme redirect.
    const badScheme = await worker.fetch(exchangeRequest({ code: 'c', codeVerifier: 'v', redirectUri: 'com.yayra.app:/oauth2redirect', platform: 'web' }), AUTH_ENV);
    assert.equal(badScheme.status, 400);

    const badPlatform = await worker.fetch(exchangeRequest({ code: 'c', codeVerifier: 'v', redirectUri: 'com.yayra.app:/x', platform: 'desktop' }), env);
    assert.equal(badPlatform.status, 400);
    assert.equal((await badPlatform.json()).error, 'invalid_platform');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('auth exchange passes Google OAuth error codes through without echoing request contents', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Code was already redeemed.' }), { status: 400 });
  try {
    const response = await worker.fetch(exchangeRequest({ code: 'reused-code', codeVerifier: 'v', redirectUri: 'http://localhost:4173/auth/callback' }), AUTH_ENV);
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error, 'invalid_grant');
    assert.equal(JSON.stringify(body).includes('reused-code'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function makeFakeEdgeCache() {
  const store = new Map();
  return {
    async match(request) {
      const entry = store.get(request.url);
      if (!entry) return undefined;
      return new Response(entry.body, { status: entry.status, headers: entry.headers });
    },
    async put(request, response) {
      const body = await response.text();
      store.set(request.url, { status: response.status, headers: Object.fromEntries(response.headers), body });
    }
  };
}
