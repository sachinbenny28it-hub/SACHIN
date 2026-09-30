(() => {
  const orb = document.getElementById('widgetOrb');
  const line = document.getElementById('widgetLine');
  const quick = document.getElementById('widgetQuick');
  const status = document.getElementById('widgetStatus');
  const response = document.getElementById('widgetResponse');
  const composer = document.getElementById('widgetComposer');
  const input = document.getElementById('widgetInput');
  const sendButton = document.getElementById('widgetSend');
  const listenButton = document.getElementById('widgetListen');
  const closeButton = document.getElementById('widgetClose');
  let preferences = null;
  let conversationId = null;
  let conversationStorageKey = null;
  let recording = false;

  const talkButton = document.getElementById('widgetTalk');
  const messageButton = document.getElementById('widgetMessage');

  if (window.SACHINDesktop && closeButton) {
    closeButton.classList.add('visible');
    closeButton.onclick = () => window.SACHINDesktop.close();
  }

  function disableActions() {
    talkButton.disabled = true;
    messageButton.disabled = true;
    sendButton.disabled = true;
  }

  if (!SACHIN.getToken()) {
    line.textContent = 'Sign in to talk with me.';
    quick.textContent = 'Your account keeps your conversations and memories private.';
    disableActions();
    return;
  }

  async function boot() {
    try {
      const [{ user }, preferenceResult] = await Promise.all([SACHIN.me(), SACHIN.getPreferences()]);
      preferences = preferenceResult.preferences;
      conversationStorageKey = `sachin_widget_conversation_${user.id}`;
      conversationId = localStorage.getItem(conversationStorageKey) || null;
      if (!user.onboarded) {
        line.textContent = 'Finish setting up SACHIN first.';
        quick.textContent = 'Your onboarding choices carry across the full app and widget.';
        disableActions();
        return;
      }
      await loadSuggestion();
    } catch (error) {
      line.textContent = error.message || 'I could not load your account.';
      disableActions();
    }
  }

  async function loadSuggestion() {
    try {
      const [{ goals }, memoriesResult] = await Promise.all([
        preferences.memory_enabled ? SACHIN.listGoals() : Promise.resolve({ goals: [] }),
        preferences.memory_enabled ? SACHIN.listMemories() : Promise.resolve({ memories: [] })
      ]);
      const goal = goals.find((item) => item.status === 'active');
      const approved = memoriesResult.memories.filter((item) => item.approved);
      const memory = approved.find((item) => item.pinned) || approved[0];
      quick.textContent = goal ? `Today's focus: ${goal.title}` : memory ? `From your Memory Vault: ${memory.content}` : 'I’m here when you need me.';
    } catch {
      quick.textContent = 'I’m here when you need me.';
    }
  }

  messageButton.onclick = () => {
    composer.hidden = !composer.hidden;
    if (!composer.hidden) input.focus();
  };

  sendButton.onclick = () => sendTypedMessage();
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendTypedMessage();
    }
  });

  async function sendTypedMessage() {
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    await send(message, 'text');
  }

  talkButton.onclick = async () => {
    if (recording) {
      SachinVoice.stopRecording();
      status.textContent = 'Finishing your recording…';
      return;
    }
    if (!SachinVoice.isSupported() && !SachinVoice.isRecordingSupported()) {
      status.textContent = 'Voice input is not supported here. You can message instead.';
      return;
    }

    if (!SachinVoice.isSupported()) {
      recording = true;
      orb.classList.add('listening');
      talkButton.textContent = '⏹ Stop';
      status.textContent = 'Recording up to 20 seconds… tap Stop when you’re done.';
      try {
        const audio = await SachinVoice.recordAudio({
          maxDurationMs: 20000,
          onEnd: () => { recording = false; orb.classList.remove('listening'); talkButton.textContent = '🎙️ Talk'; }
        });
        status.textContent = 'Transcribing…';
        talkButton.disabled = true;
        const result = await SACHIN.transcribeAudio(audio);
        await send(result.transcript, 'voice', result.voiceReservationId);
      } catch (error) {
        status.textContent = error.message || 'I had trouble with that recording. Try again.';
        recording = false;
        orb.classList.remove('listening');
        talkButton.textContent = '🎙️ Talk';
      } finally {
        talkButton.disabled = false;
      }
      return;
    }

    const granted = await SachinVoice.requestMicPermission();
    if (!granted) { status.textContent = 'Microphone access was denied. You can still message me.'; return; }
    orb.classList.add('listening');
    status.textContent = 'Listening…';
    try {
      const transcript = await SachinVoice.listenOnce({ onEnd: () => orb.classList.remove('listening') });
      await send(transcript, 'voice');
    } catch (error) {
      status.textContent = error.message;
      orb.classList.remove('listening');
    }
  };

  async function send(message, inputType, voiceReservationId) {
    talkButton.disabled = true;
    messageButton.disabled = true;
    sendButton.disabled = true;
    status.textContent = 'Thinking…';
    try {
      const result = await SACHIN.sendMessage({
        conversationId,
        message,
        inputType,
        mode: 'friend',
        voiceReservationId
      });
      conversationId = result.conversationId;
      if (conversationStorageKey) localStorage.setItem(conversationStorageKey, conversationId);
      line.textContent = 'SACHIN';
      response.textContent = result.reply;
      response.classList.add('visible');
      status.textContent = result.suggestions?.length ? 'I have a memory suggestion. Review it in the full app before saving.' : '';
      listenButton.hidden = !SachinVoice.isSpeechSupported();
      const shouldSpeak = preferences?.response_mode === 'voice' || (preferences?.response_mode === 'smart' && inputType === 'voice');
      if (shouldSpeak) {
        try { await SachinVoice.speak(result.reply, { voiceName: preferences?.tts_voice }); }
        catch { status.textContent = 'I replied, but this browser could not speak the response.'; }
      }
    } catch (error) {
      status.textContent = error.message || 'I couldn’t reach SACHIN right now. Try again in a little while.';
    } finally {
      talkButton.disabled = false;
      messageButton.disabled = false;
      sendButton.disabled = false;
    }
  }

  listenButton.onclick = async () => {
    if (!response.textContent) return;
    try { await SachinVoice.speak(response.textContent, { voiceName: preferences?.tts_voice }); }
    catch { status.textContent = 'I had trouble speaking that response out loud.'; }
  };

  boot();
})();
