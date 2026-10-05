/**
 * Google Meet Attendance Tracker - Popup Logic
 */

const DEFAULT_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwqHSwl3qRdpySNsUOs8WsTmd-UoMKakrTrvpm5UUkqdg5GeomincEShu7l3GDUk2PA/exec';
const STORAGE_KEY_SETTINGS = 'gmeet_attendance_settings';
const STORAGE_KEY_SESSIONS = 'gmeet_attendance_sessions';

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements - Tabs
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabContents = document.querySelectorAll('.tab-content');

  // DOM Elements - Header
  const headerStatusDot = document.getElementById('header-status-dot');
  const meetingCodeBadge = document.getElementById('meeting-code-badge');
  const btnRefresh = document.getElementById('btn-refresh');

  // DOM Elements - Tab Live
  const liveActiveCount = document.getElementById('live-active-count');
  const liveTotalCount = document.getElementById('live-total-count');
  const liveMeetingDuration = document.getElementById('live-meeting-duration');
  const attendeesCountPill = document.getElementById('attendees-count-pill');
  const participantList = document.getElementById('participant-list');
  const btnExportCsv = document.getElementById('btn-export-csv');
  const btnSyncSheets = document.getElementById('btn-sync-sheets');

  // DOM Elements - Tab Sheets
  const webhookUrlInput = document.getElementById('webhook-url-input');
  const btnPasteWebhook = document.getElementById('btn-paste-webhook');
  const autoSyncToggle = document.getElementById('auto-sync-toggle');
  const btnTestWebhook = document.getElementById('btn-test-webhook');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const webhookStatusBanner = document.getElementById('webhook-status-banner');
  const btnCopyColumnsCsv = document.getElementById('btn-copy-columns-csv');

  // DOM Elements - Tab History
  const historyContainer = document.getElementById('history-container');
  const btnClearHistory = document.getElementById('btn-clear-history');

  // State
  let currentActiveMeetingCode = null;
  let cachedSessions = {};

  // Tab Switching
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      navTabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const targetContent = document.getElementById(`tab-${target}`);
      if (targetContent) targetContent.classList.add('active');

      if (target === 'history') {
        renderHistory();
      }
    });
  });

  // Load Settings
  chrome.storage.local.get([STORAGE_KEY_SETTINGS], (res) => {
    const settings = res[STORAGE_KEY_SETTINGS] || {};
    webhookUrlInput.value = settings.webhookUrl || DEFAULT_WEBHOOK_URL;
    if (settings.autoSync !== undefined) autoSyncToggle.checked = settings.autoSync;
    
    if (!settings.webhookUrl) {
      chrome.storage.local.set({
        [STORAGE_KEY_SETTINGS]: { webhookUrl: DEFAULT_WEBHOOK_URL, autoSync: true }
      });
    }
  });

  // Save Settings
  btnSaveSettings.addEventListener('click', () => {
    const webhookUrl = webhookUrlInput.value.trim() || DEFAULT_WEBHOOK_URL;
    const autoSync = autoSyncToggle.checked;

    chrome.storage.local.set({
      [STORAGE_KEY_SETTINGS]: { webhookUrl, autoSync }
    }, () => {
      showBanner(webhookStatusBanner, 'Settings saved & applied successfully!', 'success');
      setTimeout(() => {
        webhookStatusBanner.style.display = 'none';
      }, 3000);
    });
  });

  // Paste Webhook URL
  btnPasteWebhook.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        webhookUrlInput.value = text.trim();
      }
    } catch (e) {
      console.warn('Clipboard read failed:', e);
    }
  });

  // Test Webhook Connection
  btnTestWebhook.addEventListener('click', () => {
    const url = webhookUrlInput.value.trim() || DEFAULT_WEBHOOK_URL;
    showBanner(webhookStatusBanner, 'Testing connection with Google Sheets...', 'success');

    chrome.runtime.sendMessage({
      type: 'TEST_WEBHOOK',
      url: url
    }, (res) => {
      if (chrome.runtime.lastError) {
        showBanner(webhookStatusBanner, chrome.runtime.lastError.message, 'error');
      } else if (res && res.success) {
        const msg = (res.result && res.result.message) ? res.result.message : 'Connected successfully to Google Sheet!';
        showBanner(webhookStatusBanner, `🟢 ${msg}`, 'success');
      } else {
        const err = (res && res.error) ? res.error : 'Connection failed.';
        showBanner(webhookStatusBanner, `⚠️ ${err}`, 'error');
      }
    });
  });

  // Copy Column Headers CSV
  btnCopyColumnsCsv.addEventListener('click', () => {
    const headers = [
      'Participant Name',
      'Meeting Code',
      'Meeting Title',
      'Date',
      'First Joined Time',
      'Last Left Time',
      'Total Time (Minutes)',
      'Total Time (HH:MM:SS)',
      'Join Count',
      'Current Status'
    ].join(',');

    navigator.clipboard.writeText(headers).then(() => {
      const orig = btnCopyColumnsCsv.innerHTML;
      btnCopyColumnsCsv.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
        Copied to Clipboard!
      `;
      setTimeout(() => {
        btnCopyColumnsCsv.innerHTML = orig;
      }, 2000);
    });
  });

  // Refresh
  btnRefresh.addEventListener('click', loadState);

  // Export CSV
  btnExportCsv.addEventListener('click', () => {
    if (!currentActiveMeetingCode || !cachedSessions[currentActiveMeetingCode]) {
      alert('No active meeting attendance to export.');
      return;
    }
    exportSessionCsv(cachedSessions[currentActiveMeetingCode]);
  });

  // Sync to sheets button
  btnSyncSheets.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url && tabs[0].url.includes('meet.google.com/')) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_FORCE_SYNC' }, (res) => {
          btnSyncSheets.textContent = 'Synced!';
          setTimeout(() => {
            btnSyncSheets.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
              Sync to Sheets
            `;
          }, 2000);
        });
      } else {
        alert('Please open the active Google Meet tab to trigger sync.');
      }
    });
  });

  // Clear History
  btnClearHistory.addEventListener('click', () => {
    if (confirm('Clear all saved meeting history?')) {
      chrome.storage.local.remove([STORAGE_KEY_SESSIONS], () => {
        cachedSessions = {};
        renderHistory();
      });
    }
  });

  function loadState() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      const isMeet = activeTab && activeTab.url && activeTab.url.includes('meet.google.com/');

      if (isMeet) {
        const url = new URL(activeTab.url);
        const code = url.pathname.replace(/^\/|\/$/g, '');
        if (code && code.length >= 7) {
          currentActiveMeetingCode = code;
          meetingCodeBadge.textContent = code;
          headerStatusDot.classList.add('active');
        } else {
          meetingCodeBadge.textContent = 'Meet Lobby';
        }
      } else {
        meetingCodeBadge.textContent = 'No active meet';
        headerStatusDot.classList.remove('active');
      }

      chrome.storage.local.get([STORAGE_KEY_SESSIONS], (res) => {
        cachedSessions = res[STORAGE_KEY_SESSIONS] || {};

        if (currentActiveMeetingCode && cachedSessions[currentActiveMeetingCode]) {
          renderCurrentSession(cachedSessions[currentActiveMeetingCode]);
        } else {
          const codes = Object.keys(cachedSessions);
          if (codes.length > 0) {
            const lastSession = cachedSessions[codes[codes.length - 1]];
            renderCurrentSession(lastSession, true);
          } else {
            renderEmptyLiveState();
          }
        }
      });
    });
  }

  function renderCurrentSession(session, isPast = false) {
    const attendees = session.attendees || [];
    let inCount = 0;
    attendees.forEach(a => { if (a.status === 'IN') inCount++; });

    liveActiveCount.textContent = isPast ? '0' : String(inCount);
    liveTotalCount.textContent = String(attendees.length);
    attendeesCountPill.textContent = `${attendees.length} participants`;

    if (isPast) {
      meetingCodeBadge.textContent = `${session.code} (Saved)`;
    }

    if (attendees.length === 0) {
      renderEmptyLiveState();
      return;
    }

    let html = '';
    attendees.forEach(att => {
      const isIn = !isPast && att.status === 'IN';
      const initial = att.name.charAt(0).toUpperCase();

      html += `
        <div class="user-row">
          <div class="user-left">
            <div class="avatar-badge" style="background: ${getAvatarColor(att.name)}">${initial}</div>
            <div class="user-meta">
              <span class="user-name" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
              <span class="user-subtext">In: ${att.firstJoined} ${att.lastLeft !== '-' ? `• Out: ${att.lastLeft}` : ''}</span>
            </div>
          </div>
          <div class="user-right">
            <span class="status-chip ${isIn ? 'in' : 'out'}">${isIn ? 'IN CALL' : 'LEFT'}</span>
            <span class="user-time">${att.totalDurationStr || `${att.totalMinutes}m`}</span>
          </div>
        </div>
      `;
    });

    participantList.innerHTML = html;
  }

  function renderEmptyLiveState() {
    liveActiveCount.textContent = '0';
    liveTotalCount.textContent = '0';
    attendeesCountPill.textContent = '0 participants';
    participantList.innerHTML = `
      <div class="empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 6v6l4 2"></path>
        </svg>
        <p>No meeting in progress</p>
        <small>Open Google Meet (meet.google.com) to automatically track attendance.</small>
      </div>
    `;
  }

  function renderHistory() {
    chrome.storage.local.get([STORAGE_KEY_SESSIONS], (res) => {
      const sessions = res[STORAGE_KEY_SESSIONS] || {};
      const codes = Object.keys(sessions);

      if (codes.length === 0) {
        historyContainer.innerHTML = `
          <div class="empty-state">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="1.5">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <p>No meeting history yet</p>
            <small>Completed Google Meet sessions will appear here.</small>
          </div>
        `;
        return;
      }

      let html = '';
      codes.reverse().forEach(code => {
        const item = sessions[code];
        const count = item.attendees ? item.attendees.length : 0;

        html += `
          <div class="history-card">
            <div class="history-card-header">
              <span class="history-title">${escapeHtml(item.title || item.code)}</span>
              <span class="history-date">${item.date || ''}</span>
            </div>
            <div class="history-details">
              <span>Code: <code>${escapeHtml(item.code)}</code></span>
              <span>${count} Attendees</span>
            </div>
            <div class="history-actions">
              <button class="btn btn-secondary full-width btn-history-download" data-code="${escapeHtml(item.code)}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Download CSV
              </button>
            </div>
          </div>
        `;
      });

      historyContainer.innerHTML = html;

      document.querySelectorAll('.btn-history-download').forEach(btn => {
        btn.addEventListener('click', () => {
          const code = btn.dataset.code;
          if (sessions[code]) exportSessionCsv(sessions[code]);
        });
      });
    });
  }

  function exportSessionCsv(session) {
    const attendees = session.attendees || [];
    const headers = [
      'Participant Name',
      'Meeting Code',
      'Date',
      'First Joined Time',
      'Last Left Time',
      'Total Time (Minutes)',
      'Total Time (HH:MM:SS)',
      'Join Count',
      'Current Status'
    ];

    const rows = [headers.join(',')];

    attendees.forEach(att => {
      rows.push([
        `"${att.name.replace(/"/g, '""')}"`,
        `"${session.code}"`,
        `"${session.date || ''}"`,
        `"${att.firstJoined}"`,
        `"${att.lastLeft}"`,
        `"${att.totalMinutes}"`,
        `"${att.totalDurationStr}"`,
        `"${att.joinCount || 1}"`,
        `"${att.status === 'IN' ? 'In Call' : 'Left'}"`
      ].join(','));
    });

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(rows.join('\n'));
    const link = document.createElement('a');
    link.setAttribute('href', csvContent);
    link.setAttribute('download', `Attendance_${session.code}_${session.date || 'Export'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function showBanner(bannerEl, msg, type) {
    bannerEl.textContent = msg;
    bannerEl.className = `status-banner ${type}`;
    bannerEl.style.display = 'block';
  }

  function getAvatarColor(str) {
    const colors = ['#3B82F6', '#10B981', '#8B5CF6', '#EC4899', '#F59E0B', '#06B6D4', '#6366F1'];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  loadState();
  setInterval(loadState, 2000);
});
