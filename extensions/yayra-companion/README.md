# Yayra Web Companion

This is the real browser-extension project for external websites. A PWA cannot inject scripts into arbitrary cross-origin pages or block their network requests: the browser security model prevents the Yayra web app from reaching inside the external iframe. The companion therefore runs in the browser extension host instead of pretending that the PWA toggle can do it.

It currently provides:

- real Manifest V3 `declarativeNetRequest` tracker rules;
- real content-script ad and sponsored-element hiding;
- dark reader mode;
- clean reader mode;
- a popup and an on-page control panel;
- persistent settings through `chrome.storage.sync`.

## Load from a terminal

From the repository root, package it for Chromium browsers:

```bash
cd extensions/yayra-companion
zip -r ../../yayra-web-companion-0.1.0.zip .
```

Then open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this directory. The same source can be adapted for Firefox's temporary add-on loader.

The PWA's `yayra://extensions` page links to this project and clearly separates in-app extension preferences from controls that require a real browser extension host.
