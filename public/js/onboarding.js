(() => {
  const card = document.getElementById('card');
  const progress = document.getElementById('progress');

  const state = {
    mode: 'register', // or 'login'
    responseLength: 'balanced',
    responseMode: 'smart',
    wakePhrase: 'Hey SACHIN',
    primaryUse: 'everything',
    memoryEnabled: null
  };

  const STEPS = ['account', 'length', 'mode', 'wake', 'memory', 'use'];
  let stepIndex = 0;

  // If already signed in and onboarded, skip straight to the app.
  (async function init() {
    if (SACHIN.getToken()) {
      try {
        const { user } = await SACHIN.me();
        if (user.onboarded) { window.location.href = 'app.html'; return; }
      } catch { SACHIN.clearSession(); }
    }
    render();
  })();

  function renderProgress() {
    progress.innerHTML = STEPS.map((_, i) => `<span class="dot ${i <= stepIndex ? 'active' : ''}"></span>`).join('');
  }

  function next() { stepIndex = Math.min(stepIndex + 1, STEPS.length - 1); render(); }
  function back() { stepIndex = Math.max(stepIndex - 1, 0); render(); }

  function render() {
    renderProgress();
    const step = STEPS[stepIndex];
    if (step === 'account') return renderAccount();
    if (step === 'length') return renderLength();
    if (step === 'mode') return renderMode();
    if (step === 'wake') return renderWake();
    if (step === 'memory') return renderMemory();
    if (step === 'use') return renderUse();
  }

  function renderAccount() {
    const isRegister = state.mode === 'register';
    card.innerHTML = `
      <h1>Hey. I'm SACHIN.</h1>
      <p class="lead">${isRegister ? "Let's set up your account — it takes about a minute." : "Welcome back."}</p>
      <div id="err" class="error-note" style="display:none"></div>
      ${isRegister ? '<input class="field" id="name" placeholder="Your name" />' : ''}
      <input class="field" id="email" type="email" placeholder="Email" />
      <input class="field" id="password" type="password" placeholder="Password" />
      <div class="onboard-actions">
        <button class="btn-text" id="toggleMode">${isRegister ? 'I already have an account' : "I'm new here"}</button>
        <button class="btn-primary" id="submitAccount">${isRegister ? 'Continue' : 'Sign in'}</button>
      </div>
    `;
    document.getElementById('toggleMode').onclick = () => { state.mode = isRegister ? 'login' : 'register'; render(); };
    document.getElementById('submitAccount').onclick = async () => {
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const errBox = document.getElementById('err');
      errBox.style.display = 'none';
      try {
        let result;
        if (isRegister) {
          const name = document.getElementById('name').value.trim();
          if (!name || !email || !password) throw new Error('Fill in every field to continue.');
          result = await SACHIN.register(name, email, password);
        } else {
          result = await SACHIN.login(email, password);
        }
        SACHIN.setSession(result.token, result.user);
        if (result.user.onboarded) { window.location.href = 'app.html'; return; }
        next();
      } catch (e) {
        errBox.textContent = e.message;
        errBox.style.display = 'block';
      }
    };
  }

  function optionList(options, selectedKey, onPick) {
    return `<div class="option-list">${options.map((o) => `
      <button class="option-btn ${o.key === selectedKey ? 'selected' : ''}" data-key="${o.key}">
        ${o.label}${o.hint ? `<small>${o.hint}</small>` : ''}
      </button>`).join('')}</div>`;
  }

  function wireOptions(onPick) {
    card.querySelectorAll('.option-btn').forEach((btn) => {
      btn.onclick = () => onPick(btn.dataset.key);
    });
  }

  function renderLength() {
    const options = [
      { key: 'short', label: 'Keep it short', hint: 'Quick, to-the-point answers' },
      { key: 'balanced', label: 'Balanced', hint: 'Clear and complete, no padding' },
      { key: 'detailed', label: 'Go deep', hint: 'Step-by-step, teach me properly' }
    ];
    card.innerHTML = `
      <h1>How should I explain things?</h1>
      <p class="lead">You can change this anytime.</p>
      ${optionList(options, state.responseLength)}
      <div class="onboard-actions">
        <button class="btn-text" id="backBtn">Back</button>
        <button class="btn-primary" id="nextBtn">Continue</button>
      </div>
    `;
    wireOptions((key) => { state.responseLength = key; render(); });
    document.getElementById('backBtn').onclick = back;
    document.getElementById('nextBtn').onclick = next;
  }

  function renderMode() {
    const options = [
      { key: 'voice', label: '🔊 Voice', hint: 'SACHIN speaks its responses' },
      { key: 'text', label: '💬 Message', hint: 'SACHIN replies in text' },
      { key: 'smart', label: '✨ Smart', hint: 'SACHIN picks based on context' }
    ];
    card.innerHTML = `
      <h1>How should I respond?</h1>
      <p class="lead">You can switch per-message later, too.</p>
      ${optionList(options, state.responseMode)}
      <div class="onboard-actions">
        <button class="btn-text" id="backBtn">Back</button>
        <button class="btn-primary" id="nextBtn">Continue</button>
      </div>
    `;
    wireOptions((key) => { state.responseMode = key; render(); });
    document.getElementById('backBtn').onclick = back;
    document.getElementById('nextBtn').onclick = next;
  }

  function renderWake() {
    const presets = ['Hey SACHIN', 'Hello SACHIN', 'Yo SACHIN', 'Okay SACHIN', 'Wake up SACHIN'];
    card.innerHTML = `
      <h1>Pick your wake phrase</h1>
      <p class="lead">"SACHIN" always stays — you're just choosing what comes before it.</p>
      <div class="option-list">
        ${presets.map((p) => `<button class="option-btn ${p === state.wakePhrase ? 'selected' : ''}" data-preset="${p}">${p}</button>`).join('')}
      </div>
      <input class="field" id="customWake" placeholder="Or type your own — add words before SACHIN" value="${presets.includes(state.wakePhrase) ? '' : escapeHtml(state.wakePhrase)}" />
      <div id="wakeErr" class="error-note" style="display:none"></div>
      <div class="onboard-actions">
        <button class="btn-text" id="backBtn">Back</button>
        <button class="btn-primary" id="nextBtn">Continue</button>
      </div>
    `;
    card.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.onclick = () => { state.wakePhrase = btn.dataset.preset; document.getElementById('customWake').value = ''; render(); };
    });
    document.getElementById('backBtn').onclick = back;
    document.getElementById('nextBtn').onclick = () => {
      const custom = document.getElementById('customWake').value.trim();
      const phrase = custom || state.wakePhrase;
      if (!/\bsachin\b/i.test(phrase) || phrase.toLowerCase().indexOf('sachin') === 0) {
        const err = document.getElementById('wakeErr');
        err.textContent = 'Add a word or phrase before "SACHIN" — the name stays the same.';
        err.style.display = 'block';
        return;
      }
      state.wakePhrase = phrase;
      next();
    };
  }

  function renderMemory() {
    card.innerHTML = `
      <h1>About memory</h1>
      <p class="lead">SACHIN remembers what you choose to share. Turn on suggestions and I can offer useful things to keep, but nothing enters your Memory Vault until you approve it. You can review, edit, or delete saved memories anytime. Say "don't remember this" and I won't suggest or save it.</p>
      ${optionList([
        { key: 'on', label: 'Enable memory suggestions', hint: 'SACHIN can use approved memories to personalize later chats' },
        { key: 'off', label: 'Keep memory off', hint: 'No saved memories are used in conversations' }
      ], state.memoryEnabled === null ? '' : state.memoryEnabled ? 'on' : 'off')}
      <div class="onboard-actions">
        <button class="btn-text" id="backBtn">Back</button>
        <button class="btn-primary" id="nextBtn">Continue</button>
      </div>
    `;
    wireOptions((key) => { state.memoryEnabled = key === 'on'; render(); });
    document.getElementById('backBtn').onclick = back;
    document.getElementById('nextBtn').onclick = () => {
      if (state.memoryEnabled === null) {
        const note = document.createElement('p');
        note.className = 'error-note';
        note.textContent = 'Choose whether memory suggestions should be on or off.';
        card.insertBefore(note, card.querySelector('.onboard-actions'));
        return;
      }
      next();
    };
  }

  function renderUse() {
    const options = [
      { key: 'study', label: 'Study' },
      { key: 'coding', label: 'Coding' },
      { key: 'productivity', label: 'Productivity' },
      { key: 'daily', label: 'Daily guidance' },
      { key: 'conversation', label: 'Just talking' },
      { key: 'everything', label: 'Everything' }
    ];
    card.innerHTML = `
      <h1>What do you mainly want me for?</h1>
      <p class="lead">This just helps me lean in the right direction — I'll still do everything else too.</p>
      ${optionList(options, state.primaryUse)}
      <div class="onboard-actions">
        <button class="btn-text" id="backBtn">Back</button>
        <button class="btn-primary" id="finishBtn">Start talking to SACHIN</button>
      </div>
    `;
    wireOptions((key) => { state.primaryUse = key; render(); });
    document.getElementById('backBtn').onclick = back;
    document.getElementById('finishBtn').onclick = finish;
  }

  async function finish() {
    try {
      await SACHIN.updatePreferences({
        response_length: state.responseLength,
        response_mode: state.responseMode,
        wake_phrase: state.wakePhrase,
        primary_use: state.primaryUse,
        memory_enabled: state.memoryEnabled,
        completeOnboarding: true
      });
      window.location.href = 'app.html';
    } catch (e) {
      alert(e.message);
    }
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value || '';
    return div.innerHTML;
  }
})();
