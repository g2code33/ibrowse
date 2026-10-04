'use strict';

/**
 * Phone QR approval for the desktop vault (passkey fallback #3).
 *
 * WHAT THIS IS (honest scope): a LOCAL-NETWORK possession proof. The PC
 * starts a one-shot HTTP listener on an ephemeral port and shows a QR
 * code containing http://<lan-ip>:<port>/a/<128-bit-one-time-token>.
 * Only a device that physically SAW the PC's screen can know that URL;
 * scanning it on a phone opens an approval page served BY THE PC ITSELF
 * (no cloud, no account), and tapping "Approve" completes the vault
 * verification. The token is single-use and the whole session expires
 * after 2 minutes, then the listener shuts down.
 *
 * WHAT IT IS NOT: cross-device WebAuthn (CTAP hybrid) - that needs the
 * platform's BLE/cloud stack. And because the approval page is plain
 * HTTP on the LAN, someone sniffing the local network during the two
 * minute window could theoretically capture the token - which is why
 * this is a FALLBACK for devices with no biometrics/keychain, not the
 * default, and why the phone page shows what is being approved.
 */

function createPhoneApproval({
  httpImpl,
  osImpl,
  randomBytesImpl,
  ttlMs = 2 * 60 * 1000,
  logger = console
}) {
  let server = null;
  let token = null;
  let state = 'idle'; // idle | pending | approved | denied | expired
  let expiresAt = 0;
  let expireTimer = null;
  let sessionReason = '';

  function lanAddress() {
    try {
      const nets = osImpl.networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
          const familyV4 = net.family === 'IPv4' || net.family === 4;
          if (familyV4 && !net.internal && net.address) return net.address;
        }
      }
    } catch { /* fall through */ }
    return null;
  }

  function stop({ finalState = 'idle' } = {}) {
    if (expireTimer) { clearTimeout(expireTimer); expireTimer = null; }
    if (server) {
      try { server.close(); } catch { /* already closed */ }
      server = null;
    }
    token = null;
    if (finalState) state = finalState;
    return { ok: true, state };
  }

  function approvalPage() {
    return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Yayra - approve on this phone</title>
<style>
  body { margin:0; font-family:system-ui,sans-serif; background:#101218; color:#f3f4f6;
         display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .card { max-width:360px; padding:28px; text-align:center; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { color:#9ca3af; font-size:14px; line-height:1.5; }
  .reason { color:#f3f4f6; font-weight:600; }
  button { width:100%; padding:14px; margin-top:12px; border:none; border-radius:12px;
           font-size:16px; font-weight:600; cursor:pointer; }
  .ok { background:#6d5df2; color:#fff; }
  .no { background:#272b36; color:#f3f4f6; }
</style></head><body><div class="card">
  <h1>Approve on your PC?</h1>
  <p>Your computer is asking to <span class="reason">${escapeHtml(sessionReason || 'unlock the Yayra vault')}</span>.
  Only approve if YOU just scanned this QR code on your own PC.</p>
  <button class="ok" onclick="respond('approve')">Approve</button>
  <button class="no" onclick="respond('deny')">Deny</button>
  <p id="done" hidden>Done - you can return to your PC.</p>
  <script>
    function respond(action) {
      fetch('/r/' + action, { method: 'POST' }).then(function () {
        document.getElementById('done').hidden = false;
        document.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      });
    }
  </script>
</div></body></html>`;
  }

  function handleRequest(req, res) {
    const url = String(req.url || '');
    if (state !== 'pending' || !token) {
      res.writeHead(410, { 'Content-Type': 'text/plain' });
      res.end('This approval session has ended.');
      return;
    }
    if (req.method === 'GET' && url === `/a/${token}`) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(approvalPage());
      return;
    }
    if (req.method === 'POST' && (url === '/r/approve' || url === '/r/deny')) {
      // The phone could only reach this server by loading /a/<token>
      // first (the QR). Resolve the session and shut the listener down.
      const approved = url.endsWith('approve');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(approved ? 'Approved - return to your PC.' : 'Denied.');
      logger?.log?.(`[yayra:phone-approval] session ${approved ? 'APPROVED' : 'denied'} from ${req.socket?.remoteAddress || 'phone'}`);
      // Give the response a moment to flush before closing the server.
      setTimeout(() => stop({ finalState: approved ? 'approved' : 'denied' }), 300);
      state = approved ? 'approved' : 'denied';
      return;
    }
    // Unknown path or wrong token: reveal nothing.
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found.');
  }

  function start({ reason = 'unlock the Yayra vault' } = {}) {
    return new Promise((resolve) => {
      stop({ finalState: 'idle' });
      const ip = lanAddress();
      if (!ip) {
        resolve({ ok: false, reason: 'no-lan' });
        return;
      }
      sessionReason = String(reason);
      token = randomBytesImpl(16).toString('hex');
      state = 'pending';
      try {
        server = httpImpl.createServer(handleRequest);
        server.on('error', (err) => {
          logger?.warn?.(`[yayra:phone-approval] server error: ${err?.message || err}`);
          stop({ finalState: 'idle' });
          resolve({ ok: false, reason: 'listen-failed' });
        });
        server.listen(0, '0.0.0.0', () => {
          const port = server.address().port;
          expiresAt = Date.now() + ttlMs;
          expireTimer = setTimeout(() => {
            if (state === 'pending') stop({ finalState: 'expired' });
          }, ttlMs);
          if (typeof expireTimer.unref === 'function') expireTimer.unref();
          const url = `http://${ip}:${port}/a/${token}`;
          logger?.log?.(`[yayra:phone-approval] session started (expires in ${Math.round(ttlMs / 1000)}s)`);
          resolve({ ok: true, url, expiresAt });
        });
      } catch (err) {
        stop({ finalState: 'idle' });
        resolve({ ok: false, reason: String(err?.message || err) });
      }
    });
  }

  function status() {
    if (state === 'pending' && Date.now() > expiresAt) {
      stop({ finalState: 'expired' });
    }
    return { state, expiresAt: state === 'pending' ? expiresAt : null };
  }

  function cancel() {
    return stop({ finalState: 'idle' });
  }

  return { start, status, cancel, lanAddress };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

module.exports = { createPhoneApproval };
