/**
 * Google Meet Attendance & IN/OUT Tracker - Content Script (v1.1.0)
 * Real-time participant tracking with fast detection, email extraction, and automated Google Sheets sync.
 */

(() => {
  // Configuration
  const DEFAULT_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwqHSwl3qRdpySNsUOs8WsTmd-UoMKakrTrvpm5UUkqdg5GeomincEShu7l3GDUk2PA/exec';
  const SCAN_INTERVAL_MS = 1500;       // Scan every 1.5 seconds for instant responsiveness
  const GRACE_CYCLES = 2;              // 2 cycles (~3s) before marking LEFT
  const STORAGE_KEY_SESSIONS = 'gmeet_attendance_sessions';
  const STORAGE_KEY_SETTINGS = 'gmeet_attendance_settings';

  // State
  let meetingCode = getMeetingCode();
  let meetingTitle = getCleanTitle();
  let attendees = new Map(); // key: normalized name, value: attendee object
  let isMeetingActive = false;
  let scanTimer = null;
  let clockTimer = null;
  let meetingStartTime = null;
  let settings = { webhookUrl: DEFAULT_WEBHOOK_URL, autoSync: true };

  // Load Settings immediately & listen for changes
  chrome.storage.local.get([STORAGE_KEY_SETTINGS], (res) => {
    if (res[STORAGE_KEY_SETTINGS] && res[STORAGE_KEY_SETTINGS].webhookUrl) {
      settings = Object.assign(settings, res[STORAGE_KEY_SETTINGS]);
    } else {
      // Save default
      chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: settings });
    }
    updateWidgetStatus();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY_SETTINGS]) {
      settings = Object.assign(settings, changes[STORAGE_KEY_SETTINGS].newValue);
      updateWidgetStatus();
    }
  });

  // Listen for manual sync requests from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'TRIGGER_FORCE_SYNC') {
      syncAllToSheets();
      sendResponse({ success: true });
    }
  });

  function init() {
    if (!meetingCode) return;

    createFloatingWidget();
    checkMeetingStatus();

    // Check meeting status every 1.5 seconds
    setInterval(checkMeetingStatus, 1500);
  }

  function getMeetingCode() {
    const path = window.location.pathname.replace(/^\/|\/$/g, '');
    if (/^[a-z0-9\-]+$/i.test(path) && path.length >= 7) {
      return path;
    }
    return null;
  }

  function getCleanTitle() {
    const titleEl = document.querySelector('[data-meeting-title]');
    if (titleEl && titleEl.textContent.trim()) {
      return titleEl.textContent.trim();
    }
    return document.title.replace(' - Google Meet', '').trim() || (meetingCode || 'Meet Call');
  }

  function isInCall() {
    // Indicators of being inside active call
    const leaveBtn = document.querySelector('button[aria-label*="Leave call" i], button[aria-label*="Leave" i], button[data-call-ended]');
    const micBtn = document.querySelector('button[aria-label*="turn off microphone" i], button[aria-label*="turn on microphone" i]');
    const bottomBar = document.querySelector('[data-is-muted], [role="region"][aria-label*="call controls" i]');
    return !!(leaveBtn || (micBtn && bottomBar));
  }

  function checkMeetingStatus() {
    const currentlyInCall = isInCall();

    if (currentlyInCall && !isMeetingActive) {
      isMeetingActive = true;
      meetingStartTime = new Date();
      meetingCode = getMeetingCode() || window.location.pathname.replace(/^\/|\/$/g, '');
      meetingTitle = getCleanTitle();

      console.log(`[Meet Attendance] Call started: ${meetingCode}`);
      startTracking();
      updateWidgetHeader();
      
      // Auto-ensure People panel is accessible
      autoEnsurePeoplePanel();
    } else if (!currentlyInCall && isMeetingActive) {
      isMeetingActive = false;
      console.log('[Meet Attendance] Call ended.');
      stopTracking();
    }
  }

  function startTracking() {
    if (scanTimer) clearInterval(scanTimer);
    if (clockTimer) clearInterval(clockTimer);

    scanParticipants();
    scanTimer = setInterval(scanParticipants, SCAN_INTERVAL_MS);
    clockTimer = setInterval(updateLiveTimers, 1000);
  }

  function stopTracking() {
    if (scanTimer) clearInterval(scanTimer);
    if (clockTimer) clearInterval(clockTimer);

    const now = new Date();
    attendees.forEach((att) => {
      if (att.status === 'IN') {
        finalizeLeft(att, now);
      }
    });

    saveSessionData();
    updateUI();
  }

  /**
   * Auto-open or ensure People panel so Google Meet renders the 100% accurate participant list
   */
  function autoEnsurePeoplePanel() {
    setTimeout(() => {
      const isPeopleOpen = document.querySelector('div[role="tabpanel"] div[role="listitem"], [aria-label="People"] div[role="listitem"]');
      if (!isPeopleOpen) {
        const peopleBtn = document.querySelector('button[aria-label*="everyone" i], button[aria-label*="people" i], button[data-panel-id="1"]');
        if (peopleBtn) {
          console.log('[Meet Attendance] Auto-opening People panel for accurate attendance scanning.');
          peopleBtn.click();
        }
      }
    }, 2000);
  }

  /**
   * Read the official participant counter displayed in Google Meet's bottom bar
   * e.g., "Show everyone (2)" -> 2
   */
  function getOfficialMeetParticipantCount() {
    const peopleBtn = document.querySelector('button[aria-label*="everyone" i], button[aria-label*="people" i], button[data-panel-id="1"]');
    if (!peopleBtn) return null;

    const aria = peopleBtn.getAttribute('aria-label') || '';
    const match = aria.match(/(\d+)/);
    if (match) return parseInt(match[1], 10);

    const text = peopleBtn.textContent || '';
    const match2 = text.match(/(\d+)/);
    if (match2) return parseInt(match2[1], 10);

    return null;
  }

  /**
   * Scrapes currently connected participants AND attempts to capture their Email ID
   */
  function scrapeCurrentParticipants() {
    const map = new Map(); // key: normalized name, value: { name, email }

    // Helper: is element physically visible?
    function isVisible(el) {
      if (!el) return false;
      return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    // Helper: extract email from element or its children
    function extractEmail(container) {
      if (!container) return '-';
      // 1. Check data-hovercard-id or data-email
      const hovercard = container.getAttribute('data-hovercard-id') || container.querySelector('[data-hovercard-id]')?.getAttribute('data-hovercard-id');
      if (hovercard && hovercard.includes('@')) return hovercard.trim();

      const dataEmail = container.getAttribute('data-email') || container.querySelector('[data-email]')?.getAttribute('data-email');
      if (dataEmail && dataEmail.includes('@')) return dataEmail.trim();

      // 2. Check mailto link
      const mailto = container.querySelector('a[href^="mailto:"]');
      if (mailto) {
        return mailto.href.replace('mailto:', '').split('?')[0].trim();
      }

      // 3. Check title / aria-label containing @
      const allWithAt = container.querySelectorAll('[title*="@"], [aria-label*="@"]');
      for (const el of allWithAt) {
        const val = el.getAttribute('title') || el.getAttribute('aria-label') || '';
        const match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (match) return match[0];
      }

      // 4. Check text content of subtitle spans
      const spans = container.querySelectorAll('span');
      for (const sp of spans) {
        const txt = sp.textContent.trim();
        const match = txt.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/);
        if (match) return match[0];
      }

      return '-';
    }

    // Strategy 1: The People Tab List (100% official when open)
    const peopleItems = document.querySelectorAll('div[role="tabpanel"] div[role="listitem"], [aria-label="People"] div[role="listitem"], [aria-label="Participants"] div[role="listitem"]');
    peopleItems.forEach((item) => {
      if (!isVisible(item)) return;

      const spans = item.querySelectorAll('span');
      let name = '';
      for (const span of spans) {
        const txt = span.textContent.trim();
        if (txt && !txt.includes('(') && !txt.includes(')') && txt.length > 1 && txt.length < 50) {
          if (!['Pin', 'Mute', 'Remove', 'Add', 'People', 'Chat', 'Meeting host', 'Host'].includes(txt)) {
            name = txt;
            break;
          }
        }
      }

      if (name && name !== 'You') {
        const email = extractEmail(item);
        const norm = normalizeName(name);
        if (norm) {
          map.set(norm, { name, email });
        }
      }
    });

    // Strategy 2: If People tab is closed, check active visible video tiles
    if (map.size === 0) {
      // Find visible video cards
      const tileSpans = document.querySelectorAll('div[data-self-name], [data-requested-participant-id], div[data-participant-id]');
      tileSpans.forEach(el => {
        if (!isVisible(el)) return;

        // Ensure this is not an announcement toast / notification
        if (el.closest('[role="region"][aria-live], [aria-live="polite"], [role="alert"]')) return;

        let name = el.getAttribute('data-self-name') || '';
        if (!name) {
          // Look for participant name span inside visible tile
          const nameSpan = el.querySelector('span[dir="auto"], span.zWGUib');
          if (nameSpan && isVisible(nameSpan)) {
            name = nameSpan.textContent.trim();
          }
        }

        if (name) {
          name = name.replace(/\s*\(You\)\s*/i, '').trim();
          if (name && name !== 'You' && name.length > 1 && !name.includes('\n') && !name.toLowerCase().includes('left the meeting')) {
            const norm = normalizeName(name);
            if (norm && !map.has(norm)) {
              map.set(norm, { name, email: extractEmail(el) });
            }
          }
        }
      });
    }

    // Strategy 3: Check Self / Host Name
    const myNameEl = document.querySelector('[data-self-name]');
    if (myNameEl) {
      const myName = myNameEl.getAttribute('data-self-name')?.replace(/\s*\(You\)\s*/i, '').trim();
      if (myName && myName !== 'You') {
        const norm = normalizeName(myName);
        if (norm && !map.has(norm)) {
          // Attempt to get self email from profile button
          const selfEmailEl = document.querySelector('a[aria-label*="@"], [data-email]');
          const selfEmail = selfEmailEl?.getAttribute('data-email') || 
            (selfEmailEl?.getAttribute('aria-label')?.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) ? selfEmailEl.getAttribute('aria-label').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)[0] : '-');
          map.set(norm, { name: myName, email: selfEmail || '-' });
        }
      }
    }

    return map;
  }

  /**
   * Main scan routine: executes every 1.5s
   */
  function scanParticipants() {
    if (!isMeetingActive) return;

    const currentMap = scrapeCurrentParticipants();
    const now = new Date();
    const nowMs = now.getTime();
    const officialCount = getOfficialMeetParticipantCount();

    // 1. Process Active Participants (JOINED or REJOINED)
    currentMap.forEach((info, norm) => {
      if (!attendees.has(norm)) {
        // === FIRST TIME JOINED ===
        const newAttendee = {
          name: info.name,
          email: info.email || '-',
          firstJoined: now,
          firstJoinedTimeStr: formatTime(now),
          lastLeftTimeStr: '-',
          status: 'IN',
          currentSessionStart: nowMs,
          totalDurationMs: 0,
          joinCount: 1,
          missedCycles: 0,
          lastSeenMs: nowMs
        };
        attendees.set(norm, newAttendee);

        console.log(`[Meet Attendance] JOINED: ${info.name} (${newAttendee.email}) at ${newAttendee.firstJoinedTimeStr}`);
        dispatchAttendanceEvent('JOINED', newAttendee);
      } else {
        const att = attendees.get(norm);
        att.lastSeenMs = nowMs;
        att.missedCycles = 0;
        if (info.email && info.email !== '-' && (!att.email || att.email === '-')) {
          att.email = info.email;
        }

        if (att.status === 'OUT') {
          // === REJOINED ===
          att.status = 'IN';
          att.joinCount += 1;
          att.currentSessionStart = nowMs;
          console.log(`[Meet Attendance] REJOINED: ${att.name} (Count: ${att.joinCount})`);
          dispatchAttendanceEvent('JOINED', att);
        }
      }
    });

    // 2. Process Missing Participants (Check for LEFT)
    attendees.forEach((att, norm) => {
      if (!currentMap.has(norm)) {
        if (att.status === 'IN') {
          att.missedCycles = (att.missedCycles || 0) + 1;

          // If official meet counter dropped, immediately trigger leave on first missed cycle
          let threshold = GRACE_CYCLES;
          let currentlyInCount = 0;
          attendees.forEach(a => { if (a.status === 'IN') currentlyInCount++; });

          if (officialCount !== null && officialCount < currentlyInCount) {
            threshold = 1; // Instant leave detection!
          }

          if (att.missedCycles >= threshold) {
            finalizeLeft(att, now);
          }
        }
      }
    });

    // Update Badge & UI
    updateBadge();
    updateUI();
    saveSessionData();
  }

  function finalizeLeft(att, dateObj) {
    att.status = 'OUT';
    att.lastLeftTimeStr = formatTime(dateObj);
    const sessionDurationMs = Math.max(0, dateObj.getTime() - (att.currentSessionStart || dateObj.getTime()));
    att.totalDurationMs += sessionDurationMs;
    att.currentSessionStart = null;

    console.log(`[Meet Attendance] LEFT: ${att.name} | Stayed: ${formatDuration(sessionDurationMs)} | Total: ${formatDuration(att.totalDurationMs)}`);
    dispatchAttendanceEvent('LEFT', att, sessionDurationMs);
  }

  function dispatchAttendanceEvent(eventType, attendee, sessionDurationMs = 0) {
    const now = new Date();
    const currentTotalMs = attendee.totalDurationMs + (attendee.status === 'IN' && attendee.currentSessionStart ? (now.getTime() - attendee.currentSessionStart) : 0);

    const payload = {
      meetingCode: meetingCode || 'Meet',
      meetingTitle: meetingTitle || meetingCode,
      name: attendee.name,
      email: attendee.email || '-',
      event: eventType,
      eventTime: formatDateTime(now),
      date: formatDate(now),
      sessionDuration: formatDuration(sessionDurationMs),
      totalDurationStr: formatDuration(currentTotalMs),
      totalMinutes: (currentTotalMs / 60000).toFixed(1),
      firstJoinedTime: attendee.firstJoinedTimeStr,
      lastLeftTime: attendee.lastLeftTimeStr,
      joinCount: attendee.joinCount,
      remarks: eventType === 'JOINED' 
        ? (attendee.joinCount > 1 ? `Rejoined (Session #${attendee.joinCount})` : 'First Joined')
        : `Left meeting after ${formatDuration(sessionDurationMs)}`
    };

    chrome.runtime.sendMessage({
      type: 'SYNC_EVENT',
      payload: payload
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Meet Attendance] Background sync error:', chrome.runtime.lastError);
      } else {
        showSyncIndicator(response && response.success);
      }
    });
  }

  function saveSessionData() {
    if (!meetingCode) return;
    const now = new Date();
    const records = [];

    attendees.forEach(att => {
      const currentTotalMs = att.totalDurationMs + (att.status === 'IN' && att.currentSessionStart ? (now.getTime() - att.currentSessionStart) : 0);
      records.push({
        name: att.name,
        email: att.email || '-',
        firstJoined: att.firstJoinedTimeStr,
        lastLeft: att.lastLeftTimeStr,
        status: att.status,
        joinCount: att.joinCount,
        totalMinutes: (currentTotalMs / 60000).toFixed(1),
        totalDurationStr: formatDuration(currentTotalMs)
      });
    });

    chrome.storage.local.get([STORAGE_KEY_SESSIONS], (res) => {
      const allSessions = res[STORAGE_KEY_SESSIONS] || {};
      allSessions[meetingCode] = {
        code: meetingCode,
        title: meetingTitle,
        date: formatDate(now),
        startTime: meetingStartTime ? formatTime(meetingStartTime) : formatTime(now),
        attendees: records,
        lastUpdated: now.toISOString()
      };
      chrome.storage.local.set({ [STORAGE_KEY_SESSIONS]: allSessions });
    });
  }

  function updateBadge() {
    let activeCount = 0;
    attendees.forEach(att => {
      if (att.status === 'IN') activeCount++;
    });

    chrome.runtime.sendMessage({
      type: 'UPDATE_BADGE',
      count: activeCount
    });
  }

  /**
   * In-Meeting Floating Widget
   */
  function createFloatingWidget() {
    if (document.getElementById('gmat-floating-widget')) return;

    const widget = document.createElement('div');
    widget.id = 'gmat-floating-widget';
    widget.innerHTML = `
      <div class="gmat-pill" id="gmat-pill-btn" title="Click to open Live Attendance Tracker">
        <span class="gmat-indicator-dot" id="gmat-dot"></span>
        <span class="gmat-pill-label">Attendance</span>
        <span class="gmat-count-badge" id="gmat-pill-count">0</span>
      </div>

      <div class="gmat-panel" id="gmat-panel">
        <div class="gmat-panel-header">
          <div class="gmat-panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="8.5" cy="7" r="4"></circle>
              <polyline points="17 11 19 13 23 9"></polyline>
            </svg>
            <span id="gmat-header-title">Live Attendance</span>
          </div>
          <div class="gmat-panel-actions">
            <button class="gmat-btn-icon" id="gmat-btn-open-people" title="Toggle Google Meet People list (Ensures 100% accurate participant tracking)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            </button>
            <button class="gmat-btn-icon" id="gmat-btn-close-panel" title="Close Panel">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>

        <div class="gmat-metrics">
          <div class="gmat-metric-card">
            <div class="gmat-metric-val" id="gmat-metric-present">0</div>
            <div class="gmat-metric-lbl">In Call</div>
          </div>
          <div class="gmat-metric-card">
            <div class="gmat-metric-val" id="gmat-metric-total">0</div>
            <div class="gmat-metric-lbl">Total Logged</div>
          </div>
          <div class="gmat-metric-card">
            <div class="gmat-metric-val" id="gmat-metric-time">00:00</div>
            <div class="gmat-metric-lbl">Duration</div>
          </div>
        </div>

        <div class="gmat-sheet-status" id="gmat-sheet-status-bar">
          <span id="gmat-sheet-status-text">🟢 Google Sheet Connected & Auto-syncing</span>
        </div>

        <div class="gmat-list-container" id="gmat-attendee-list">
          <div style="text-align: center; padding: 24px 10px; color: #94A3B8; font-size: 12px;">
            Waiting for participants to join...
          </div>
        </div>

        <div class="gmat-panel-footer">
          <button class="gmat-btn gmat-btn-primary" id="gmat-btn-export-csv" title="Download attendance report as CSV">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Export CSV
          </button>
          <button class="gmat-btn gmat-btn-secondary" id="gmat-btn-sync-all" title="Push full attendance snapshot to Google Sheets now">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            Sync Sheets
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(widget);

    document.getElementById('gmat-pill-btn').addEventListener('click', () => {
      document.getElementById('gmat-panel').classList.toggle('open');
      updateUI();
    });

    document.getElementById('gmat-btn-close-panel').addEventListener('click', () => {
      document.getElementById('gmat-panel').classList.remove('open');
    });

    document.getElementById('gmat-btn-export-csv').addEventListener('click', exportAttendanceCSV);
    document.getElementById('gmat-btn-sync-all').addEventListener('click', syncAllToSheets);
    document.getElementById('gmat-btn-open-people').addEventListener('click', toggleGoogleMeetPeoplePanel);

    updateWidgetStatus();
  }

  function toggleGoogleMeetPeoplePanel() {
    const btn = document.querySelector('button[aria-label*="everyone" i], button[aria-label*="people" i], button[data-panel-id="1"]');
    if (btn) {
      btn.click();
    } else {
      alert('Google Meet People button not found in bottom bar.');
    }
  }

  function updateWidgetStatus() {
    const bar = document.getElementById('gmat-sheet-status-bar');
    const text = document.getElementById('gmat-sheet-status-text');
    if (!bar || !text) return;

    const url = settings.webhookUrl || DEFAULT_WEBHOOK_URL;

    if (url && url.startsWith('https://script.google.com/')) {
      bar.classList.remove('warning');
      text.textContent = '🟢 Google Sheet Connected & Auto-syncing';
    } else {
      bar.classList.add('warning');
      text.textContent = '⚠️ Google Sheet URL not set (Click extension icon to set)';
    }
  }

  function showSyncIndicator(success) {
    const dot = document.getElementById('gmat-dot');
    if (!dot) return;
    dot.style.backgroundColor = success ? '#38BDF8' : '#F59E0B';
    setTimeout(() => {
      dot.style.backgroundColor = '#10B981';
    }, 1500);
  }

  function updateWidgetHeader() {
    const headerTitle = document.getElementById('gmat-header-title');
    if (headerTitle && meetingCode) {
      headerTitle.textContent = meetingTitle || meetingCode;
    }
  }

  function updateLiveTimers() {
    if (!isMeetingActive) return;

    if (meetingStartTime) {
      const elapsedSec = Math.floor((Date.now() - meetingStartTime.getTime()) / 1000);
      const metricTime = document.getElementById('gmat-metric-time');
      if (metricTime) {
        metricTime.textContent = formatDurationSec(elapsedSec);
      }
    }

    const panel = document.getElementById('gmat-panel');
    if (panel && panel.classList.contains('open')) {
      const now = Date.now();
      attendees.forEach((att, norm) => {
        if (att.status === 'IN' && att.currentSessionStart) {
          const el = document.getElementById(`gmat-dur-${norm}`);
          if (el) {
            const currentTotalMs = att.totalDurationMs + (now - att.currentSessionStart);
            el.textContent = formatDuration(currentTotalMs);
          }
        }
      });
    }
  }

  function updateUI() {
    let presentCount = 0;
    const totalCount = attendees.size;

    attendees.forEach(att => {
      if (att.status === 'IN') presentCount++;
    });

    const pillCount = document.getElementById('gmat-pill-count');
    const metricPresent = document.getElementById('gmat-metric-present');
    const metricTotal = document.getElementById('gmat-metric-total');

    if (pillCount) pillCount.textContent = String(presentCount);
    if (metricPresent) metricPresent.textContent = String(presentCount);
    if (metricTotal) metricTotal.textContent = String(totalCount);

    const listContainer = document.getElementById('gmat-attendee-list');
    if (!listContainer) return;

    if (totalCount === 0) {
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 24px 10px; color: #94A3B8; font-size: 12px;">
          Waiting for participants to join...
        </div>
      `;
      return;
    }

    const sorted = Array.from(attendees.entries()).sort((a, b) => {
      if (a[1].status !== b[1].status) {
        return a[1].status === 'IN' ? -1 : 1;
      }
      return a[1].name.localeCompare(b[1].name);
    });

    const now = Date.now();
    let html = '';
    sorted.forEach(([norm, att]) => {
      const isIn = att.status === 'IN';
      const initial = att.name.charAt(0).toUpperCase() || '?';
      const currentTotalMs = att.totalDurationMs + (isIn && att.currentSessionStart ? (now - att.currentSessionStart) : 0);
      const durationStr = formatDuration(currentTotalMs);
      const emailDisplay = (att.email && att.email !== '-') ? `<div style="font-size: 9px; color: #38BDF8;">${escapeHtml(att.email)}</div>` : '';

      html += `
        <div class="gmat-user-item">
          <div class="gmat-user-left">
            <div class="gmat-avatar-circle" style="background: ${getAvatarColor(att.name)}">${initial}</div>
            <div class="gmat-user-details">
              <span class="gmat-user-name" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
              ${emailDisplay}
              <span class="gmat-user-times">In: ${att.firstJoinedTimeStr}${att.status === 'OUT' ? ` • Out: ${att.lastLeftTimeStr}` : ''}</span>
            </div>
          </div>
          <div class="gmat-user-right">
            <span class="gmat-badge-status ${isIn ? 'gmat-status-in' : 'gmat-status-out'}">
              ${isIn ? 'IN CALL' : 'LEFT'}
            </span>
            <span class="gmat-duration" id="gmat-dur-${norm}">${durationStr}</span>
          </div>
        </div>
      `;
    });

    listContainer.innerHTML = html;
  }

  function syncAllToSheets() {
    if (attendees.size === 0) {
      alert('No attendees logged yet.');
      return;
    }
    const syncBtn = document.getElementById('gmat-btn-sync-all');
    if (syncBtn) syncBtn.textContent = 'Syncing...';

    attendees.forEach(att => {
      dispatchAttendanceEvent('BATCH_SYNC', att);
    });

    setTimeout(() => {
      if (syncBtn) {
        syncBtn.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
          Synced!
        `;
        setTimeout(() => {
          syncBtn.innerHTML = `
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            Sync Sheets
          `;
        }, 2000);
      }
    }, 1000);
  }

  function exportAttendanceCSV() {
    if (attendees.size === 0) {
      alert('No attendees recorded yet.');
      return;
    }

    const now = new Date();
    const headers = [
      'Participant Name',
      'Participant Email',
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
      const currentTotalMs = att.totalDurationMs + (att.status === 'IN' && att.currentSessionStart ? (now.getTime() - att.currentSessionStart) : 0);
      const totalMinutes = (currentTotalMs / 60000).toFixed(1);
      const totalStr = formatDuration(currentTotalMs);

      const row = [
        `"${att.name.replace(/"/g, '""')}"`,
        `"${(att.email || '-').replace(/"/g, '""')}"`,
        `"${meetingCode}"`,
        `"${formatDate(now)}"`,
        `"${att.firstJoinedTimeStr}"`,
        `"${att.lastLeftTimeStr}"`,
        `"${totalMinutes}"`,
        `"${totalStr}"`,
        `"${att.joinCount}"`,
        `"${att.status === 'IN' ? 'In Call' : 'Left'}"`
      ];
      rows.push(row.join(','));
    });

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(rows.join('\n'));
    const link = document.createElement('a');
    link.setAttribute('href', csvContent);
    link.setAttribute('download', `Meet_Attendance_${meetingCode}_${formatDate(now)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // --- Helper Functions ---
  function normalizeName(name) {
    if (!name) return '';
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function formatTime(d) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  }

  function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatDateTime(d) {
    return `${formatDate(d)} ${formatTime(d)}`;
  }

  function formatDuration(ms) {
    return formatDurationSec(Math.floor(ms / 1000));
  }

  function formatDurationSec(totalSec) {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return [
      String(hrs).padStart(2, '0'),
      String(mins).padStart(2, '0'),
      String(secs).padStart(2, '0')
    ].join(':');
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

  window.addEventListener('beforeunload', () => {
    if (isMeetingActive) {
      stopTracking();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
