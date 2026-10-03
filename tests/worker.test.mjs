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
