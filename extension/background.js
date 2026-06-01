/* ============================================
   KlikClip — Background Service Worker
   ============================================ */

const API_BASE = 'https://api.KlikClip.ai';

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_USAGE') {
    getUsage().then(sendResponse);
    return true;
  }

  if (message.type === 'INCREMENT_USAGE') {
    incrementUsage().then(sendResponse);
    return true;
  }

  if (message.type === 'FETCH_SUMMARY') {
    fetchSummary(message.payload).then(sendResponse);
    return true;
  }

  if (message.type === 'ASK_QUESTION') {
    askQuestion(message.payload).then(sendResponse);
    return true;
  }
});

async function getUsage() {
  const stored = await chrome.storage.local.get(['vl_usage', 'vl_usage_date']);
  const today = new Date().toDateString();

  if (stored.vl_usage_date !== today) {
    await chrome.storage.local.set({ vl_usage: 0, vl_usage_date: today });
    return { used: 0, remaining: 5, total: 5 };
  }

  const used = stored.vl_usage || 0;
  return { used, remaining: Math.max(0, 5 - used), total: 5 };
}

async function incrementUsage() {
  const stored = await chrome.storage.local.get(['vl_usage']);
  const used = (stored.vl_usage || 0) + 1;
  await chrome.storage.local.set({ vl_usage: used, vl_usage_date: new Date().toDateString() });
  return { used, remaining: Math.max(0, 5 - used), total: 5 };
}

async function fetchSummary(payload) {
  const response = await fetch(`${API_BASE}/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}

async function askQuestion(payload) {
  const response = await fetch(`${API_BASE}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}
