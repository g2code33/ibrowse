// Yayra autofill preload - injected into every page-rendering
// WebContentsView (sandboxed, contextIsolation on, zero node access for
// the page). Gives Yayra the same two abilities Chrome's built-in
// password manager has on real websites:
//
//   1. CAPTURE: detect a login/sign-up submission and report
//      { url, username, password } to the main process, which routes it
//      to the owning shell window as a "Save password?" prompt.
//   2. FILL: receive saved credentials from the shell and type them into
//      the page's login fields (dispatching real input events so React/
//      Vue/Angular forms register the values).
//
// Nothing here is exposed to the page: no contextBridge API is published,
// listeners run in the isolated preload world only.

const { ipcRenderer } = require('electron');

const CAPTURE_CHANNEL = 'yayra:autofill-captured';
const DETECTED_CHANNEL = 'yayra:autofill-form-detected';
const FILL_CHANNEL = 'yayra:autofill-fill';

const USERNAME_SELECTOR = [
  'input[type="email"]',
  'input[type="text"]',
  'input[type="tel"]',
  'input:not([type])'
].join(',');

function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect?.();
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

function findUsernameFor(passwordInput) {
  const form = passwordInput.form;
  const scope = form || document;
  const candidates = Array.from(scope.querySelectorAll(USERNAME_SELECTOR))
    .filter((el) => el !== passwordInput && !el.disabled);
  if (candidates.length === 0) return null;
  // Prefer autocomplete hints, then the closest field ABOVE the password.
  const hinted = candidates.find((el) => /username|email/i.test(el.getAttribute('autocomplete') || '')
    || /user|email|login|account|phone/i.test(`${el.name || ''} ${el.id || ''} ${el.placeholder || ''}`));
  if (hinted) return hinted;
  let best = null;
  for (const el of candidates) {
    if (el.compareDocumentPosition(passwordInput) & Node.DOCUMENT_POSITION_FOLLOWING) best = el;
  }
  return best || candidates[0];
}

function collectCredential(passwordInput) {
  if (!passwordInput || !passwordInput.value) return null;
  // Ignore fields the site marks as new-password confirmations with no value yet
  const usernameInput = findUsernameFor(passwordInput);
  return {
    url: String(location.href || ''),
    username: usernameInput ? String(usernameInput.value || '').trim() : '',
    password: String(passwordInput.value)
  };
}

function activePasswordInput(scope) {
  const inputs = Array.from((scope || document).querySelectorAll('input[type="password"]'))
    .filter((el) => !el.disabled && el.value);
  // Prefer a visible one; hidden fields are usually anti-bot honeypots.
  return inputs.find(isVisible) || inputs[0] || null;
}

let lastSent = null;
function report(credential) {
  if (!credential || !credential.password || !credential.username) return;
  const sig = `${credential.url}|${credential.username}|${credential.password}`;
  if (sig === lastSent) return; // same submission observed twice (submit + click)
  lastSent = sig;
  try { ipcRenderer.send(CAPTURE_CHANNEL, credential); } catch { /* detached */ }
}

// 1) Classic form submission.
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!form || !form.querySelectorAll) return;
  const pwd = activePasswordInput(form);
  if (pwd) report(collectCredential(pwd));
}, true);

// 2) SPA logins that never fire submit: Enter inside a password field or
//    a click on a submit-looking button while a password field is filled.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const target = event.target;
  if (target && target.matches && target.matches('input[type="password"]') && target.value) {
    report(collectCredential(target));
  }
}, true);

document.addEventListener('click', (event) => {
  const btn = event.target && event.target.closest
    ? event.target.closest('button, input[type="submit"], [role="button"]')
    : null;
  if (!btn) return;
  const label = `${btn.textContent || ''} ${btn.value || ''} ${btn.getAttribute?.('aria-label') || ''}`;
  if (!/log\s*in|sign\s*in|sign\s*up|register|continue|submit|next/i.test(label)) return;
  const pwd = activePasswordInput(btn.form || document);
  if (pwd) report(collectCredential(pwd));
}, true);

// 3) Tell the shell when a login form exists so it can offer autofill.
function announceFormsIfAny() {
  const pwd = document.querySelector('input[type="password"]');
  if (pwd) {
    try { ipcRenderer.send(DETECTED_CHANNEL, { url: String(location.href || '') }); } catch { /* detached */ }
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', announceFormsIfAny);
} else {
  announceFormsIfAny();
}
// SPAs mount login forms late - watch briefly after load as well.
let announceTicks = 0;
const announceTimer = setInterval(() => {
  announceTicks += 1;
  announceFormsIfAny();
  if (announceTicks >= 10) clearInterval(announceTimer);
}, 1500);

// 4) Fill saved credentials on request from the shell.
function setNativeValue(input, value) {
  const proto = Object.getPrototypeOf(input);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value')
    || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (desc && desc.set) desc.set.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

ipcRenderer.on(FILL_CHANNEL, (_event, { username, password } = {}) => {
  try {
    const pwdInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(isVisible);
    const pwd = pwdInputs[0] || document.querySelector('input[type="password"]');
    if (!pwd) return;
    if (typeof password === 'string' && password) setNativeValue(pwd, password);
    const userInput = findUsernameFor(pwd);
    if (userInput && typeof username === 'string' && username && !userInput.value) {
      setNativeValue(userInput, username);
    }
  } catch { /* never break the page */ }
});
