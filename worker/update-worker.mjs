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
    if (!['/updates/manifest.json', '/api/suggestions', '/api/latest-release', '/auth/google/exchange'].includes(url.pathname)) {
      return new Response('not found', { status: 404 });
    }

    const headers = baseHeaders();
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    if (!take(ip, Date.now())) return new Response('rate limited', { status: 429, headers });

    if (url.pathname === '/api/suggestions') return proxySuggestions(request, url, headers, ctx);
    if (url.pathname === '/api/latest-release') return proxyLatestRelease(request, headers, env, ctx);
    if (url.pathname === '/auth/google/exchange') return exchangeGoogleAuthCode(request, headers, env);
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

/**
 * Server-side half of the Web/PWA "Sign in with Google" flow (the browser
 * half is src/services/googleAuthWeb.js; architecture + threat model in
 * docs/GOOGLE_SIGNIN.md).
 *
 * WHY THIS EXISTS: Google's token endpoint requires a client_secret for
 * "Web application" OAuth clients even with PKCE, and a secret cannot live
 * in browser-delivered JS. So the browser sends ONLY its one-shot
 * authorization code + PKCE code_verifier here; this Worker (holding
 * GOOGLE_WEB_CLIENT_ID / GOOGLE_WEB_CLIENT_SECRET as bindings - wrangler
 * secret put, never committed) performs the code-for-token exchange AND the
 * userinfo fetch, then returns ONLY the basic profile. The access token is
 * a local variable in this function and is gone when it returns - raw
 * tokens are never stored anywhere and never sent to any client, which is
 * a STRONGER guarantee than the desktop build (where tokens at least exist
 * encrypted on the user's own machine).
 *
 * The Android/iOS (Capacitor) flow reuses this endpoint with
 * `platform: 'android' | 'ios'` (see src/services/googleAuthCapacitor.js).
 * Those Google client types have NO secret (they're verified by package
 * name + SHA-1 / bundle ID), so only GOOGLE_ANDROID_CLIENT_ID /
 * GOOGLE_IOS_CLIENT_ID bindings are needed - the server-side exchange is
 * kept anyway so raw tokens never exist in the app's JS context either.
 *
 * Replay/abuse resistance: the code is single-use and PKCE-bound (Google
 * enforces both), redirect_uri must match a URI registered on the Google
 * client, and the Worker's existing per-IP rate limiter applies.
 */
function resolveGoogleClient(env, platform) {
  if (platform === 'android') {
    return env?.GOOGLE_ANDROID_CLIENT_ID ? { clientId: env.GOOGLE_ANDROID_CLIENT_ID, clientSecret: null } : null;
  }
  if (platform === 'ios') {
    return env?.GOOGLE_IOS_CLIENT_ID ? { clientId: env.GOOGLE_IOS_CLIENT_ID, clientSecret: null } : null;
  }
  if (platform === 'web') {
    return env?.GOOGLE_WEB_CLIENT_ID && env?.GOOGLE_WEB_CLIENT_SECRET
      ? { clientId: env.GOOGLE_WEB_CLIENT_ID, clientSecret: env.GOOGLE_WEB_CLIENT_SECRET }
      : null;
  }
  return null;
}

function isAcceptableRedirectUri(redirectUri, platform) {
  let redirect;
  try {
    redirect = new URL(redirectUri);
  } catch {
    return false;
  }
  if (platform === 'android' || platform === 'ios') {
    // RFC 8252 custom scheme (com.yayra.app:/oauth2redirect) or an HTTPS
    // app link. Google is the real enforcement point either way.
    return redirect.protocol !== 'http:';
  }
  const isLocalhost = redirect.hostname === 'localhost' || redirect.hostname === '127.0.0.1';
  return redirect.protocol === 'https:' || (redirect.protocol === 'http:' && isLocalhost);
}

async function exchangeGoogleAuthCode(request, headers, env) {
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers });
  }
  const code = typeof body?.code === 'string' ? body.code : '';
  const codeVerifier = typeof body?.codeVerifier === 'string' ? body.codeVerifier : '';
  const redirectUri = typeof body?.redirectUri === 'string' ? body.redirectUri : '';
  const platform = typeof body?.platform === 'string' ? body.platform : 'web';
  if (!['web', 'android', 'ios'].includes(platform)) {
    return new Response(JSON.stringify({ error: 'invalid_platform' }), { status: 400, headers });
  }
  const client = resolveGoogleClient(env, platform);
  if (!client) {
    return new Response(JSON.stringify({ error: 'not_configured' }), { status: 501, headers });
  }
  if (!code || !codeVerifier || !redirectUri) {
    return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400, headers });
  }
  if (!isAcceptableRedirectUri(redirectUri, platform)) {
    return new Response(JSON.stringify({ error: 'invalid_redirect_uri' }), { status: 400, headers });
  }

  const tokenParams = new URLSearchParams({
    code,
    code_verifier: codeVerifier,
    client_id: client.clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });
  // Only the Web client type has (and requires) a secret; Android/iOS
  // clients are public and Google rejects a secret param it never issued.
  if (client.clientSecret) tokenParams.set('client_secret', client.clientSecret);

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString()
  });
  if (!tokenResponse.ok) {
    // Pass Google's OAuth error code through (useful: invalid_grant =
    // expired/reused code) but never echo request contents back.
    let detail = 'token_exchange_failed';
    try { detail = (await tokenResponse.json())?.error || detail; } catch { /* keep generic */ }
    console.log(`[auth] google exchange failed status=${tokenResponse.status} error=${detail}`);
    return new Response(JSON.stringify({ error: detail }), { status: 502, headers });
  }
  const tokens = await tokenResponse.json();
  if (!tokens?.access_token) {
    return new Response(JSON.stringify({ error: 'token_exchange_malformed' }), { status: 502, headers });
  }

  const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  if (!userinfoResponse.ok) {
    console.log(`[auth] google userinfo failed status=${userinfoResponse.status}`);
    return new Response(JSON.stringify({ error: 'userinfo_failed' }), { status: 502, headers });
  }
  const userinfo = await userinfoResponse.json();
  // Profile only. Explicitly reconstruct the object so no token-ish field
  // can ever ride along, and drop the tokens on the floor right here.
  const profile = { sub: userinfo.sub, name: userinfo.name, email: userinfo.email, picture: userinfo.picture };
  return new Response(JSON.stringify({ profile }), { status: 200, headers: { ...headers, 'cache-control': 'no-store' } });
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
    'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
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
