import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';
import { AI_DEFAULTS } from '../packages/shared-ui/src/services/aiService.js';

/**
 * ChatGPT-style AI chats:
 *  - every SEARCH-ENGINE handoff (yayra://ai?q=..., the omnibox "Ask Yayra
 *    AI" path) starts a BRAND-NEW chat;
 *  - every chat is SAVED (localStorage) and can be continued later, across
 *    restarts;
 *  - sidebar: list of chats, active highlight, new chat, rename, delete;
 *  - asking inside a chat continues THAT chat (with history).
 */

function makeStorage() {
  const disk = new Map();
  return {
    getItem: (k) => (disk.has(k) ? disk.get(k) : null),
    setItem: (k, v) => disk.set(k, String(v)),
    removeItem: (k) => disk.delete(k),
    key: (i) => [...disk.keys()][i] ?? null,
    get length() { return disk.size; }
  };
}

function fakeAnsweringService(answer = 'Here you go.') {
  const asked = [];
  return {
    asked,
    getConfig: async () => ({ ...AI_DEFAULTS }),
    updateConfig: async (p) => ({ ...AI_DEFAULTS, ...p }),
    ask: async (prompt, { history = [] } = {}) => {
      asked.push({ prompt, history });
      return { success: true, answer };
    },
    testConnection: async () => ({ success: true })
  };
}

async function makeShell({ aiService, storage } = {}) {
  if (storage) globalThis.localStorage = storage;
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, isMobile: false, aiService });
  await shell.initialize(); // production entry point: loads saved AI chats
  shell.render(container);
  return { shell, container };
}

function settled() {
  return new Promise((r) => setTimeout(r, 15));
}

test('SEARCH HANDOFF: every ask handed over from the search engine opens a BRAND-NEW chat', async () => {
  const svc = fakeAnsweringService();
  const { shell, container } = await makeShell({ aiService: svc });
  try {
    shell.state.tabs[0].url = 'yayra://ai?q=how%20far%20is%20the%20moon';
    shell.render(container);
    await settled();
    assert.equal(shell.state.aiChats.length, 1, 'first search ask -> a new chat');
    assert.equal(shell.state.aiChats[0].messages.length, 2, 'user question + assistant answer');
    assert.equal(shell.state.aiChats[0].title, 'how far is the moon', 'chat auto-titled from the question');
    const firstChatId = shell.state.aiChats[0].id;

    // A SECOND search ask must NOT continue the first chat.
    shell.state.tabs[0].url = 'yayra://ai?q=best%20jollof%20recipe';
    shell.render(container);
    await settled();
    assert.equal(shell.state.aiChats.length, 2, 'second search ask -> ANOTHER new chat');
    assert.equal(shell.state.aiActiveChatId, shell.state.aiChats[0].id, 'the new chat is the active one');
    assert.notEqual(shell.state.aiActiveChatId, firstChatId);
    assert.equal(shell._aiChatById(firstChatId).messages.length, 2, 'the first chat is untouched');
  } finally {
    shell.destroy();
    delete globalThis.localStorage;
  }
});

test('CONTINUE: asking inside the open chat continues THAT chat with history; New chat starts clean', async () => {
  const svc = fakeAnsweringService();
  const { shell, container } = await makeShell({ aiService: svc });
  try {
    shell.state.tabs[0].url = 'yayra://ai';
    shell.render(container);
    await shell.askYayraAi('what is the capital of Ghana');
    await shell.askYayraAi('and its population?');
    assert.equal(shell.state.aiChats.length, 1, 'both questions stayed in ONE chat');
    assert.equal(shell.state.aiConversation.length, 4, 'two exchanges');
    assert.equal(svc.asked[1].history.length, 2, 'the second ask carried the first exchange as history');
    assert.equal(svc.asked[1].history[0].content, 'what is the capital of Ghana');

    // + New chat: clean composer, prior chat still in the sidebar.
    container.querySelector('.fb-ai-new-chat')?.click();
    assert.equal(shell.state.aiActiveChatId, null, 'no active chat after New chat');
    assert.equal(shell.state.aiConversation.length, 0, 'thread is empty for the fresh chat');
    assert.equal(shell.state.aiChats.length, 1, 'the previous chat is still saved');
    assert.ok(container.querySelector('.fb-ai-chat-item'), 'sidebar lists the saved chat');

    // Asking now creates a SECOND chat (nothing active to continue).
    await shell.askYayraAi('different topic entirely');
    assert.equal(shell.state.aiChats.length, 2);
  } finally {
    shell.destroy();
    delete globalThis.localStorage;
  }
});

test('SAVED: every chat is persisted and survives a full restart, ready to continue later', async () => {
  const storage = makeStorage();
  const svc = fakeAnsweringService('The answer.');
  const first = await makeShell({ aiService: svc, storage });
  try {
    await first.shell.askYayraAi('remember this question');
    const savedRaw = storage.getItem('yayra:ai-chats');
    assert.ok(savedRaw, 'chat was written to storage');
    const saved = JSON.parse(savedRaw);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].messages.length, 2);
    assert.equal(saved[0].messages[0].content, 'remember this question');
    assert.equal(saved[0].messages[1].content, 'The answer.');
    assert.equal(saved[0].messages.some((m) => m.streaming), false, 'streaming flag never persists');
  } finally {
    first.shell.destroy();
  }

  // "Restart": a brand-new shell over the same storage.
  const svc2 = fakeAnsweringService('Follow-up answer.');
  const second = await makeShell({ aiService: svc2, storage });
  try {
    assert.equal(second.shell.state.aiChats.length, 1, 'chats restored on startup');
    const restored = second.shell.state.aiChats[0];
    assert.equal(restored.title, 'remember this question');
    assert.equal(second.shell.state.aiActiveChatId, null, 'opens on a fresh chat, ChatGPT-style');

    // Continue the old conversation later.
    second.shell.openAiChat(restored.id);
    assert.equal(second.shell.state.aiConversation.length, 2, 'old messages are back in the thread');
    await second.shell.askYayraAi('and what did I ask before?');
    assert.equal(second.shell.state.aiChats.length, 1, 'still the SAME chat');
    assert.equal(second.shell.state.aiConversation.length, 4, 'appended, not restarted');
    assert.equal(svc2.asked[0].history.length, 2, 'restored history was sent to the model');
  } finally {
    second.shell.destroy();
    delete globalThis.localStorage;
  }
});

test('SIDEBAR: click switches chats, rename retitles, delete removes (and persists)', async () => {
  const storage = makeStorage();
  const svc = fakeAnsweringService();
  const { shell, container } = await makeShell({ aiService: svc, storage });
  try {
    shell.state.tabs[0].url = 'yayra://ai';
    shell.render(container);
    await shell.askYayraAi('chat one topic');
    await shell.askYayraAi('chat two topic', { newChat: true });
    assert.equal(shell.state.aiChats.length, 2);

    // Switch back to the first chat via the sidebar.
    const firstId = shell.state.aiChats.find((c) => c.title === 'chat one topic').id;
    const items = Array.from(container.querySelectorAll('.fb-ai-chat-item'));
    const target = items.find((el) => el.dataset?.chatId === firstId);
    assert.ok(target, 'first chat listed in the sidebar');
    target.click();
    assert.equal(shell.state.aiActiveChatId, firstId, 'clicking a sidebar chat opens it');
    assert.ok(shell.state.aiConversation.some((m) => m.content === 'chat one topic'));
    const activeItems = Array.from(container.querySelectorAll('.fb-ai-chat-item'))
      .filter((el) => el.classList.contains('fb-ai-chat-active'));
    assert.equal(activeItems.length, 1, 'exactly one chat marked active');
    assert.equal(activeItems[0].dataset?.chatId, firstId, 'and it is the opened chat');

    // Rename via the pencil (stub the prompt dialog).
    shell._textPromptDialog = async () => 'My favourite chat';
    const renameBtn = Array.from(container.querySelectorAll('.fb-ai-chat-rename'))
      .find((el) => el.dataset?.chatId === firstId);
    renameBtn.click();
    await settled();
    assert.equal(shell._aiChatById(firstId).title, 'My favourite chat');
    assert.equal(JSON.parse(storage.getItem('yayra:ai-chats')).find((c) => c.id === firstId).title, 'My favourite chat', 'rename persisted');

    // Delete the OTHER (inactive) chat via the sidebar x.
    const otherId = shell.state.aiChats.find((c) => c.id !== firstId).id;
    const delBtn = Array.from(container.querySelectorAll('.fb-ai-chat-delete'))
      .find((el) => el.dataset?.chatId === otherId);
    delBtn.click();
    assert.equal(shell.state.aiChats.length, 1, 'deleted from state');
    assert.equal(JSON.parse(storage.getItem('yayra:ai-chats')).length, 1, 'deleted from storage');
    assert.equal(shell.state.aiActiveChatId, firstId, 'active chat unaffected');
  } finally {
    shell.destroy();
    delete globalThis.localStorage;
  }
});

test('GUARDS: busy chat cannot be switched/deleted mid-answer; titles derive sensibly; caps hold', async () => {
  const storage = makeStorage();
  const svc = fakeAnsweringService();
  const { shell } = await makeShell({ aiService: svc, storage });
  try {
    // Title derivation.
    assert.equal(shell.deriveAiChatTitle('short question'), 'short question');
    const long = 'word '.repeat(20).trim();
    assert.ok(shell.deriveAiChatTitle(long).length <= 50, 'long titles truncated with ellipsis');
    assert.equal(shell.deriveAiChatTitle('   lots   of    spaces  '), 'lots of spaces');

    // Busy guards: while an answer streams, chats are locked.
    let releaseAsk;
    svc.ask = () => new Promise((resolve) => { releaseAsk = resolve; });
    const asking = shell.askYayraAi('slow question');
    await settled();
    assert.equal(shell.state.aiBusy, true);
    const activeId = shell.state.aiActiveChatId;
    shell.startNewAiChat();
    shell.openAiChat(activeId);
    shell.deleteAiChat(activeId);
    assert.equal(shell.state.aiActiveChatId, activeId, 'locked: no switch/delete mid-answer');
    assert.equal(shell.state.aiChats.length, 1);
    releaseAsk({ success: true, answer: 'done' });
    await asking;
    assert.equal(shell.state.aiBusy, false);

    // Storage cap: only the most recent AI_CHATS_CAP chats are kept.
    for (let i = 0; i < BrowserShell.AI_CHATS_CAP + 5; i += 1) {
      shell.state.aiChats.push({
        id: `cap-${i}`, title: `chat ${i}`, createdAt: 1, updatedAt: i + 1, messages: [{ role: 'user', content: 'x', at: 1 }]
      });
    }
    shell._persistAiChats();
    assert.equal(JSON.parse(storage.getItem('yayra:ai-chats')).length, BrowserShell.AI_CHATS_CAP, 'chat count capped');
  } finally {
    shell.destroy();
    delete globalThis.localStorage;
  }
});
