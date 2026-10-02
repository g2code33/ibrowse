export const DESKTOP_CUSTOM_SCHEME = 'ibrowse';
export const ASSET_ORIGINS = Object.freeze(['https://ibrowse.pages.dev']);
export const API_ORIGINS = Object.freeze(['https://updates.ibrowse.app']);

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
    `object-src 'none'`,
    `base-uri 'self'`,
    `frame-ancestors 'none'`
  ].join('; ');
}
