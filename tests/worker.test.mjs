import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/update-worker.mjs';

test('update worker serves manifest with cache, cors, etag and HEAD support', async () => {
  const request = new Request('https://updates.yayra.app/updates/manifest.json');
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.ok(response.headers.get('etag'));
  const body = await response.json();
  assert.equal(body.schema, 1);
  const head = await worker.fetch(new Request('https://updates.yayra.app/updates/manifest.json', { method: 'HEAD', headers: { 'if-none-match': response.headers.get('etag') } }), {});
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
    const suggestions = await worker.fetch(new Request('https://updates.yayra.app/api/suggestions?q=ghana'), {});
    assert.equal(suggestions.status, 200);
    assert.deepEqual(await suggestions.json(), ['gha', ['ghana', 'ghana news']]);
    assert.equal(suggestions.headers.get('access-control-allow-origin'), '*');

    const release = await worker.fetch(new Request('https://updates.yayra.app/api/latest-release'), {});
    assert.equal(release.status, 200);
    assert.equal((await release.json()).tag_name, 'v0.1.8');
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
