/**
 * System-wide screen recording for the floating bubble's right-click menu.
 *
 * HOW IT WORKS (all real - no fake "recording saved!" alerts):
 *  - A hidden BrowserWindow loads a tiny capture page (data: URL).
 *  - The page calls getUserMedia with chromeMediaSource:'desktop' for the
 *    primary display's VIDEO **and the PC's SYSTEM AUDIO** (Chromium's
 *    loopback capture - the "must always record sounds of the pc system"
 *    requirement). Loopback is natively supported on Windows; where the
 *    OS cannot provide it (notably macOS without a virtual audio driver)
 *    the recorder keeps going with video (+mic) and REPORTS the fact in
 *    its status instead of pretending.
 *  - The microphone is a second, OPTIONAL stream ("voice included" vs
 *    "voice mute"); when present it is mixed with the system audio via
 *    WebAudio so the file has one combined soundtrack.
 *  - MediaRecorder encodes webm chunks that stream to this module over
 *    IPC (electron/recorderPreload.cjs) and append straight to
 *    Downloads/yayra-recording-<stamp>.webm - no giant in-memory buffer.
 *
 * Everything is dependency-injected so the orchestration is testable
 * without a display (tests/screen-recorder.test.mjs).
 */

function createScreenRecorder({
  BrowserWindow,
  ipcMain,
  screen,
  path,
  desktopCapturerImpl = null,
  fsImpl = null,
  shellImpl = null,
  preloadPath = null,
  // () => directory for finished recordings (usually Downloads).
  saveDir = null,
  logger = console
}) {
  let recWin = null;
  let active = false;
  let stopping = false;
  let startedAt = null;
  let filePath = null;
  let fileStream = null;
  let micEnabled = false;
  let systemAudioCaptured = null; // null until the page reports in
  let onStateChange = null;       // menu refresh hook

  function isSupported() {
    return Boolean(desktopCapturerImpl && fsImpl && preloadPath && typeof saveDir === 'function');
  }

  function status() {
    return {
      active,
      mic: micEnabled,
      systemAudio: systemAudioCaptured,
      startedAt,
      file: filePath,
      supported: isSupported()
    };
  }

  function setOnStateChange(cb) {
    onStateChange = typeof cb === 'function' ? cb : null;
  }

  function notifyState() {
    try { onStateChange?.(status()); } catch { /* listener's problem */ }
  }

  function buildRecorderHtml({ sourceId, mic }) {
    // Config is baked into the page because data: URLs carry no query
    // string. The page never renders anything - the window stays hidden.
    return `<!doctype html><html><head><meta charset="utf-8" /></head><body><script>
    const api = window.yayraRecorder;
    const SOURCE_ID = ${JSON.stringify(String(sourceId))};
    const WANT_MIC = ${mic ? 'true' : 'false'};
    let recorder = null;
    let allTracks = [];
    async function begin() {
      let systemAudio = true;
      let desktop;
      const video = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: SOURCE_ID, maxFrameRate: 30 } };
      try {
        // System-sound loopback capture: the PC's own audio output.
        desktop = await navigator.mediaDevices.getUserMedia({
          audio: { mandatory: { chromeMediaSource: 'desktop' } },
          video
        });
      } catch (err) {
        // OS cannot provide loopback audio (e.g. macOS without a virtual
        // audio device) - record the screen anyway and say so honestly.
        systemAudio = false;
        desktop = await navigator.mediaDevices.getUserMedia({ audio: false, video });
      }
      let micStream = null;
      if (WANT_MIC) {
        try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
        catch (err) { micStream = null; }
      }
      const videoTracks = desktop.getVideoTracks();
      const audioTracks = desktop.getAudioTracks().concat(micStream ? micStream.getAudioTracks() : []);
      allTracks = videoTracks.concat(audioTracks);
      let finalStream;
      if (audioTracks.length > 1) {
        // Mix system sound + voice into one soundtrack.
        const ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        for (const t of audioTracks) ctx.createMediaStreamSource(new MediaStream([t])).connect(dest);
        finalStream = new MediaStream(videoTracks.concat(dest.stream.getAudioTracks()));
      } else {
        finalStream = new MediaStream(videoTracks.concat(audioTracks));
      }
      let mime = 'video/webm;codecs=vp9,opus';
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
      recorder = new MediaRecorder(finalStream, { mimeType: mime, videoBitsPerSecond: 6000000 });
      recorder.ondataavailable = async (ev) => {
        if (ev.data && ev.data.size > 0) api.chunk(await ev.data.arrayBuffer());
      };
      recorder.onstop = () => {
        for (const t of allTracks) { try { t.stop(); } catch (e) {} }
        // ondataavailable for the final chunk fires before onstop resolves
        // its arrayBuffer() - give that microtask chain a moment.
        setTimeout(() => api.done(), 250);
      };
      recorder.start(1000);
      api.started({ systemAudio, mic: Boolean(micStream) });
    }
    api.onStop(() => { try { if (recorder && recorder.state !== 'inactive') recorder.stop(); else api.done(); } catch (e) { api.done(); } });
    begin().catch((err) => api.error(err && err.message || err));
    </script></body></html>`;
  }

  /** End the output stream and invoke cb only after the bytes are flushed. */
  function closeStream(cb) {
    const stream = fileStream;
    fileStream = null;
    if (stream && typeof stream.end === 'function') {
      try { stream.end(() => cb()); return; } catch { /* fall through */ }
    }
    cb();
  }

  function cleanup({ keepFile = true } = {}) {
    if (!keepFile && filePath) {
      const discard = filePath;
      try { fsImpl.unlinkSync(discard); } catch { /* best effort */ }
    }
    if (recWin && !recWin.isDestroyed?.()) {
      try { recWin.destroy ? recWin.destroy() : recWin.close(); } catch { /* gone */ }
    }
    recWin = null;
    active = false;
    stopping = false;
    notifyState();
  }

  async function start({ mic = true } = {}) {
    if (active) return { ok: false, reason: 'already-recording' };
    if (!isSupported()) {
      logger?.warn?.('[yayra:recorder] unavailable: capturer/fs/preload/dir not wired');
      return { ok: false, reason: 'unavailable' };
    }
    try {
      const display = screen.getPrimaryDisplay();
      const sources = await desktopCapturerImpl.getSources({ types: ['screen'] });
      const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
      if (!source) return { ok: false, reason: 'no-source' };

      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      filePath = path.join(saveDir(), `yayra-recording-${stamp}.webm`);
      fileStream = fsImpl.createWriteStream(filePath);
      micEnabled = Boolean(mic);
      systemAudioCaptured = null;
      startedAt = Date.now();
      active = true;
      stopping = false;

      recWin = new BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        skipTaskbar: true,
        webPreferences: {
          preload: preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          backgroundThrottling: false
        }
      });
      recWin.on?.('closed', () => { recWin = null; });
      const html = buildRecorderHtml({ sourceId: source.id, mic: micEnabled });
      recWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      notifyState();
      logger?.log?.(`[yayra:recorder] recording started -> ${filePath} (mic: ${micEnabled})`);
      return { ok: true, file: filePath };
    } catch (err) {
      logger?.warn?.(`[yayra:recorder] start failed: ${err?.message || err}`);
      closeStream(() => cleanup({ keepFile: false }));
      return { ok: false, reason: String(err?.message || err) };
    }
  }

  function stop() {
    if (!active) return { ok: false, reason: 'not-recording' };
    if (stopping) return { ok: true, file: filePath };
    stopping = true;
    try {
      recWin?.webContents?.send?.('yayra:rec-stop');
    } catch {
      // Recorder window already gone - finalize with whatever was written.
      finalize();
    }
    return { ok: true, file: filePath };
  }

  function finalize() {
    const file = filePath;
    closeStream(() => {
      const wroteAnything = (() => {
        try { return fsImpl.existsSync(file) && fsImpl.statSync(file).size > 0; } catch { return false; }
      })();
      cleanup({ keepFile: wroteAnything });
      if (wroteAnything) {
        try { shellImpl?.showItemInFolder?.(file); } catch { /* reveal is best-effort */ }
        logger?.log?.(`[yayra:recorder] recording saved: ${file}`);
      } else {
        logger?.warn?.('[yayra:recorder] recording produced no data - file discarded');
      }
    });
  }

  // --- IPC from the hidden recorder page ---
  ipcMain.on('yayra:rec-started', (_e, info) => {
    systemAudioCaptured = Boolean(info?.systemAudio);
    micEnabled = Boolean(info?.mic);
    if (!systemAudioCaptured) {
      logger?.warn?.('[yayra:recorder] this OS gave no system-audio loopback (macOS needs a virtual audio device) - recording continues without PC sound');
    }
    notifyState();
  });
  ipcMain.on('yayra:rec-chunk', (_e, buf) => {
    if (!fileStream) return;
    try { fileStream.write(Buffer.from(buf)); } catch (err) {
      logger?.warn?.(`[yayra:recorder] chunk write failed: ${err?.message || err}`);
    }
  });
  ipcMain.on('yayra:rec-done', () => finalize());
  ipcMain.on('yayra:rec-error', (_e, message) => {
    logger?.warn?.(`[yayra:recorder] capture failed: ${message}`);
    closeStream(() => cleanup({ keepFile: false }));
  });

  return { start, stop, status, isSupported, setOnStateChange, buildRecorderHtml };
}

module.exports = { createScreenRecorder };
