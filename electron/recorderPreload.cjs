// Preload for the HIDDEN screen-recorder window (electron/screenRecorder.cjs).
// The recorder page captures the display + PC system sound (+ optional
// microphone) with getUserMedia/MediaRecorder and streams the encoded webm
// chunks to the main process over this tiny, write-only bridge.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yayraRecorder', {
  // MediaRecorder started successfully. info: { systemAudio, mic }
  started: (info) => ipcRenderer.send('yayra:rec-started', info),
  // One encoded webm chunk (ArrayBuffer) - appended to the output file.
  chunk: (buf) => ipcRenderer.send('yayra:rec-chunk', buf),
  // Recording finished and all chunks were flushed.
  done: () => ipcRenderer.send('yayra:rec-done'),
  // Unrecoverable capture/encode failure.
  error: (message) => ipcRenderer.send('yayra:rec-error', String(message)),
  // Main process asks the page to stop the MediaRecorder gracefully.
  onStop: (cb) => ipcRenderer.on('yayra:rec-stop', () => cb())
});
