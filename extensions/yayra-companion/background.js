const DEFAULT_STATE = Object.freeze({
  shield: true,
  darkReader: false,
  readerMode: false
});

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(DEFAULT_STATE);
  await chrome.storage.sync.set({ ...DEFAULT_STATE, ...stored });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'yayra-get-state') {
    chrome.storage.sync.get(DEFAULT_STATE).then(sendResponse);
    return true;
  }

  if (message?.type === 'yayra-set-state') {
    chrome.storage.sync.set(message.state || {}).then(async () => {
      if (sender.tab?.id) {
        await chrome.tabs.sendMessage(sender.tab.id, { type: 'yayra-apply-state' }).catch(() => {});
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === 'yayra-toggle-panel' && sender.tab?.id) {
    chrome.tabs.sendMessage(sender.tab.id, { type: 'yayra-toggle-panel' }).catch(() => {});
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'yayra-toggle-panel' }).catch(() => {});
});
