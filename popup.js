'use strict';

const STORAGE_KEY = 'linkedinConnections';

const contentEl = document.getElementById('content');
const statsEl = document.getElementById('stats');
const searchEl = document.getElementById('search');
const exportBtn = document.getElementById('export-btn');
const toastEl = document.getElementById('toast');

let allConnections = {};

function showToast(msg, duration = 2500) {
  toastEl.textContent = msg;
  toastEl.classList.add('visible');
  setTimeout(() => toastEl.classList.remove('visible'), duration);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function renderConnections(filter = '') {
  const entries = Object.entries(allConnections);
  const lowerFilter = filter.toLowerCase();

  const filtered = entries.filter(([url, data]) => {
    if (!filter) return true;
    return (
      data.name.toLowerCase().includes(lowerFilter) ||
      data.reason.toLowerCase().includes(lowerFilter)
    );
  });

  filtered.sort((a, b) => new Date(b[1].dateAdded) - new Date(a[1].dateAdded));

  const total = entries.length;
  const connected = entries.filter(([, d]) => d.connectionStatus === 'Connected').length;
  statsEl.textContent = `${connected} connected / ${total} total`;

  if (filtered.length === 0) {
    contentEl.innerHTML = `
      <div class="empty-state">
        <p>${filter ? 'No matches found.' : 'No connections tracked yet.'}</p>
        <p>${filter ? '' : 'Click "Connect" on a LinkedIn profile to get started.'}</p>
      </div>
    `;
    return;
  }

  let html = '<div class="connection-list">';
  for (const [url, data] of filtered) {
    const statusClass = data.connectionStatus === 'Connected' ? 'status-connected' : 'status-pending';
    const checked = data.taskCompleted ? 'checked' : '';
    html += `
      <div class="connection-item">
        <input type="checkbox" ${checked} data-url="${escapeHtml(url)}" title="Mark task completed">
        <div class="connection-info">
          <div class="name"><a href="${escapeHtml(url)}" target="_blank">${escapeHtml(data.name)}</a></div>
          <div class="reason">${escapeHtml(data.reason)}</div>
        </div>
        <div class="connection-meta">
          <span class="status ${statusClass}">${escapeHtml(data.connectionStatus)}</span>
          <span class="date">${formatDate(data.dateAdded)}</span>
        </div>
      </div>
    `;
  }
  html += '</div>';
  contentEl.innerHTML = html;

  contentEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const url = e.target.dataset.url;
      allConnections[url].taskCompleted = e.target.checked;
      chrome.storage.local.set({ [STORAGE_KEY]: allConnections });
    });
  });
}

function loadData() {
  chrome.storage.local.get(STORAGE_KEY, (result) => {
    allConnections = result[STORAGE_KEY] || {};
    renderConnections(searchEl.value);
  });
}

searchEl.addEventListener('input', () => {
  renderConnections(searchEl.value);
});

exportBtn.addEventListener('click', () => {
  const entries = Object.entries(allConnections);
  if (entries.length === 0) {
    showToast('Nothing to export.');
    return;
  }

  const headers = ['Profile URL', 'Name', 'Reason', 'Status', 'Task Completed', 'Date Added'];
  const rows = entries.map(([url, d]) => [
    csvEscape(url),
    csvEscape(d.name),
    csvEscape(d.reason),
    csvEscape(d.connectionStatus),
    d.taskCompleted ? 'Yes' : 'No',
    csvEscape(d.dateAdded || ''),
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');

  chrome.runtime.sendMessage({ action: 'exportCSV', csv }, (response) => {
    if (response && response.success) {
      showToast('CSV exported successfully!');
    } else {
      showToast('Export failed: ' + (response?.error || 'unknown error'));
    }
  });
});

function csvEscape(value) {
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

loadData();
