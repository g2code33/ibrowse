/**
 * YAYRA DOCUMENT WORKSPACE - the core abstraction (Phase 1: PDF).
 *
 * Design contract (docs/DOCUMENT_WORKSPACE.md):
 *  - Documents open in their OWN tab (`yayra://doc/<id>`) through the
 *    existing tab system - never by navigating a browsing tab away from
 *    its site.
 *  - Every engine reports its capabilities EXPLICITLY. The UI never
 *    implies an operation the engine does not support (no placeholder
 *    buttons for editing/annotation/export).
 *  - Documents are local-first: bytes live in memory in the renderer
 *    (Electron: chosen through the native dialog in the main process and
 *    transferred WITHOUT the file path; web/Android: the standard file
 *    input). No account, no backend, no cloud.
 *  - The PDF engine (PDF.js, Apache-2.0 - vendored under
 *    packages/shared-ui/src/vendor/pdfjs/) is INJECTED into the viewer so
 *    the viewer logic is unit-testable without a browser canvas.
 */

/** The document-engine registry. Formats without an engine yet are
 *  intentionally absent - the UI says "on the roadmap" instead of
 *  pretending. Capabilities are per-format facts, not guesses. */
export const DOCUMENT_ENGINES = Object.freeze({
  pdf: Object.freeze({
    label: 'PDF document',
    extensions: Object.freeze(['pdf']),
    mimeTypes: Object.freeze(['application/pdf']),
    /** What the PDF engine can HONESTLY do in Phase 1. */
    capabilities: Object.freeze({
      view: true,       // full-page rendering with zoom
      search: true,     // text search across pages (text layer extraction)
      zoom: true,
      pageNavigation: true,
      annotate: false,  // Phase 2 roadmap
      edit: false,      // not applicable to PDF in this architecture
      save: false,
      export: false,
      print: false      // Phase 2 roadmap (Electron printToPDF/toPrinter)
    })
  })
});

/** Classify a file name into a supported document type, or null. */
export function classifyDocument(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(String(fileName || '').trim());
  if (!m) return null;
  const ext = m[1].toLowerCase();
  for (const [type, engine] of Object.entries(DOCUMENT_ENGINES)) {
    if (engine.extensions.includes(ext)) return type;
  }
  return null;
}

/** The human-side fact for honest UI: what is NOT supported yet. */
export function unsupportedDocumentKinds() {
  return ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
}

let docSeq = 0;

/**
 * In-memory document store. Holds the bytes the user explicitly opened -
 * nothing is written to disk, no paths are kept, nothing survives a
 * restart (the session snapshot deliberately excludes document tabs).
 */
export class DocumentStore {
  constructor() {
    this._docs = new Map();
  }

  /** Add a document; returns { id, name, bytes, type, size, openedAt }. */
  add({ name, bytes }) {
    if (!bytes || (bytes.byteLength !== undefined && bytes.byteLength === 0)) {
      throw new Error('empty-document');
    }
    const cleanName = String(name || 'document.pdf').slice(0, 120);
    const type = classifyDocument(cleanName) || 'pdf';
    docSeq += 1;
    const id = `doc-${Date.now().toString(36)}-${docSeq}`;
    const doc = {
      id,
      name: cleanName,
      bytes,
      type,
      size: bytes.byteLength !== undefined ? bytes.byteLength : bytes.length,
      openedAt: Date.now()
    };
    this._docs.set(id, doc);
    return doc;
  }

  get(id) {
    return this._docs.get(id) || null;
  }

  remove(id) {
    return this._docs.delete(id);
  }

  list() {
    return [...this._docs.values()];
  }
}

/**
 * PDF viewer controller. Renders into a container via the INJECTED
 * pdfjs module (the vendored PDF.js build in production, a fake in
 * tests). All DOM access is guarded so headless environments degrade
 * honestly (status stays 'ready'; painting is skipped where no canvas
 * 2d context exists).
 *
 * State shape (mirrored on the tab so re-renders restore it):
 *   { status, numPages, page, zoom, query, matches, matchIndex, error }
 */
export function createPdfViewer({ pdfjs, container, state, onStateChange = null } = {}) {
  const viewerState = state || { status: 'idle', numPages: 0, page: 1, zoom: 1.25, query: '', matches: [], matchIndex: -1, error: null };
  let pdfDoc = null;
  let loadToken = 0;

  const notify = () => { try { onStateChange?.(viewerState); } catch { /* listener is optional */ } };
  const setState = (patch) => { Object.assign(viewerState, patch); notify(); };

  const clampPage = (n) => Math.min(Math.max(1, n), Math.max(1, viewerState.numPages || 1));

  async function load(bytes) {
    const token = ++loadToken;
    if (!pdfjs || typeof pdfjs.getDocument !== 'function') {
      setState({ status: 'error', error: 'engine-unavailable' });
      return viewerState;
    }
    setState({ status: 'loading', error: null, matches: [], matchIndex: -1 });
    try {
      // Copy into a plain Uint8Array: PDF.js DETACHES the buffer it is
      // given (transfers it to the worker), which would neuter the
      // renderer's copy for later re-renders.
      const data = bytes.byteLength !== undefined
        ? new Uint8Array(bytes.slice(0))
        : new Uint8Array(Buffer.from(bytes));
      const task = pdfjs.getDocument({ data });
      pdfDoc = await (task.promise ? task.promise : task);
      if (token !== loadToken) return viewerState; // superseded by a newer load
      setState({ status: 'ready', numPages: pdfDoc.numPages || 1, page: clampPage(viewerState.page || 1) });
      await renderCurrent();
    } catch (err) {
      if (token !== loadToken) return viewerState;
      const name = err && err.name ? String(err.name) : '';
      if (name === 'PasswordException') {
        setState({ status: 'password', error: 'This PDF is password-protected. Unlocking encrypted PDFs is not available yet.' });
      } else {
        setState({ status: 'error', error: 'This file could not be opened as a PDF - it may be damaged or not a PDF at all.' });
      }
    }
    return viewerState;
  }

  async function renderCurrent() {
    if (!pdfDoc || viewerState.status !== 'ready') return;
    const pageNum = clampPage(viewerState.page);
    try {
      const page = await pdfDoc.getPage(pageNum);
      const scale = Math.min(4, Math.max(0.5, viewerState.zoom));
      const viewport = page.getViewport({ scale });
      // Paint only where a real canvas exists (skipped in headless tests).
      if (container && typeof container.ownerDocument !== 'undefined' && viewerState.status === 'ready') {
        try {
          const canvas = container.ownerDocument.createElement('canvas');
          if (typeof canvas.getContext === 'function') {
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            canvas.style.cssText = `max-width:100%; height:auto; box-shadow:0 8px 30px rgba(0,0,0,0.5); background:#fff;`;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const prev = container.querySelector ? container.querySelector('.fb-doc-canvas') : null;
              if (prev && prev.remove) prev.remove();
              if (container.appendChild) container.appendChild(canvas);
              await page.render({ canvasContext: ctx, viewport }).promise;
            }
          }
        } catch { /* headless environment - state stays authoritative */ }
      }
    } catch { /* page render failures keep the last good paint */ }
  }

  async function setPage(n) {
    if (viewerState.status !== 'ready') return viewerState;
    setState({ page: clampPage(n) });
    await renderCurrent();
    return viewerState;
  }

  async function nextPage() { return setPage((viewerState.page || 1) + 1); }
  async function prevPage() { return setPage((viewerState.page || 1) - 1); }

  async function setZoom(z) {
    const zoom = Math.min(4, Math.max(0.5, Number(z) || 1));
    setState({ zoom });
    await renderCurrent();
    return viewerState;
  }

  /** Text search across every page (case-insensitive). Returns all
   *  matches { page, snippet } and jumps to the first. */
  async function search(query) {
    const q = String(query || '').trim();
    setState({ query: q, matches: [], matchIndex: -1 });
    if (!q || !pdfDoc || viewerState.status !== 'ready') return viewerState;
    const needle = q.toLowerCase();
    const matches = [];
    for (let p = 1; p <= (pdfDoc.numPages || 0); p += 1) {
      let text = '';
      try {
        const page = await pdfDoc.getPage(p);
        const content = await page.getTextContent();
        text = (content.items || []).map((item) => String(item.str || '')).join(' ');
      } catch { continue; }
      const hay = text.toLowerCase();
      let idx = hay.indexOf(needle);
      while (idx !== -1 && matches.length < 500) {
        const start = Math.max(0, idx - 30);
        matches.push({ page: p, snippet: text.slice(start, idx + needle.length + 40).trim() });
        idx = hay.indexOf(needle, idx + needle.length);
      }
    }
    setState({ matches, matchIndex: matches.length ? 0 : -1 });
    if (matches.length) await setPage(matches[0].page);
    return viewerState;
  }

  function nextMatch() {
    if (!viewerState.matches.length) return viewerState;
    const matchIndex = (viewerState.matchIndex + 1) % viewerState.matches.length;
    setState({ matchIndex });
    setPage(viewerState.matches[matchIndex].page);
    return viewerState;
  }

  function destroy() {
    try { pdfDoc?.destroy?.(); } catch { /* already gone */ }
    pdfDoc = null;
    setState({ status: 'idle', numPages: 0, page: 1, matches: [], matchIndex: -1 });
  }

  return {
    get state() { return viewerState; },
    load, setPage, nextPage, prevPage, setZoom, search, nextMatch, renderCurrent, destroy
  };
}
