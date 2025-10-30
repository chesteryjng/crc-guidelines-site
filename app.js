const chatBox = document.getElementById('chat');
const form = document.getElementById('chatForm');
const qInput = document.getElementById('q');

function addMsg(who, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + who;
  div.textContent = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = qInput.value.trim();
  if (!q) return;
  addMsg('user', q);
  qInput.value = '';
  addMsg('bot', 'Thinking…');

  try {
    const res = await fetch((window.API_BASE || '') + '/api/ask', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ query: q })
    });
    const data = await res.json();
    chatBox.lastChild.textContent = data.answer;
  } catch (err) {
    chatBox.lastChild.textContent = 'Network error. Please try again later.';
  }
});
