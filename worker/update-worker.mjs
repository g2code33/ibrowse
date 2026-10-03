const DEFAULT_MANIFEST = {
  schema: 1,
  channel: 'stable',
  latest: { windows: '0.1.0', linux: '0.1.0', ios: '0.1.0', android: '0.1.0', pwa: '0.1.0' },
  minSupported: { windows: '0.1.0', linux: '0.1.0', ios: '0.1.0', android: '0.1.0', pwa: '0.1.0' },
  downloads: {},
  notes: { en: 'Initial yayra release infrastructure.' },
  rollout: { percent: 100, allowlist: [] },
  publishedAt: '2026-10-02T00:00:00.000Z',
  ttlSeconds: 300
};

const WINDOW_MS = 60_000;
const LIMIT = 120;
const buckets = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return new Response('HTTPS required', { status: 400 });
    if (!['/updates/manifest.json', '/api/suggestions', '/api/latest-release'].includes(url.pathname)) {
      return new Response('not found', { status: 404 });
    }

    const headers = baseHeaders();
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    if (!take(ip, Date.now())) return new Response('rate limited', { status: 429, headers });

    if (url.pathname === '/api/suggestions') return proxySuggestions(request, url, headers, ctx);
    if (url.pathname === '/api/latest-release') return proxyLatestRelease(request, headers, env, ctx);
    return serveManifest(request, env, headers);
  }
};

async function serveManifest(request, env, headers) {
  const manifest = readManifest(env);
  const body = JSON.stringify(manifest, null, 2);
  const etag = await sha256Etag(body);
  console.log(`[updates] manifest check ip=${request.headers.get('cf-connecting-ip') || 'unknown'} etag=${etag}`);
  const responseHeaders = { ...headers, ETag: etag, 'cache-control': 'public, max-age=300' };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: responseHeaders });
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: responseHeaders });
  if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers: responseHeaders });
  return new Response(body, { status: 200, headers: responseHeaders });
}

async function proxySuggestions(request, url, headers, ctx) {
  if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers });
  const query = (url.searchParams.get('q') || '').trim().slice(0, 200);
  if (!query) return new Response(JSON.stringify(['', []]), { status: 200, headers });
  const upstreamUrl = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(query)}`;
  return proxyJson(upstreamUrl, headers, {}, ctx, 'public, max-age=60');
}

/**
 * GitHub's REST API allows only 60 unauthenticated requests/hour, and that
 * quota is keyed by the calling IP - which for a Cloudflare Worker is drawn
 * from Cloudflare's shared edge egress range, not a dedicated address. That
 * means this endpoint can get rate-limited by *other* Workers' traffic
 * entirely outside yayra's control, independent of this Worker's own
 * per-client rate limiter above. Two defenses, both applied:
 *   1. An edge Cache API layer in proxyJson() below, so repeat requests
 *      within the cache TTL never reach GitHub at all.
 *   2. Optional GITHUB_TOKEN support here: if a token is bound to the
 *      Worker (wrangler secret put GITHUB_TOKEN - never committed to the
 *      repo or wrangler.worker.toml), GitHub's authenticated quota of
 *      5,000 requests/hour applies instead of the shared 60/hour pool.
 *      Falls back to the previous unauthenticated behavior when unset.
 */
async function proxyLatestRelease(request, headers, env, ctx) {
  if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers });
  const requestHeaders = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'yayra-updates-api',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (env?.GITHUB_TOKEN) requestHeaders.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return proxyJson('https://api.github.com/repos/g2code33/yayra/releases/latest', headers, requestHeaders, ctx, 'public, max-age=300');
}

async function proxyJson(target, headers, requestHeaders = {}, ctx, cacheControl = 'public, max-age=60') {
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(target, { method: 'GET' });

  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const body = await cached.text();
      return new Response(body, { status: cached.status, headers: { ...headers, 'cache-control': cacheControl, 'x-yayra-cache': 'HIT' } });
    }
  }

  try {
    const upstream = await fetch(target, { headers: requestHeaders });
    const body = await upstream.text();
    if (cache && upstream.ok) {
      const toCache = new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cacheControl }
      });
      const putPromise = cache.put(cacheKey, toCache);
      if (ctx?.waitUntil) ctx.waitUntil(putPromise);
      else await putPromise;
    }
    return new Response(body, {
      status: upstream.ok ? 200 : 502,
      headers: { ...headers, 'cache-control': cacheControl, 'x-yayra-cache': 'MISS' }
    });
  } catch {
    return new Response(JSON.stringify({ error: 'upstream unavailable' }), { status: 502, headers });
  }
}

function readManifest(env) {
  if (!env?.UPDATES_MANIFEST_JSON) return DEFAULT_MANIFEST;
  try {
    return JSON.parse(env.UPDATES_MANIFEST_JSON);
  } catch {
    return DEFAULT_MANIFEST;
  }
}

function baseHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'Accept, Content-Type',
    'content-type': 'application/json; charset=utf-8'
  };
}

function take(key, now) {
  const bucket = buckets.get(key) || { at: now, count: 0 };
  if (now - bucket.at > WINDOW_MS) {
    bucket.at = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  return bucket.count <= LIMIT;
}

async function sha256Etag(body) {
  const data = new TextEncoder().encode(body);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return `"${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}"`;
}
