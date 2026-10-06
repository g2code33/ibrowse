/**
 * TRUE PWA INSTALL ("Install page as app...") - the pure parts.
 *
 * The user requirement: installing a site must install a PWA OF THAT SITE
 * to the user's desktop - the site's OWN name, OWN icon and OWN start
 * url - exactly like Chrome's "Install page as app", not a shortcut
 * stamped with the browser's identity.
 *
 * A real PWA declares itself through a Web App Manifest
 * (https://www.w3.org/TR/appmanifest/) linked from its HTML. This module
 * holds everything pure and unit-testable about reading that identity:
 *   - extractManifestLink(): find <link rel="manifest"> in the page HTML
 *   - parseManifest(): safe JSON parse
 *   - pickManifestIcon(): choose the best launcher icon (largest usable
 *     raster image; SVG/monochrome excluded - they cannot be written to
 *     an .lnk/.desktop icon without a rasterizer)
 *   - resolveStartUrl(): the manifest's start_url resolved per spec
 *   - pickInstallIdentity(): name + startUrl + icon + display/theme
 *     colors, with honest fallbacks for non-PWA sites
 *   - pngToIco(): wrap a PNG in an ICO container (Windows .lnk icons
 *     need .ico; Vista+ accepts PNG payloads inside ICO entries)
 *
 * electron/main.cjs does the network fetching and file writing.
 */

/** Magic-byte checks: the icon pipeline must never trust Content-Type. */
function isPngBuffer(buf) {
  return Buffer.isBuffer(buf) && buf.length > 24
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

function isIcoBuffer(buf) {
  return Buffer.isBuffer(buf) && buf.length > 22
    && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00;
}

/**
 * Find the Web App Manifest url in a page's HTML. Handles attribute
 * order both ways, single/double quotes, extra attributes (crossorigin,
 * media) and relative hrefs (resolved against the page url). Returns an
 * absolute https URL or null.
 */
function extractManifestLink(html, pageUrl) {
  try {
    const text = String(html || '').slice(0, 512 * 1024); // cap: head only matters
    const linkTags = text.match(/<link\b[^>]*>/gi) || [];
    for (const tag of linkTags) {
      const rel = /\brel\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
      const relValue = (rel && (rel[2] || rel[3] || rel[4] || '')).toLowerCase().trim();
      if (relValue !== 'manifest') continue;
      const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
      const hrefValue = href && (href[2] || href[3] || href[4] || '');
      if (!hrefValue) continue;
      try {
        const abs = new URL(hrefValue, pageUrl);
        if (abs.protocol !== 'https:' && abs.protocol !== 'http:') continue;
        return abs.toString();
      } catch { /* unresolvable href - try the next tag */ }
    }
    return null;
  } catch {
    return null;
  }
}

/** Safe JSON parse of the manifest body; any garbage -> null. */
function parseManifest(jsonText) {
  try {
    const data = JSON.parse(String(jsonText));
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Pick the best launcher icon from the manifest's icons array. Scoring:
 *   - raster only (PNG preferred; bare src with no type is given the
 *     benefit of the doubt; SVG and monochrome icons are skipped - they
 *     cannot become an .lnk/.desktop icon without a rasterizer)
 *   - bigger wins; purpose 'maskable' counts (launchers crop it safely);
 *     'monochrome' never does
 * Returns { src, width, height } with an ABSOLUTE url, or null.
 */
function pickManifestIcon(manifest, manifestUrl) {
  try {
    const icons = manifest && Array.isArray(manifest.icons) ? manifest.icons : [];
    let best = null;
    let bestScore = -1;
    for (const icon of icons) {
      if (!icon || typeof icon.src !== 'string' || icon.src === '') continue;
      const type = String(icon.type || '').toLowerCase().trim();
      if (type === 'svg' || /\.svg(\?|#|$)/i.test(icon.src)) continue;
      if (type && type !== 'png' && type !== 'image/png' && type !== 'image/jpeg' && type !== 'image/webp' && type !== 'image/vnd.microsoft.icon' && type !== 'image/x-icon') continue;
      const purpose = String(icon.purpose || 'any').toLowerCase().split(/\s+/);
      if (purpose.includes('monochrome') && !purpose.includes('any') && !purpose.includes('maskable')) continue;
      let width = 0;
      let height = 0;
      const sizes = String(icon.sizes || '').trim().toLowerCase();
      const m = /^(\d+)\s*x\s*(\d+)$/.exec(sizes);
      if (m) {
        width = Number(m[1]);
        height = Number(m[2]);
      } else if (sizes === 'any') {
        width = 512; // scalable: assume at least the common largest raster
        height = 512;
      }
      const typeBonus = (type === 'png' || type === 'image/png') ? 1.5 : 1;
      const score = width * height * typeBonus;
      if (score > bestScore) {
        bestScore = score;
        let abs = null;
        try { abs = new URL(icon.src, manifestUrl).toString(); } catch { abs = null; }
        if (abs) best = { src: abs, width, height };
        else { best = null; bestScore = -1; }
      }
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * The PWA's start url: manifest start_url resolved against the MANIFEST
 * url (per the spec), falling back to the page's own url. http(s) only.
 */
function resolveStartUrl(manifest, manifestUrl, pageUrl) {
  const raw = manifest && typeof manifest.start_url === 'string' ? manifest.start_url : '';
  const base = manifestUrl || pageUrl;
  if (raw) {
    try {
      const abs = new URL(raw, base);
      if (abs.protocol === 'https:' || abs.protocol === 'http:') return abs.toString();
    } catch { /* fall through to the page url */ }
  }
  return pageUrl;
}

/**
 * The full install identity for a site: what shows on the user's
 * desktop. Falls back honestly for sites without a manifest.
 * Returns { name, startUrl, iconSrc|null, display, themeColor,
 * backgroundColor, pwa }.
 */
function pickInstallIdentity({ manifest, manifestUrl, pageUrl, pageTitle }) {
  let hostname = 'App';
  try { hostname = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { /* keep default */ }
  const manifestName = manifest
    ? String(manifest.short_name || manifest.name || '').trim().slice(0, 60)
    : '';
  const name = manifestName || String(pageTitle || '').trim().slice(0, 60) || hostname;
  const icon = manifest ? pickManifestIcon(manifest, manifestUrl) : null;
  return {
    name,
    startUrl: resolveStartUrl(manifest, manifestUrl, pageUrl),
    iconSrc: icon ? icon.src : null,
    display: manifest && typeof manifest.display === 'string' ? manifest.display : 'standalone',
    themeColor: manifest && typeof manifest.theme_color === 'string' ? manifest.theme_color : null,
    backgroundColor: manifest && typeof manifest.background_color === 'string' ? manifest.background_color : null,
    pwa: Boolean(manifestName && icon)
  };
}

/**
 * Wrap a PNG in an ICO container so a Windows .lnk can use it as its
 * icon (shell.writeShortcutLink needs .ico; Vista+ accepts a PNG payload
 * inside an ICO entry). Width/height of 256+ are encoded as 0 per the
 * ICO spec. Throws for non-PNG input - callers fall back honestly.
 */
function pngToIco(png) {
  if (!isPngBuffer(png)) throw new Error('not-a-png');
  const width = png.readUInt32BE(16);  // IHDR width
  const height = png.readUInt32BE(20); // IHDR height
  const ico = Buffer.alloc(22 + png.length);
  ico.writeUInt16LE(0, 0);                      // reserved
  ico.writeUInt16LE(1, 2);                      // type: icon
  ico.writeUInt16LE(1, 4);                      // image count
  ico.writeUInt8(width >= 256 ? 0 : width, 6);  // 0 means 256
  ico.writeUInt8(height >= 256 ? 0 : height, 7);
  ico.writeUInt8(0, 8);                         // palette color count
  ico.writeUInt8(0, 9);                         // reserved
  ico.writeUInt16LE(1, 10);                     // color planes
  ico.writeUInt16LE(32, 12);                    // bits per pixel
  ico.writeUInt32LE(png.length, 14);            // payload size
  ico.writeUInt32LE(22, 18);                    // payload offset
  png.copy(ico, 22);
  return ico;
}

module.exports = {
  isPngBuffer,
  isIcoBuffer,
  extractManifestLink,
  parseManifest,
  pickManifestIcon,
  resolveStartUrl,
  pickInstallIdentity,
  pngToIco
};
