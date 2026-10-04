# Monitoring & crash reporting — current state and proposal

## What exists today (audited 2026-10)

| Surface | Current state |
|---|---|
| Update events | `UpdateService` has a telemetry seam, **default OFF** (`DEFAULT_UPDATE_CONFIG.telemetry: false` gates every emission). `src/browser/main.js` wires it to `navigator.sendBeacon('/telemetry/updates', …)` — an endpoint that **does not exist** anywhere (dev server, worker, Pages), so even if someone flipped the flag, events go nowhere. Harmless, but dead wiring. |
| Desktop crashes | Nothing. No Electron `crashReporter`, no uncaught-exception handler that persists reports. Crashes vanish. |
| Mobile crashes | Nothing beyond what Play Console / App Store Connect collect natively from consenting OS users (ANR/crash rates — do watch those consoles; they're free and already consent-managed by the OS). |
| Worker | `console.log` lines visible via `wrangler tail` / Cloudflare dashboard. Adequate for the worker's scope. |
| Web errors | Nothing (no `window.onerror`/`unhandledrejection` capture). |

## Constraints

Yayra is local-first and privacy-focused — the test suite itself asserts
no-network behaviors (`tests/no-network-guard.mjs`). Therefore:
**any telemetry/crash reporting must be opt-in (default off), clearly
disclosed in Settings, and must never include URLs the user browsed,
page contents, or tokens.**

## Proposal (requires a human decision before any code lands)

1. **Pick a backend you control.** Recommended: self-hosted **GlitchTip**
   (lightweight, Sentry-SDK-compatible, AGPL, runs on a $5 VPS or
   fly.io) or self-hosted Sentry if you want the full product. Avoid
   SaaS defaults for a privacy-branded app — self-hosting keeps the DSN
   under your control and the privacy-policy story simple
   ("crash data goes to our own server, only if you opt in").
2. **Desktop:** `electron.crashReporter.start({ submitURL, uploadToServer: optIn })`
   for native crashes + a main-process `uncaughtException` handler that
   writes a local breadcrumb file regardless of opt-in (local-only is
   privacy-free), uploading only when opted in.
3. **Web/PWA + Capacitor:** `@sentry/browser` (works against GlitchTip)
   initialized ONLY after opt-in, with `beforeSend` scrubbing: drop
   `request.url` query strings, strip any `yayra://`-internal navigation
   breadcrumbs, never attach user context beyond an anonymous install id.
4. **Settings UI:** a "Help improve Yayra" toggle (default off) under
   Settings → Privacy, with one-paragraph disclosure of exactly what is
   sent; store the choice in the same persistence layer as other settings.
5. **Update-event telemetry:** either delete the dead sendBeacon wiring or
   point it at a worker endpoint behind the same opt-in. Do not keep
   half-wired code indefinitely.

## Why nothing was auto-installed by this audit

Choosing a vendor/endpoint, standing up a server, and wording the
disclosure are product/legal decisions. Wiring an SDK before those exist
would either ship dead code or, worse, a default-on beacon that
contradicts the product's privacy promise.
