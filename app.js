// app.js — robust client for GitHub Pages + Render API

const chatBox = document.getElementById('chat');
const form = document.getElementById('chatForm');
const qInput = document.getElementById('q');

// Build endpoint once, trimming any stray slashes
const API_BASE = (window.API_BASE || '').replace(/\/+$/,''); // set in index.html
const ASK_URL = API_BASE ? `${API_BASE}/api/ask` : '/api/ask'; // fallback (dev)

function addMsg(who, text) {
  const div = document.createElement('div');
  div.className = 'bubble ' + (who === 'user' ? 'me' : 'bot');
  div.textContent = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
  return div; // return the node so we can update it later
}

async function postJSON(url, payload, { timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });

    const raw = await res.text(); // read as text first so we can show useful errors
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { /* leave as {} */ }

    if (!res.ok) {
      const msg = data?.error || data?.message || raw || `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = qInput.value.trim();
  if (!q) return;

  addMsg('user', q);
  qInput.value = '';

  const thinking = addMsg('bot', 'Thinking…');

  try {
    // Your server expects { query } at /api/ask
    const data = await postJSON(ASK_URL, { query: q });

    const answer =
      (typeof data?.answer === 'string' && data.answer.trim()) ||
      data?.result ||
      data?.text ||
      '(No answer returned)';

    thinking.textContent = answer;
  } catch (err) {
    // Common causes: CORS not allowing https://chesteryjng.github.io,
    // mixed content (http API on https page), or backend down.
    thinking.textContent =
      `Network error: ${err.message || err}\n\n` +
      `Troubleshoot:\n` +
      `• Ensure API is HTTPS: ${API_BASE || '(not set)'}\n` +
      `• Confirm CORS allows https://chesteryjng.github.io/crc-guidelines-site\n` +
      `• Check Render service is up`;
    console.error('[ask:error]', err);
  }
});
