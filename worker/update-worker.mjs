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
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return new Response('HTTPS required', { status: 400 });
    if (!['/updates/manifest.json', '/api/suggestions', '/api/latest-release'].includes(url.pathname)) {
      return new Response('not found', { status: 404 });
    }

    const headers = baseHeaders();
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    if (!take(ip, Date.now())) return new Response('rate limited', { status: 429, headers });

    if (url.pathname === '/api/suggestions') return proxySuggestions(request, url, headers);
    if (url.pathname === '/api/latest-release') return proxyLatestRelease(request, headers);
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

async function proxySuggestions(request, url, headers) {
  if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers });
  const query = (url.searchParams.get('q') || '').trim().slice(0, 200);
  if (!query) return new Response(JSON.stringify(['', []]), { status: 200, headers });
  const upstreamUrl = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(query)}`;
  return proxyJson(upstreamUrl, headers);
}

async function proxyLatestRelease(request, headers) {
  if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers });
  return proxyJson('https://api.github.com/repos/g2code33/yayra/releases/latest', headers, {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'yayra-updates-api'
  });
}

async function proxyJson(target, headers, requestHeaders = {}) {
  try {
    const upstream = await fetch(target, { headers: requestHeaders });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.ok ? 200 : 502,
      headers: { ...headers, 'cache-control': 'public, max-age=60' }
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
