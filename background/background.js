/**
 * Background Service Worker
 * Manages Google Apps Script webhook synchronization, badge updates, and persistent state.
 */

const DEFAULT_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwqHSwl3qRdpySNsUOs8WsTmd-UoMKakrTrvpm5UUkqdg5GeomincEShu7l3GDUk2PA/exec';
const SETTINGS_KEY = 'gmeet_attendance_settings';
const SESSIONS_KEY = 'gmeet_attendance_sessions';
const QUEUE_KEY = 'gmeet_offline_queue';

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SYNC_EVENT') {
    handleSyncEvent(message.payload)
      .then(res => sendResponse({ success: true, result: res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep sendResponse channel open for async
  }

  if (message.type === 'TEST_WEBHOOK') {
    testWebhook(message.url)
      .then(res => sendResponse({ success: true, result: res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'UPDATE_BADGE') {
    const count = message.count;
    if (count !== undefined) {
      chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#10B981' }); // Emerald Green
    }
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'GET_STATE') {
    chrome.storage.local.get([SETTINGS_KEY, SESSIONS_KEY], (items) => {
      sendResponse({
        settings: items[SETTINGS_KEY] || { webhookUrl: DEFAULT_WEBHOOK_URL, autoSync: true },
        sessions: items[SESSIONS_KEY] || {}
      });
    });
    return true;
  }
});

/**
 * Send attendance event to Google Apps Script Webhook
 */
async function handleSyncEvent(payload) {
  const data = await chrome.storage.local.get([SETTINGS_KEY, QUEUE_KEY]);
  const settings = data[SETTINGS_KEY] || {};
  const webhookUrl = settings.webhookUrl || DEFAULT_WEBHOOK_URL;

  if (!webhookUrl || !webhookUrl.startsWith('http')) {
    console.warn('[Attendance Background] Webhook URL not configured. Event stored locally.');
    await saveOfflineEvent(payload);
    return { status: 'offline_stored', message: 'Webhook URL not configured. Saved locally.' };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8' // text/plain avoids CORS preflight OPTIONS in Apps Script
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}`);
    }

    const json = await response.json().catch(() => ({ status: 'success' }));
    
    // Attempt to flush any pending offline events if this succeeded
    flushOfflineQueue(webhookUrl);

    return json;
  } catch (error) {
    console.error('[Attendance Background] Sync failed, queuing offline:', error);
    await saveOfflineEvent(payload);
    throw error;
  }
}

/**
 * Queue events offline if connection fails
 */
async function saveOfflineEvent(payload) {
  const data = await chrome.storage.local.get(QUEUE_KEY);
  const queue = data[QUEUE_KEY] || [];
  queue.push({
    payload,
    timestamp: Date.now()
  });
  if (queue.length > 200) queue.shift();
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

/**
 * Flush queued offline events
 */
async function flushOfflineQueue(webhookUrl) {
  const data = await chrome.storage.local.get(QUEUE_KEY);
  const queue = data[QUEUE_KEY] || [];
  if (queue.length === 0) return;

  const remaining = [];
  for (const item of queue) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(item.payload)
      });
    } catch (err) {
      remaining.push(item);
    }
  }
  await chrome.storage.local.set({ [QUEUE_KEY]: remaining });
}

/**
 * Test connectivity with Google Apps Script Web App
 */
async function testWebhook(url) {
  const targetUrl = url || DEFAULT_WEBHOOK_URL;
  if (!targetUrl || !targetUrl.startsWith('https://script.google.com/')) {
    throw new Error('Please enter a valid Google Apps Script Web App URL (starts with https://script.google.com/)');
  }

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'ping' })
  });

  if (!response.ok) {
    throw new Error(`HTTP status ${response.status}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { message: text || 'Connected successfully!' };
  }
}
