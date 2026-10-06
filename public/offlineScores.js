/**
 * ScoreSync — Offline Score Entry
 * - Auto switches to offline mode when no internet detected
 * - Manual toggle button to force offline mode anytime
 * - Saves scores to IndexedDB, auto-syncs when back online
 */

const DB_NAME    = 'scoresync-offline';
const DB_VERSION = 1;
const STORE      = 'pending-scores';
const MANUAL_KEY = 'ss_offline_manual'; // localStorage key for manual toggle

// ── State ─────────────────────────────────────────────────────────────────────
let isOfflineMode = false;

function getOfflineMode() {
  // Offline if: no network signal OR manually forced offline
  const manual = localStorage.getItem(MANUAL_KEY) === '1';
  return !navigator.onLine || manual;
}

function setManualOffline(val) {
  if (val) {
    localStorage.setItem(MANUAL_KEY, '1');
  } else {
    localStorage.removeItem(MANUAL_KEY);
  }
  isOfflineMode = getOfflineMode();
  updateToggleButton();
  if (!isOfflineMode && navigator.onLine) syncPending();
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function savePending(url, formData) {
  const db = await openDB();
  const scores = {};
  for (const [k, v] of formData.entries()) {
    if (k !== '_csrf') scores[k] = v;
  }
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add({ url, scores, savedAt: Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror   = e  => reject(e.target.error);
  });
}

async function getPending() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = e  => reject(e.target.error);
  });
}

async function deletePending(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = e  => reject(e.target.error);
  });
}

async function countPending() {
  return (await getPending()).length;
}

// ── Banner ────────────────────────────────────────────────────────────────────
function showBanner(msg, type = 'info', persist = false) {
  let banner = document.getElementById('offline-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.style.cssText = `
      position:fixed;bottom:76px;left:50%;transform:translateX(-50%);
      z-index:9999;padding:10px 20px;border-radius:12px;font-size:13px;
      font-weight:700;text-align:center;max-width:92vw;min-width:220px;
      box-shadow:0 4px 24px rgba(0,0,0,0.55);transition:opacity 0.3s;
      font-family:Inter,sans-serif;pointer-events:none;
    `;
    document.body.appendChild(banner);
  }
  const styles = {
    info:    { bg:'rgba(15,23,42,0.97)',   color:'#93c5fd', border:'rgba(59,130,246,0.5)'  },
    success: { bg:'rgba(6,78,59,0.97)',    color:'#6ee7b7', border:'rgba(16,185,129,0.5)'  },
    warning: { bg:'rgba(78,37,0,0.97)',    color:'#fcd34d', border:'rgba(245,158,11,0.5)'  },
    offline: { bg:'rgba(67,20,7,0.97)',    color:'#fca5a5', border:'rgba(239,68,68,0.5)'   },
    error:   { bg:'rgba(127,29,29,0.97)',  color:'#fca5a5', border:'rgba(239,68,68,0.5)'   },
  };
  const s = styles[type] || styles.info;
  Object.assign(banner.style, {
    background: s.bg,
    color:      s.color,
    border:     `1px solid ${s.border}`,
    opacity:    '1',
    display:    'block',
  });
  banner.textContent = msg;
  clearTimeout(banner._timer);
  if (!persist) {
    banner._timer = setTimeout(() => { banner.style.opacity = '0'; }, 3500);
  }
}

function hideBanner() {
  const banner = document.getElementById('offline-banner');
  if (banner) banner.style.opacity = '0';
}

// ── Toggle button UI ──────────────────────────────────────────────────────────
function updateToggleButton() {
  const btn      = document.getElementById('offline-toggle-btn');
  const dot      = document.getElementById('offline-status-dot');
  const label    = document.getElementById('offline-status-label');
  if (!btn) return;

  const manual   = localStorage.getItem(MANUAL_KEY) === '1';
  const noSignal = !navigator.onLine;
  const offline  = noSignal || manual;

  if (noSignal) {
    // No signal — auto offline, button disabled
    btn.style.background      = 'rgba(239,68,68,0.15)';
    btn.style.borderColor     = 'rgba(239,68,68,0.4)';
    btn.title                 = 'No internet — offline mode active';
    btn.disabled              = false;
    if (dot)   { dot.style.background = '#f87171'; dot.style.boxShadow = '0 0 6px #ef4444'; }
    if (label) label.textContent = '📵 No Signal';
  } else if (manual) {
    // Manual offline
    btn.style.background      = 'rgba(245,158,11,0.15)';
    btn.style.borderColor     = 'rgba(245,158,11,0.4)';
    btn.title                 = 'Manual offline — tap to go online';
    btn.disabled              = false;
    if (dot)   { dot.style.background = '#fbbf24'; dot.style.boxShadow = '0 0 6px #f59e0b'; }
    if (label) label.textContent = '✈ Offline Mode';
  } else {
    // Online
    btn.style.background      = 'rgba(16,185,129,0.10)';
    btn.style.borderColor     = 'rgba(16,185,129,0.25)';
    btn.title                 = 'Online — tap to force offline mode';
    btn.disabled              = false;
    if (dot)   { dot.style.background = '#34d399'; dot.style.boxShadow = '0 0 6px #10b981'; }
    if (label) label.textContent = '🌐 Online';
  }

  // Show pending count
  countPending().then(n => {
    const badge = document.getElementById('offline-pending-badge');
    if (badge) {
      badge.textContent = n > 0 ? n : '';
      badge.style.display = n > 0 ? 'flex' : 'none';
    }
  });
}

// ── Toggle handler ────────────────────────────────────────────────────────────
window.toggleOfflineMode = function() {
  if (!navigator.onLine) {
    showBanner('📵 No internet connection detected — already offline.', 'offline', false);
    return;
  }
  const manual = localStorage.getItem(MANUAL_KEY) === '1';
  if (manual) {
    setManualOffline(false);
    showBanner('🌐 Back online mode. Syncing pending scores…', 'success');
  } else {
    setManualOffline(true);
    showBanner('✈ Offline mode ON — scores will be saved locally.', 'warning', true);
  }
  updateToggleButton();
};

// ── Sync pending scores ───────────────────────────────────────────────────────
async function syncPending() {
  const pending = await getPending();
  if (pending.length === 0) { updateToggleButton(); return; }

  showBanner(`⟳ Syncing ${pending.length} offline score(s)…`, 'info');

  let synced = 0, failed = 0;
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';

  for (const item of pending) {
    try {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(item.scores)) body.append(k, v);
      if (csrf) body.append('_csrf', csrf);

      const res = await fetch(item.url, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:        body.toString(),
        credentials: 'same-origin',
      });

      if (res.ok || res.redirected || res.status < 400) {
        await deletePending(item.id);
        synced++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  if (synced > 0 && failed === 0) {
    showBanner(`✓ ${synced} score(s) synced!`, 'success');
  } else if (synced > 0) {
    showBanner(`✓ ${synced} synced, ${failed} failed — will retry`, 'warning');
  } else {
    showBanner('⚠ Sync failed — will retry when reconnected', 'offline', true);
  }
  updateToggleButton();
}

// ── Intercept form submit ─────────────────────────────────────────────────────
function initOfflineScoring() {
  const form = document.getElementById('scoringForm');
  if (!form) return;

  isOfflineMode = getOfflineMode();
  updateToggleButton();

  // Show pending badge on load
  countPending().then(n => {
    if (n > 0) showBanner(`📦 ${n} score(s) pending sync`, 'warning', true);
  });

  // Sync on load if online and not manually offline
  if (navigator.onLine && localStorage.getItem(MANUAL_KEY) !== '1') {
    syncPending();
  }

  form.addEventListener('submit', async function(e) {
    isOfflineMode = getOfflineMode();

    if (!isOfflineMode) {
      // Online & not forced offline — normal submit, sync any pending first
      syncPending().catch(() => {});
      return;
    }

    // Offline mode — intercept
    e.preventDefault();
    e.stopPropagation();

    const formData = new FormData(form);
    try {
      await savePending(form.action, formData);
      const n = await countPending();
      showBanner(`📦 Saved offline (${n} total pending). Will sync when online.`, 'warning', true);
      updateToggleButton();

      // Visual feedback on submit button
      const btn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (btn) {
        const orig = btn.textContent || btn.value;
        if (btn.tagName === 'BUTTON') btn.textContent = '✓ Saved Offline';
        else btn.value = '✓ Saved Offline';
        btn.disabled = true;
        setTimeout(() => {
          if (btn.tagName === 'BUTTON') btn.textContent = orig;
          else btn.value = orig;
          btn.disabled = false;
        }, 2000);
      }
    } catch {
      showBanner('⚠ Could not save offline. Storage may be full.', 'error');
    }
  });

  // Auto-detect connection changes
  window.addEventListener('online',  () => {
    if (localStorage.getItem(MANUAL_KEY) !== '1') {
      isOfflineMode = false;
      updateToggleButton();
      showBanner('🌐 Connection restored — syncing…', 'success');
      setTimeout(syncPending, 600);
    }
  });

  window.addEventListener('offline', () => {
    isOfflineMode = true;
    updateToggleButton();
    showBanner('📵 No signal — offline mode active. Scores saved locally.', 'offline', true);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOfflineScoring);
} else {
  initOfflineScoring();
}
