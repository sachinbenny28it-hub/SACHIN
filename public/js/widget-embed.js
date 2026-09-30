/**
 * A small floating SACHIN bubble, embeddable on any page (here, app.html).
 * Expands into the compact widget card described in the spec. This is the
 * *web* rendering of the widget; the same card shape is reused standalone
 * in widget.html for a desktop/mobile "always on top" companion window.
 */
(() => {
  const root = document.getElementById('sachinWidgetRoot');
  if (!root) return;

  root.innerHTML = `
    <button class="sw-bubble" id="swBubble" aria-label="Open SACHIN"><span class="sachin-orb sw-bubble-orb" aria-hidden="true"></span></button>
    <div class="sw-card hidden" id="swCard">
      <div class="sw-card-head">
        <span class="sachin-orb sw-card-orb" aria-hidden="true"></span>
        <div>
          <div class="sw-title">SACHIN</div>
          <div class="sw-line" id="swLine">Hey, what's going on?</div>
        </div>
        <button class="sw-close" id="swClose">×</button>
      </div>
      <div class="sw-actions">
        <button id="swTalk">🎙️ Talk</button>
        <button id="swMessage">⌨️ Message</button>
      </div>
      <a class="sw-open-full" href="widget.html" target="_blank" rel="noopener">Open compact widget ↗</a>
      <a class="sw-open-full" href="app.html">Open full SACHIN →</a>
    </div>
  `;

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'css/widget.css';
  document.head.appendChild(style);

  const bubble = document.getElementById('swBubble');
  const card = document.getElementById('swCard');

  bubble.onclick = () => card.classList.toggle('hidden');
  document.getElementById('swClose').onclick = () => card.classList.add('hidden');

  document.getElementById('swTalk').onclick = () => {
    card.classList.add('hidden');
    document.querySelector('.nav-item[data-view="chat"]')?.click();
    document.getElementById('micBtn')?.click();
  };
  document.getElementById('swMessage').onclick = () => {
    card.classList.add('hidden');
    document.querySelector('.nav-item[data-view="chat"]')?.click();
    document.getElementById('chatInput')?.focus();
  };
})();
