'use strict';

(() => {
  const STORAGE_KEY = 'linkedinConnections';
  const MODAL_ROOT_ID = 'liconn-track-modal-root';
  const BYPASS_FLAG = '__liconnBypass';

  let lastUrl = location.href;
  let debounceTimer = null;
  let activeEscHandler = null;

  // --- Utilities ---

  function getProfileUrl() {
    const path = location.pathname.replace(/\/+$/, '');
    if (!/^\/in\/[^/]+/.test(path)) return null;
    const clean = path.replace(/\/(overlay|detail|recent-activity).*$/, '');
    return location.origin + clean;
  }

  function getProfileName() {
    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    const title = document.title.replace(/\s*[|\-–].*$/, '').trim();
    return title || 'Unknown';
  }

  function getConnectButtonText(btn) {
    const spans = btn.querySelectorAll('span');
    for (const span of spans) {
      const text = span.textContent.trim();
      if (/^connect$/i.test(text)) return text;
    }
    const directText = btn.textContent.trim();
    if (/^connect$/i.test(directText)) return directText;
    return null;
  }

  function isConnectButton(btn) {
    if (btn.tagName !== 'BUTTON') return false;

    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel.includes('disconnect') || ariaLabel.includes('pending') || ariaLabel.includes('connected')) return false;
    if (ariaLabel.includes('connect') || ariaLabel.includes('invite') && ariaLabel.includes('connect')) return true;

    if (getConnectButtonText(btn)) return true;

    return false;
  }

  function findConnectButton(target) {
    let el = target;
    while (el && el !== document.body) {
      if (el.tagName === 'BUTTON' && isConnectButton(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function getNameFromNearestContext(btn) {
    const card = btn.closest('[data-field]') ||
                 btn.closest('.entity-result__item') ||
                 btn.closest('.discover-entity-type-card') ||
                 btn.closest('li');
    if (card) {
      const nameEl = card.querySelector('span[aria-hidden="true"]') ||
                     card.querySelector('.entity-result__title-text a span') ||
                     card.querySelector('a[href*="/in/"] span');
      if (nameEl && nameEl.textContent.trim()) return nameEl.textContent.trim();
    }
    return null;
  }

  function getProfileUrlFromNearestContext(btn) {
    const card = btn.closest('[data-field]') ||
                 btn.closest('.entity-result__item') ||
                 btn.closest('.discover-entity-type-card') ||
                 btn.closest('li');
    if (card) {
      const link = card.querySelector('a[href*="/in/"]');
      if (link) {
        const url = new URL(link.href);
        const cleanPath = url.pathname.replace(/\/+$/, '');
        return url.origin + cleanPath;
      }
    }
    return null;
  }

  function isAlreadyConnected() {
    const buttons = document.querySelectorAll(
      'section.pv-top-card button, .pv-top-card-v2-ctas button, .pvs-profile-actions button, .pv-top-card__links button'
    );
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (
        text === 'message' ||
        ariaLabel.includes('message') ||
        text.includes('remove connection') ||
        ariaLabel.includes('remove connection')
      ) {
        return true;
      }
    }
    return false;
  }

  // --- Storage ---

  function loadConnections() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        resolve(result[STORAGE_KEY] || {});
      });
    });
  }

  function saveConnection(profileUrl, data) {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        const connections = result[STORAGE_KEY] || {};
        connections[profileUrl] = { ...connections[profileUrl], ...data };
        chrome.storage.local.set({ [STORAGE_KEY]: connections }, resolve);
      });
    });
  }

  function updateConnectionStatus(profileUrl, status) {
    return saveConnection(profileUrl, { connectionStatus: status });
  }

  // --- Status checker ---

  async function checkAndUpdateStatus() {
    const profileUrl = getProfileUrl();
    if (!profileUrl) return;

    const connections = await loadConnections();
    const record = connections[profileUrl];
    if (!record) return;
    if (record.connectionStatus === 'Connected') return;

    if (isAlreadyConnected()) {
      await updateConnectionStatus(profileUrl, 'Connected');
    }
  }

  // --- Modal ---

  function removeModal() {
    const existing = document.getElementById(MODAL_ROOT_ID);
    if (existing) existing.remove();
    if (activeEscHandler) {
      document.removeEventListener('keydown', activeEscHandler);
      activeEscHandler = null;
    }
  }

  function showModal(originalButton) {
    removeModal();

    const profileUrl = getProfileUrl() || getProfileUrlFromNearestContext(originalButton) || (location.origin + location.pathname.replace(/\/+$/, ''));
    const profileName = getProfileUrl() ? getProfileName() : (getNameFromNearestContext(originalButton) || getProfileName());

    const root = document.createElement('div');
    root.id = MODAL_ROOT_ID;
    root.innerHTML = `
      <div class="liconn-backdrop"></div>
      <div class="liconn-modal" role="dialog" aria-modal="true" aria-labelledby="liconn-title">
        <h2 id="liconn-title">Why are you connecting?</h2>
        <p class="liconn-subtitle">Connecting with <strong>${escapeHtml(profileName)}</strong></p>
        <textarea id="liconn-reason" placeholder="e.g. Ask for referral for Google SWE role" rows="3"></textarea>
        <div class="liconn-actions">
          <button id="liconn-cancel" type="button">Cancel</button>
          <button id="liconn-save" type="button">Save &amp; Connect</button>
        </div>
      </div>
    `;

    document.body.appendChild(root);

    const textarea = root.querySelector('#liconn-reason');
    const saveBtn = root.querySelector('#liconn-save');
    const cancelBtn = root.querySelector('#liconn-cancel');
    const backdrop = root.querySelector('.liconn-backdrop');

    textarea.focus();

    cancelBtn.addEventListener('click', () => removeModal());
    backdrop.addEventListener('click', () => removeModal());

    activeEscHandler = (e) => {
      if (e.key === 'Escape') removeModal();
    };
    document.addEventListener('keydown', activeEscHandler);

    saveBtn.addEventListener('click', async () => {
      const reason = textarea.value.trim();
      if (!reason) {
        textarea.classList.add('liconn-error');
        textarea.focus();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      await saveConnection(profileUrl, {
        name: profileName,
        reason,
        connectionStatus: 'Pending',
        taskCompleted: false,
        dateAdded: new Date().toISOString(),
      });

      removeModal();

      originalButton[BYPASS_FLAG] = true;
      originalButton.click();
      setTimeout(() => { delete originalButton[BYPASS_FLAG]; }, 500);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Document-level event delegation (capturing phase) ---

  document.addEventListener('click', (e) => {
    const btn = findConnectButton(e.target);
    if (!btn) return;
    if (btn[BYPASS_FLAG]) return;

    e.stopImmediatePropagation();
    e.preventDefault();
    showModal(btn);
  }, true);

  // --- SPA navigation detection ---

  function onUrlChange() {
    const currentUrl = location.href;
    if (currentUrl === lastUrl) return;
    lastUrl = currentUrl;
    checkAndUpdateStatus();
  }

  // --- MutationObserver (debounced) ---

  function onDomMutation() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      onUrlChange();
      checkAndUpdateStatus();
    }, 400);
  }

  const observer = new MutationObserver(onDomMutation);
  observer.observe(document.body, { childList: true, subtree: true });

  // --- Initial run ---
  checkAndUpdateStatus();
})();
