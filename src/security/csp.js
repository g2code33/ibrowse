export const DESKTOP_CUSTOM_SCHEME = 'yayra';
export const ASSET_ORIGINS = Object.freeze([
  'https://yayra.pages.dev',
  'https://icons.duckduckgo.com'
]);
export const API_ORIGINS = Object.freeze(['https://yayra-updates-api.g2code335.workers.dev']);

export function buildContentSecurityPolicy() {
  const scheme = `${DESKTOP_CUSTOM_SCHEME}:`;
  const imgSources = [`'self'`, 'data:', 'blob:', scheme, ...ASSET_ORIGINS];
  const connectSources = [`'self'`, scheme, ...API_ORIGINS];
  return [
    `default-src 'self' ${scheme}`,
    `script-src 'self' ${scheme}`,
    `style-src 'self' 'unsafe-inline' ${scheme}`,
    `img-src ${imgSources.join(' ')}`,
    `connect-src ${connectSources.join(' ')}`,
    // The browser shell intentionally hosts navigated HTTP(S) pages in its
    // sandboxed webview. frame-ancestors is an HTTP-response directive and is
    // ignored when this policy is delivered through the index meta tag.
    `frame-src http: https: ${scheme}`,
    `object-src 'none'`,
    `base-uri 'self'`
  ].join('; ');
}
