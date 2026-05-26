'use strict';

(() => {
  const STORAGE_KEY = 'linkedinConnections';
  const MODAL_ROOT_ID = 'liconn-track-modal-root';
  const PROCESSED_ATTR = 'data-liconn-tracked';
  const BYPASS_FLAG = '__liconnBypass';

  let lastUrl = location.href;
  let debounceTimer = null;

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

  function isConnectButton(btn) {
    if (btn.getAttribute(PROCESSED_ATTR)) return false;
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel.includes('connect') && !ariaLabel.includes('pending')) return true;
    const span = btn.querySelector('span');
    const text = (span ? span.textContent : btn.textContent || '').trim();
    if (/^connect$/i.test(text)) return true;
    return false;
  }

  function isAlreadyConnected() {
    const buttons = document.querySelectorAll(
      'section.pv-top-card button, .pv-top-card-v2-ctas button, .pvs-profile-actions button'
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
  }

  function showModal(originalButton) {
    removeModal();

    const profileUrl = getProfileUrl() || location.origin + location.pathname.replace(/\/+$/, '');
    const profileName = getProfileName();

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

    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        removeModal();
        document.removeEventListener('keydown', escHandler);
      }
    });

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
      delete originalButton[BYPASS_FLAG];
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Button interception ---

  function interceptConnectButtons() {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (!isConnectButton(btn)) continue;
      btn.setAttribute(PROCESSED_ATTR, 'true');

      btn.addEventListener(
        'click',
        (e) => {
          if (btn[BYPASS_FLAG]) return;
          e.stopImmediatePropagation();
          e.preventDefault();
          showModal(btn);
        },
        true
      );
    }
  }

  // --- SPA navigation detection ---

  function onUrlChange() {
    const currentUrl = location.href;
    if (currentUrl === lastUrl) return;
    lastUrl = currentUrl;
    checkAndUpdateStatus();
    interceptConnectButtons();
  }

  // --- MutationObserver (debounced) ---

  function onDomMutation() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      onUrlChange();
      interceptConnectButtons();
      checkAndUpdateStatus();
    }, 300);
  }

  const observer = new MutationObserver(onDomMutation);
  observer.observe(document.body, { childList: true, subtree: true });

  // --- Initial run ---
  interceptConnectButtons();
  checkAndUpdateStatus();
})();
