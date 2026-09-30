const SACHIN = (() => {
  const TOKEN_KEY = 'sachin_token';
  const USER_KEY = 'sachin_user';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sachin_widget_conversation_')) localStorage.removeItem(key);
    }
  }

  async function request(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (networkErr) {
      throw new Error("I can't reach the server right now — check your connection and try again.");
    }

    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }

    if (!res.ok) {
      throw new Error(data.message || "Something went wrong on my end. Give me a second and try again.");
    }
    return data;
  }

  async function transcribeAudio(blob) {
    const form = new FormData();
    const mime = blob.type || 'audio/webm';
    const extension = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
    form.append('audio', blob, `sachin-voice.${extension}`);
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;
    try { response = await fetch('/api/voice/transcribe', { method: 'POST', headers, body: form }); }
    catch { throw new Error("I can't reach the server right now — check your connection and try again."); }

    let data = {};
    try { data = await response.json(); } catch { /* friendly fallback below */ }
    if (!response.ok) throw new Error(data.message || 'I couldn’t process that voice message just now. Try again.');
    return data;
  }

  return {
    getToken, getUser, setSession, clearSession,
    register: (name, email, password) => request('/auth/register', { method: 'POST', body: { name, email, password } }),
    login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
    me: () => request('/auth/me'),
    deleteAccount: (password) => request('/auth/me', { method: 'DELETE', body: { password } }),

    getPreferences: () => request('/preferences'),
    updatePreferences: (updates) => request('/preferences', { method: 'PATCH', body: updates }),

    listMemories: () => request('/memory'),
    createMemory: (memory) => request('/memory', { method: 'POST', body: memory }),
    updateMemory: (id, updates) => request(`/memory/${id}`, { method: 'PATCH', body: updates }),
    deleteMemory: (id) => request(`/memory/${id}`, { method: 'DELETE' }),
    clearAllMemories: () => request('/memory', { method: 'DELETE' }),

    listConversations: () => request('/conversations'),
    createConversation: (mode) => request('/conversations', { method: 'POST', body: { mode } }),
    getMessages: (id) => request(`/conversations/${id}/messages`),
    deleteConversation: (id) => request(`/conversations/${id}`, { method: 'DELETE' }),

    listGoals: () => request('/goals'),
    createGoal: (goal) => request('/goals', { method: 'POST', body: goal }),
    updateGoal: (id, updates) => request(`/goals/${id}`, { method: 'PATCH', body: updates }),
    deleteGoal: (id) => request(`/goals/${id}`, { method: 'DELETE' }),

    sendMessage: (payload) => request('/chat', { method: 'POST', body: payload }),
    transcribeAudio
  };
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
