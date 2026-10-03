const STYLE_ID = 'yayra-companion-style';
const PANEL_ID = 'yayra-companion-panel';
const HIDDEN_CLASS = 'yayra-companion-hidden-ad';
let state = { shield: true, darkReader: false, readerMode: false };
let observer;

const shieldSelectors = [
  '[aria-label*="advertisement" i]',
  '[aria-label*="sponsored" i]',
  '[data-ad-slot]',
  '[data-ad-client]',
  '[data-google-query-id]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="adservice.google.com"]',
  'ins.adsbygoogle',
  '.ad-container',
  '.advertisement',
  '.advertising',
  '.sponsored-content'
];

const styleText = () => `
  ${state.shield ? `${shieldSelectors.join(',')} { display: none !important; }` : ''}
  ${state.darkReader ? `
    html.yayra-companion-dark { background: #111 !important; }
    html.yayra-companion-dark body { background: #171717 !important; color: #e8e8e8 !important; }
    html.yayra-companion-dark body :not(img):not(video):not(canvas):not(svg) { background-color: transparent !important; color: #e8e8e8 !important; border-color: #444 !important; }
    html.yayra-companion-dark img, html.yayra-companion-dark video, html.yayra-companion-dark canvas { filter: brightness(.82) contrast(1.08) !important; }
    html.yayra-companion-dark a { color: #8ab4f8 !important; }
  ` : ''}
  ${state.readerMode ? `
    html.yayra-companion-reader body > :not(main):not(article):not([role="main"]) { display: none !important; }
    html.yayra-companion-reader main, html.yayra-companion-reader article, html.yayra-companion-reader [role="main"] { max-width: 760px !important; margin: 2rem auto !important; padding: 0 1.25rem !important; line-height: 1.75 !important; font-size: 1.08rem !important; }
    html.yayra-companion-reader img, html.yayra-companion-reader video { max-width: 100% !important; height: auto !important; }
  ` : ''}
`;

function applyState() {
  document.documentElement.classList.toggle('yayra-companion-dark', Boolean(state.darkReader));
  document.documentElement.classList.toggle('yayra-companion-reader', Boolean(state.readerMode));
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  style.textContent = styleText();
  if (state.shield) hideKnownAds();
}

function hideKnownAds() {
  for (const selector of shieldSelectors) {
    document.querySelectorAll(selector).forEach((element) => element.classList.add(HIDDEN_CLASS));
  }
}

function togglePanel() {
  const existing = document.getElementById(PANEL_ID);
  if (existing) {
    existing.remove();
    return;
  }
  const panel = document.createElement('aside');
  panel.id = PANEL_ID;
  panel.style.cssText = 'position:fixed;z-index:2147483647;right:16px;top:16px;width:260px;padding:16px;border:1px solid #38bdf8;border-radius:14px;background:#081226;color:#f8fafc;box-shadow:0 12px 40px #0008;font:14px system-ui,sans-serif;';
  panel.innerHTML = '<strong style="display:block;margin-bottom:12px">Yayra Web Companion</strong>' +
    ['shield:Block ads and trackers', 'darkReader:Dark reader', 'readerMode:Clean reader mode'].map((entry) => {
      const [key, label] = entry.split(':');
      return `<label style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="checkbox" data-yayra-key="${key}" ${state[key] ? 'checked' : ''}>${label}</label>`;
    }).join('');
  panel.querySelectorAll('[data-yayra-key]').forEach((input) => input.addEventListener('change', async () => {
    state[input.dataset.yayraKey] = input.checked;
    await chrome.storage.sync.set(state);
    applyState();
  }));
  document.documentElement.appendChild(panel);
}

chrome.storage.sync.get(state).then((stored) => {
  state = { ...state, ...stored };
  applyState();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'yayra-toggle-panel') togglePanel();
  if (message?.type === 'yayra-apply-state') chrome.storage.sync.get(state).then((stored) => { state = { ...state, ...stored }; applyState(); });
});

observer = new MutationObserver(() => {
  if (state.shield) hideKnownAds();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
