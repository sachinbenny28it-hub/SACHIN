(() => {
  let user = null;
  let preferences = null;
  let currentConversationId = null;
  let currentMode = 'friend';
  let wakeListeningOn = false;
  let voiceInputOn = false;
  let voiceInputCancelled = false;

  const els = {
    convoList: document.getElementById('convoList'),
    planPill: document.getElementById('planPill'),
    chatThread: document.getElementById('chatThread'),
    chatEmpty: document.getElementById('chatEmpty'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn'),
    micBtn: document.getElementById('micBtn'),
    chatHint: document.getElementById('chatHint'),
    dashboardContent: document.getElementById('dashboardContent'),
    memoryList: document.getElementById('memoryList'),
    settingsGrid: document.getElementById('settingsGrid')
  };

  async function boot() {
    if (!SACHIN.getToken()) { window.location.href = 'onboarding.html'; return; }
    try {
      const meRes = await SACHIN.me();
      user = meRes.user;
      if (!user.onboarded) { window.location.href = 'onboarding.html'; return; }
      const prefRes = await SACHIN.getPreferences();
      preferences = prefRes.preferences;
    } catch {
      SACHIN.clearSession();
      window.location.href = 'onboarding.html';
      return;
    }

    window.SachinBilling?.init?.(user.id);
    els.planPill.textContent = user.plan === 'pro' ? 'SACHIN Pro' : 'Free plan';
    setResponseModeButton(preferences.response_mode);
    setModeTab(currentMode);
    wireNav();
    wireChat();
    await loadConversations();
    renderDashboard();
  }

  // ── Navigation ────────────────────────────────────────────
  function wireNav() {
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.onclick = () => showView(btn.dataset.view);
    });
    document.getElementById('newConvoBtn').onclick = () => {
      currentConversationId = null;
      els.chatThread.innerHTML = '';
      els.chatThread.appendChild(els.chatEmpty);
      showView('chat');
    };
    document.getElementById('newConvoMobile').onclick = () => document.getElementById('newConvoBtn').click();
    document.getElementById('signoutBtn').onclick = () => { SACHIN.clearSession(); window.location.href = 'index.html'; };
    document.getElementById('upgradeBtn').onclick = () => window.SachinBilling?.presentPaywall?.();
  }

  function showView(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    document.getElementById(`view-${name}`).classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    if (name === 'memory') loadMemories();
    if (name === 'settings') renderSettings();
    if (name === 'dashboard') renderDashboard();
  }

  // ── Dashboard ─────────────────────────────────────────────
  async function renderDashboard() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    let memories = [];
    let goals = [];
    try {
      [{ memories }, { goals }] = await Promise.all([SACHIN.listMemories(), SACHIN.listGoals()]);
    } catch { /* show the dashboard with the data available */ }
    const activeGoals = goals.filter((goal) => goal.status === 'active');
    const approvedMemories = memories.filter((memory) => !!memory.approved);
    const pendingMemories = memories.length - approvedMemories.length;
    const learning = approvedMemories.filter((memory) => memory.category === 'learning');
    const projects = approvedMemories.filter((memory) => memory.category === 'project');

    els.dashboardContent.innerHTML = `
      <p class="dash-greeting">${greeting}, ${escapeHtml(user.name.split(' ')[0])} 👋</p>
      <p class="dash-sub">SACHIN is ready.</p>
      <div class="dash-grid">
        <div class="dash-card"><h3>Today's focus</h3><div class="big">${activeGoals.length} task${activeGoals.length === 1 ? '' : 's'} remaining</div>
          <div class="goal-list" id="dashGoalList">${activeGoals.slice(0, 4).map((goal) => `
            <div class="goal-row" data-id="${goal.id}"><button data-goal-action="done" title="Mark done">○</button><span>${escapeHtml(goal.title)}</span><small>${goal.due_date ? formatDate(goal.due_date) : ''}</small><button data-goal-action="delete" title="Delete">×</button></div>
          `).join('') || '<small>No active goals. Add your first focus below.</small>'}</div>
          <div class="goal-add"><input id="newGoalInput" maxlength="200" placeholder="Add a focus for today…"><input id="newGoalDue" type="date" aria-label="Due date"><button id="addGoalBtn">Add</button></div>
        </div>
        <div class="dash-card"><h3>Learning</h3><div class="big">${learning.length ? `${learning.length} topic${learning.length === 1 ? '' : 's'}` : 'Nothing saved yet'}</div><div class="goal-list">${learning.slice(0, 3).map((m) => `<div class="goal-row"><span>${escapeHtml(m.content)}</span></div>`).join('')}</div></div>
        <div class="dash-card"><h3>Projects</h3><div class="big">${projects.length ? `${projects.length} active` : 'Ready when you are'}</div><div class="goal-list">${projects.slice(0, 3).map((m) => `<div class="goal-row"><span>${escapeHtml(m.content)}</span></div>`).join('')}</div></div>
        <div class="dash-card"><h3>Memory Vault</h3><div class="big">${approvedMemories.length} ${approvedMemories.length === 1 ? 'thing' : 'things'} remembered</div>${pendingMemories ? `<small>${pendingMemories} suggestion${pendingMemories === 1 ? '' : 's'} waiting for your review</small>` : ''}<button class="dash-link" id="dashMemoryLink">Review memories →</button></div>
        <div class="dash-card"><h3>Wake phrase</h3><div class="big">"${escapeHtml(preferences.wake_phrase)}"</div></div>
        <div class="dash-card"><h3>Response mode</h3><div class="big">${labelForMode(preferences.response_mode)}</div></div>
      </div>
      <div class="dash-actions">
        <button class="primary" id="dashTalk">🎙️ Talk to SACHIN</button>
        <button id="dashMessage">⌨️ Message SACHIN</button>
      </div>
    `;
    document.getElementById('dashTalk').onclick = () => { showView('chat'); startVoiceInput(); };
    document.getElementById('dashMessage').onclick = () => { showView('chat'); els.chatInput.focus(); };
    document.getElementById('dashMemoryLink').onclick = () => showView('memory');
    els.dashboardContent.querySelectorAll('[data-goal-action="done"]').forEach((button) => {
      button.onclick = async () => { await SACHIN.updateGoal(button.closest('.goal-row').dataset.id, { status: 'done' }); renderDashboard(); };
    });
    els.dashboardContent.querySelectorAll('[data-goal-action="delete"]').forEach((button) => {
      button.onclick = async () => { await SACHIN.deleteGoal(button.closest('.goal-row').dataset.id); renderDashboard(); };
    });
    document.getElementById('addGoalBtn').onclick = async () => {
      const input = document.getElementById('newGoalInput');
      const title = input.value.trim();
      if (!title) return;
      try {
        await SACHIN.createGoal({ title, due_date: document.getElementById('newGoalDue').value || null });
        renderDashboard();
      } catch (error) { setHint(error.message); }
    };
  }

  function labelForMode(m) { return { voice: '🔊 Voice', text: '💬 Message', smart: '✨ Smart' }[m] || m; }
  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ── Conversations ─────────────────────────────────────────
  async function loadConversations() {
    try {
      const { conversations } = await SACHIN.listConversations();
      els.convoList.innerHTML = conversations.map((c) => `
        <div class="convo-row ${c.id === currentConversationId ? 'active' : ''}" data-id="${c.id}" data-mode="${c.mode}">
          <button class="convo-item ${c.id === currentConversationId ? 'active' : ''}" data-id="${c.id}">${escapeHtml(c.title)}</button>
          <button class="convo-delete" data-id="${c.id}" title="Delete conversation" aria-label="Delete conversation">×</button>
        </div>
      `).join('') || '<p style="color:var(--text-dim);font-size:12px;padding:8px;">No conversations yet.</p>';

      els.convoList.querySelectorAll('.convo-item').forEach((btn) => {
        btn.onclick = () => openConversation(btn.dataset.id, btn.closest('.convo-row').dataset.mode);
      });
      els.convoList.querySelectorAll('.convo-delete').forEach((btn) => {
        btn.onclick = async (event) => {
          event.stopPropagation();
          if (!confirm('Delete this conversation and its messages?')) return;
          await SACHIN.deleteConversation(btn.dataset.id);
          if (currentConversationId === btn.dataset.id) {
            currentConversationId = null;
            els.chatThread.innerHTML = '';
            els.chatThread.appendChild(els.chatEmpty);
          }
          await loadConversations();
        };
      });
    } catch { /* silent — sidebar list is non-critical */ }
  }

  async function openConversation(id, mode = 'friend') {
    currentConversationId = id;
    currentMode = mode;
    setModeTab(mode);
    showView('chat');
    els.chatThread.innerHTML = '';
    try {
      const { messages } = await SACHIN.getMessages(id);
      if (!messages.length) { els.chatThread.appendChild(els.chatEmpty); return; }
      messages.forEach((m) => appendMessage(m.role, m.content));
    } catch (e) {
      appendMessage('assistant', e.message);
    }
    document.querySelectorAll('.convo-item').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
  }

  // ── Chat ──────────────────────────────────────────────────
  function wireChat() {
    document.querySelectorAll('.mode-tab').forEach((btn) => {
      btn.onclick = () => { currentMode = btn.dataset.mode; setModeTab(currentMode); };
    });
    document.querySelectorAll('#responseToggle button').forEach((btn) => {
      btn.onclick = async () => {
        const previous = preferences.response_mode;
        setResponseModeButton(btn.dataset.mode);
        try {
          const { preferences: updated } = await SACHIN.updatePreferences({ response_mode: btn.dataset.mode });
          preferences = updated;
          renderDashboard();
        } catch (error) {
          setResponseModeButton(previous);
          setHint(error.message);
        }
      };
    });

    els.sendBtn.onclick = () => sendCurrentInput();
    els.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrentInput(); }
    });
    els.chatInput.addEventListener('input', () => {
      els.chatInput.style.height = 'auto';
      els.chatInput.style.height = Math.min(els.chatInput.scrollHeight, 140) + 'px';
    });

    els.micBtn.onclick = () => {
      if (voiceInputOn) {
        voiceInputCancelled = true;
        if (SachinVoice.isSupported()) SachinVoice.stopListening();
        else SachinVoice.stopRecording();
        setHint('Stopped listening.');
      } else startVoiceInput();
    };

    if (!SachinVoice.isSupported() && !SachinVoice.isRecordingSupported()) {
      els.micBtn.disabled = true;
      els.micBtn.title = 'Voice input is not supported in this browser';
    }
  }

  function setModeTab(mode) {
    document.querySelectorAll('.mode-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  }
  function setResponseModeButton(mode) {
    document.querySelectorAll('#responseToggle button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  }

  function activeResponseMode() { return preferences.response_mode; }

  async function startVoiceInput() {
    if (!SachinVoice.isSupported()) {
      if (!SachinVoice.isRecordingSupported()) { setHint('Voice input is not supported in this browser. You can still type.'); return; }
      const granted = await SachinVoice.requestMicPermission();
      if (!granted) { setHint('Microphone access was denied — you can still type.'); return; }
      voiceInputOn = true;
      voiceInputCancelled = false;
      els.micBtn.classList.add('recording');
      setHint('Recording… Tap the microphone to stop. I’ll transcribe it securely on the server.');
      try {
        const audio = await SachinVoice.recordAudio({
          maxDurationMs: 20000,
          onEnd: () => { voiceInputOn = false; els.micBtn.classList.remove('recording'); }
        });
        if (voiceInputCancelled) return;
        setHint('Transcribing…');
        const result = await SACHIN.transcribeAudio(audio);
        setHint('');
        await sendMessage(result.transcript, 'voice', result.voiceReservationId);
      } catch (error) {
        if (!voiceInputCancelled) setHint(error.message);
      } finally {
        voiceInputOn = false;
        els.micBtn.classList.remove('recording');
        voiceInputCancelled = false;
      }
      return;
    }
    const granted = await SachinVoice.requestMicPermission();
    if (!granted) { setHint('Microphone access was denied — you can still type.'); return; }

    voiceInputOn = true;
    voiceInputCancelled = false;
    els.micBtn.classList.add('recording');
    setHint('Listening…');
    try {
      const transcript = await SachinVoice.listenOnce({
        onEnd: () => { els.micBtn.classList.remove('recording'); voiceInputOn = false; }
      });
      setHint('');
      await sendMessage(transcript, 'voice');
    } catch (e) {
      if (!voiceInputCancelled) setHint(e.message);
    } finally {
      voiceInputOn = false;
      els.micBtn.classList.remove('recording');
      voiceInputCancelled = false;
    }
  }

  function setHint(text) { els.chatHint.textContent = text; }

  async function sendCurrentInput() {
    const text = els.chatInput.value.trim();
    if (!text) return;
    els.chatInput.value = '';
    els.chatInput.style.height = 'auto';
    await sendMessage(text, 'text');
  }

  async function sendMessage(text, inputType, voiceReservationId) {
    if (els.chatEmpty.parentElement) els.chatEmpty.remove();
    appendMessage('user', text);
    const thinkingEl = appendThinking();

    try {
      const res = await SACHIN.sendMessage({
        conversationId: currentConversationId,
        message: text,
        inputType,
        mode: currentMode,
        ...(voiceReservationId ? { voiceReservationId } : {})
      });
      currentConversationId = res.conversationId;
      thinkingEl.remove();
      appendMessage('assistant', res.reply);
      if (res.suggestions?.length) appendMemorySuggestions(res.suggestions);
      loadConversations();

      const mode = activeResponseMode();
      const shouldSpeak = mode === 'voice' || (mode === 'smart' && inputType === 'voice');
      if (shouldSpeak && SachinVoice.isSpeechSupported()) {
        SachinVoice.speak(res.reply, { voiceName: preferences.tts_voice }).catch(() => setHint('I replied, but this browser could not speak the response.'));
      }
      if (wakeListeningOn) {
        SachinVoice.startWakeListening(preferences.wake_phrase, handleWakePhrase, () => {});
      }
    } catch (e) {
      thinkingEl.remove();
      appendMessage('assistant', e.message);
    }
  }

  function appendThinking() {
    const div = document.createElement('div');
    div.className = 'msg msg-assistant';
    div.textContent = 'Thinking…';
    els.chatThread.appendChild(div);
    els.chatThread.scrollTop = els.chatThread.scrollHeight;
    return div;
  }

  function appendMessage(role, content) {
    const wrap = document.createElement('div');
    wrap.className = `msg msg-${role}`;
    wrap.textContent = content;

    if (role === 'assistant' && SachinVoice.isSpeechSupported()) {
      const listenBtn = document.createElement('button');
      listenBtn.className = 'msg-listen';
      listenBtn.textContent = '🔊 Listen';
      listenBtn.onclick = () => SachinVoice.speak(content, { voiceName: preferences.tts_voice }).catch(() => setHint('I had trouble speaking that response out loud.'));
      const container = document.createElement('div');
      container.appendChild(wrap);
      container.appendChild(listenBtn);
      els.chatThread.appendChild(container);
      els.chatThread.scrollTop = els.chatThread.scrollHeight;
      return;
    }

    els.chatThread.appendChild(wrap);
    els.chatThread.scrollTop = els.chatThread.scrollHeight;
  }

  function appendMemorySuggestions(suggestions) {
    for (const suggestion of suggestions) {
      if (!suggestion.content || suggestion.content.length > 500) continue;
      const card = document.createElement('article');
      card.className = 'memory-suggestion';
      const label = document.createElement('div');
      label.className = 'memory-suggestion-label';
      label.textContent = 'MEMORY SUGGESTION · REVIEW BEFORE SAVING';
      const content = document.createElement('div');
      content.className = 'memory-suggestion-text';
      content.textContent = suggestion.content;
      const actions = document.createElement('div');
      actions.className = 'memory-suggestion-actions';
      const save = document.createElement('button');
      save.textContent = 'Save to Memory Vault';
      const dismiss = document.createElement('button');
      dismiss.textContent = 'Don’t save';
      save.onclick = async () => {
        save.disabled = true;
        try {
          await SACHIN.createMemory({
            category: suggestion.category || 'context',
            content: suggestion.content,
            pinned: !!suggestion.pinned
          });
          label.textContent = 'SAVED TO YOUR MEMORY VAULT';
          actions.remove();
          renderDashboard();
        } catch (error) {
          save.disabled = false;
          label.textContent = error.message;
        }
      };
      dismiss.onclick = () => card.remove();
      actions.append(save, dismiss);
      card.append(label, content, actions);
      els.chatThread.appendChild(card);
    }
    els.chatThread.scrollTop = els.chatThread.scrollHeight;
  }

  // ── Memory Vault ──────────────────────────────────────────
  async function loadMemories() {
    els.memoryList.innerHTML = '<p class="memory-empty">Loading…</p>';
    try {
      const { memories } = await SACHIN.listMemories();
      if (!memories.length) {
        els.memoryList.innerHTML = '<p class="memory-empty">Nothing here yet. Tell SACHIN something worth remembering.</p>';
        return;
      }
      els.memoryList.innerHTML = memories.map((m) => `
        <div class="memory-card ${m.approved ? '' : 'memory-pending'}" data-id="${m.id}">
          <input class="memory-select" type="checkbox" aria-label="Select this memory for deletion" />
          ${m.approved ? '' : '<span class="memory-pending-label">Needs your approval</span>'}
          <span class="memory-category">${m.category}</span>
          <span class="memory-content">${escapeHtml(m.content)}</span>
          <div class="memory-actions">
            ${m.approved ? '' : '<button data-action="approve">Approve</button>'}
            <button data-action="pin">${m.pinned ? '★ Pinned' : '☆ Pin'}</button>
            <button data-action="edit">Edit</button>
            <button data-action="delete">Delete</button>
          </div>
        </div>
      `).join('');

      const deleteSelected = document.getElementById('deleteSelectedBtn');
      const refreshSelection = () => {
        const selected = els.memoryList.querySelectorAll('.memory-select:checked').length;
        deleteSelected.classList.toggle('hidden', selected === 0);
        deleteSelected.textContent = `Delete ${selected} selected`;
      };
      els.memoryList.querySelectorAll('.memory-select').forEach((checkbox) => checkbox.addEventListener('change', refreshSelection));
      deleteSelected.onclick = async () => {
        const ids = Array.from(els.memoryList.querySelectorAll('.memory-select:checked')).map((checkbox) => checkbox.closest('.memory-card').dataset.id);
        if (!ids.length || !confirm(`Delete ${ids.length} selected memories?`)) return;
        await Promise.all(ids.map((id) => SACHIN.deleteMemory(id)));
        loadMemories();
      };

      els.memoryList.querySelectorAll('.memory-card').forEach((card) => {
        const id = card.dataset.id;
        card.querySelector('[data-action="delete"]').onclick = async () => {
          await SACHIN.deleteMemory(id);
          loadMemories();
        };
        card.querySelector('[data-action="pin"]').onclick = async () => {
          const nowPinned = card.querySelector('[data-action="pin"]').textContent.includes('★');
          await SACHIN.updateMemory(id, { pinned: !nowPinned });
          loadMemories();
        };
        card.querySelector('[data-action="edit"]').onclick = async () => {
          const existing = card.querySelector('.memory-content').textContent;
          const nextContent = prompt('Edit this memory', existing);
          if (nextContent === null || !nextContent.trim()) return;
          try { await SACHIN.updateMemory(id, { content: nextContent.trim() }); loadMemories(); }
          catch (error) { alert(error.message); }
        };
        const approve = card.querySelector('[data-action="approve"]');
        if (approve) approve.onclick = async () => {
          try { await SACHIN.updateMemory(id, { approved: true }); loadMemories(); }
          catch (error) { alert(error.message); }
        };
      });
      refreshSelection();
    } catch (e) {
      els.memoryList.innerHTML = `<p class="memory-empty">${escapeHtml(e.message)}</p>`;
    }
  }

  document.getElementById('memAddBtn').onclick = async () => {
    const category = document.getElementById('memCategory').value;
    const contentInput = document.getElementById('memContent');
    const content = contentInput.value.trim();
    if (!content) return;
    try {
      await SACHIN.createMemory({ category, content, pinned: false });
      contentInput.value = '';
      loadMemories();
    } catch (error) { alert(error.message); }
  };

  document.getElementById('clearAllBtn').onclick = async () => {
    if (!confirm('This deletes everything SACHIN remembers about you. Continue?')) return;
    try { await SACHIN.clearAllMemories(); loadMemories(); }
    catch (error) { alert(error.message); }
  };

  // ── Settings ──────────────────────────────────────────────
  function renderSettings() {
    els.settingsGrid.innerHTML = `
      <div class="setting-row">
        <label for="wakePhraseInput">Wake phrase (a phrase before the permanent name SACHIN)</label>
        <input type="text" id="wakePhraseInput" value="${escapeHtml(preferences.wake_phrase)}" />
      </div>
      <div class="setting-row">
        <label for="responseLengthSelect">Explanation length</label>
        <select id="responseLengthSelect">
          <option value="short">Short</option>
          <option value="balanced">Balanced</option>
          <option value="detailed">Detailed</option>
        </select>
      </div>
      <div class="setting-row">
        <label for="responseModeSelect">Preferred response</label>
        <select id="responseModeSelect">
          <option value="voice">🔊 Voice</option>
          <option value="text">💬 Message</option>
          <option value="smart">✨ Smart</option>
        </select>
      </div>
      <div class="setting-row">
        <div class="toggle-row">
          <label for="memoryEnabledToggle" style="margin:0">Memory suggestions and personalization</label>
          <label class="switch"><input type="checkbox" id="memoryEnabledToggle" ${preferences.memory_enabled ? 'checked' : ''}/><span class="switch-track"></span></label>
        </div>
        <p style="color:var(--text-dim);font-size:12.5px;margin:10px 0 0;">When this is on, SACHIN can use memories you approved and suggest useful things to remember. Suggestions only enter your Memory Vault after you approve them. Turning this off pauses memory use; it does not delete saved memories.</p>
      </div>
      <div class="setting-row">
        <div class="toggle-row">
          <label for="wakeToggle" style="margin:0">Voice activation (this tab)</label>
          <label class="switch"><input type="checkbox" id="wakeToggle" ${wakeListeningOn ? 'checked' : ''}/><span class="switch-track"></span></label>
        </div>
        <p style="color:var(--text-dim);font-size:12.5px;margin:10px 0 0;">
          The browser listens for your wake phrase only while this tab is open and visible, after you grant microphone access and turn this on. It stops when you leave the tab. Background wake detection while the app is closed needs a separate native companion and on-device wake-word engine.
        </p>
      </div>
      <div class="setting-row">
        <div class="toggle-row">
          <label style="margin:0">${user.plan === 'pro' ? 'SACHIN Pro is active' : 'Upgrade to SACHIN Pro'}</label>
          ${user.plan === 'pro' ? '' : '<button class="btn-primary" id="settingsUpgradeBtn" style="padding:8px 16px;">Upgrade</button>'}
        </div>
      </div>
      <div class="setting-row">
        <h3 style="margin:0 0 8px;">Your data</h3>
        <p style="color:var(--text-dim);font-size:12.5px;">SACHIN stores account details, conversation text, preferences, goals, and the memories you approved in MySQL. Chat and recorded voice transcription run on this computer through Ollama without a cloud AI key. Browser speech recognition and spoken replies use your browser and may follow its provider's privacy rules. Recordings (up to 20 seconds) are converted to WAV in memory and are not written to disk. You can delete conversations and memories individually or permanently clear the full account below.</p>
        <button class="danger-btn" id="deleteAccountBtn">Permanently delete account data</button>
      </div>
      <button class="btn-primary" id="saveSettingsBtn" style="align-self:flex-start;">Save changes</button>
    `;
    document.getElementById('responseLengthSelect').value = preferences.response_length;
    document.getElementById('responseModeSelect').value = preferences.response_mode;

    const wakeToggle = document.getElementById('wakeToggle');
    if (!SachinVoice.isSupported()) {
      wakeToggle.disabled = true;
      wakeToggle.closest('.setting-row').querySelector('p').textContent = 'Voice recognition is not supported in this browser. You can still type to SACHIN.';
    }

    wakeToggle.onchange = async (e) => {
      if (e.target.checked) {
        if (!SachinVoice.isSupported()) { e.target.checked = false; return; }
        const granted = await SachinVoice.requestMicPermission();
        if (!granted) { e.target.checked = false; alert('Microphone access was denied. You can still type to SACHIN.'); return; }
        wakeListeningOn = true;
        try { preferences = (await SACHIN.updatePreferences({ voice_enabled: true })).preferences; }
        catch (error) { wakeListeningOn = false; e.target.checked = false; alert(error.message); return; }
        SachinVoice.startWakeListening(preferences.wake_phrase, handleWakePhrase, handleWakeError);
      } else {
        wakeListeningOn = false;
        SachinVoice.stopWakeListening();
        try { preferences = (await SACHIN.updatePreferences({ voice_enabled: false })).preferences; }
        catch (error) { setHint(error.message); }
      }
    };

    const upgradeBtn = document.getElementById('settingsUpgradeBtn');
    if (upgradeBtn) upgradeBtn.onclick = () => window.SachinBilling?.presentPaywall?.();

    document.getElementById('saveSettingsBtn').onclick = async () => {
      const wake_phrase = document.getElementById('wakePhraseInput').value.trim();
      const response_length = document.getElementById('responseLengthSelect').value;
      const response_mode = document.getElementById('responseModeSelect').value;
      const memory_enabled = document.getElementById('memoryEnabledToggle').checked;
      try {
        const { preferences: updated } = await SACHIN.updatePreferences({ wake_phrase, response_length, response_mode, memory_enabled });
        preferences = updated;
        setResponseModeButton(preferences.response_mode);
        if (wakeListeningOn) SachinVoice.startWakeListening(preferences.wake_phrase, handleWakePhrase, handleWakeError);
        alert('Saved.');
      } catch (e) { alert(e.message); }
    };

    document.getElementById('deleteAccountBtn').onclick = async () => {
      if (!confirm('This permanently deletes your conversations, memories, goals, preferences, and account. This cannot be undone. Continue?')) return;
      const password = prompt('Enter your password to confirm account deletion.');
      if (!password) return;
      try {
        await SACHIN.deleteAccount(password);
        SachinVoice.stopWakeListening();
        SACHIN.clearSession();
        window.location.href = 'index.html';
      } catch (error) { alert(error.message); }
    };
  }

  function handleWakePhrase(afterWake) {
    SachinVoice.stopWakeListening();
    showView('chat');
    if (afterWake && afterWake.trim()) sendMessage(afterWake.trim(), 'voice');
    else startVoiceInput();
  }

  function handleWakeError(error) {
    setHint(error?.message || 'Voice activation stopped.');
    wakeListeningOn = false;
    SachinVoice.stopWakeListening();
    const toggle = document.getElementById('wakeToggle');
    if (toggle) toggle.checked = false;
    SACHIN.updatePreferences({ voice_enabled: false }).then(({ preferences: updated }) => { preferences = updated; }).catch(() => {});
  }

  async function pauseWakeListening() {
    if (!wakeListeningOn) return;
    wakeListeningOn = false;
    SachinVoice.stopWakeListening();
    const toggle = document.getElementById('wakeToggle');
    if (toggle) toggle.checked = false;
    try { preferences = (await SACHIN.updatePreferences({ voice_enabled: false })).preferences; } catch { /* listening has already stopped locally */ }
  }

  function pauseAllVoice() {
    SachinVoice.stopSpeaking();
    if (voiceInputOn) {
      voiceInputCancelled = true;
      if (SachinVoice.isSupported()) SachinVoice.stopListening();
      else SachinVoice.stopRecording();
      voiceInputOn = false;
      els.micBtn.classList.remove('recording');
    }
    pauseWakeListening();
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAllVoice(); });
  window.addEventListener('blur', pauseAllVoice);

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  window.SACHINRefreshAccount = async function refreshAccountAfterBilling() {
    try {
      const { user: updated } = await SACHIN.me();
      user = updated;
      els.planPill.textContent = user.plan === 'pro' ? 'SACHIN Pro' : 'Free plan';
      renderDashboard();
    } catch { /* RevenueCat webhook may still be processing */ }
  };

  boot();
})();
