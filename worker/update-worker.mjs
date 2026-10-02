const DEFAULT_MANIFEST = {
  schema: 1,
  channel: 'stable',
  latest: { windows: '0.1.0', linux: '0.1.0', ios: '0.1.0', android: '0.1.0', pwa: '0.1.0' },
  minSupported: { windows: '0.1.0', linux: '0.1.0', ios: '0.1.0', android: '0.1.0', pwa: '0.1.0' },
  downloads: {},
  notes: { en: 'Initial ibrowse release infrastructure.' },
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
    if (!url.pathname.endsWith('/updates/manifest.json')) return new Response('not found', { status: 404 });
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    if (!take(ip, Date.now())) return new Response('rate limited', { status: 429, headers: baseHeaders() });
    const manifest = env?.UPDATES_MANIFEST_JSON ? JSON.parse(env.UPDATES_MANIFEST_JSON) : DEFAULT_MANIFEST;
    const body = JSON.stringify(manifest, null, 2);
    const etag = await sha256Etag(body);
    console.log(`[updates] manifest check ip=${ip} etag=${etag}`);
    const headers = { ...baseHeaders(), ETag: etag };
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers });
    return new Response(body, { status: 200, headers });
  }
};

function baseHeaders() {
  return {
    'access-control-allow-origin': '*',
    'cache-control': 'public, max-age=300',
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
