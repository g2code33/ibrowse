const keys = ['shield', 'darkReader', 'readerMode'];
const inputs = Object.fromEntries(keys.map((key) => [key, document.getElementById(key)]));

chrome.storage.sync.get(Object.fromEntries(keys.map((key) => [key, key === 'shield']))).then((state) => {
  keys.forEach((key) => { inputs[key].checked = Boolean(state[key]); });
});

keys.forEach((key) => inputs[key].addEventListener('change', async () => {
  const state = Object.fromEntries(keys.map((item) => [item, inputs[item].checked]));
  await chrome.storage.sync.set(state);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'yayra-apply-state' }).catch(() => {});
}));
