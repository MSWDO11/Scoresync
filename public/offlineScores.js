/**
 * ScoreSync Offline Score Entry
 * Auto-detects no signal + manual toggle button with toggle switch UI
 */
var DB_NAME    = 'scoresync-offline';
var DB_VERSION = 1;
var STORE      = 'pending-scores';
var MANUAL_KEY = 'ss_offline_manual';

function isOffline() {
  return !navigator.onLine || localStorage.getItem(MANUAL_KEY) === '1';
}

// IndexedDB
function openDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror   = function(e) { reject(e.target.error); };
  });
}

function savePending(url, formData) {
  return openDB().then(function(db) {
    var scores = {};
    for (var pair of formData.entries()) {
      if (pair[0] !== '_csrf') scores[pair[0]] = pair[1];
    }
    return new Promise(function(resolve, reject) {
      var tx  = db.transaction(STORE, 'readwrite');
      var req = tx.objectStore(STORE).add({ url: url, scores: scores, savedAt: Date.now() });
      req.onsuccess = function() { resolve(req.result); };
      req.onerror   = function(e) { reject(e.target.error); };
    });
  });
}

function getPending() {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx  = db.transaction(STORE, 'readonly');
      var req = tx.objectStore(STORE).getAll();
      req.onsuccess = function() { resolve(req.result); };
      req.onerror   = function(e) { reject(e.target.error); };
    });
  });
}

function deletePending(id) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx  = db.transaction(STORE, 'readwrite');
      var req = tx.objectStore(STORE).delete(id);
      req.onsuccess = function() { resolve(); };
      req.onerror   = function(e) { reject(e.target.error); };
    });
  });
}

// Banner
function showBanner(msg, type, persist) {
  var banner = document.getElementById('offline-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.style.cssText = 'position:fixed;bottom:76px;left:50%;transform:translateX(-50%);' +
      'z-index:9999;padding:10px 20px;border-radius:12px;font-size:13px;font-weight:700;' +
      'text-align:center;max-width:92vw;min-width:220px;' +
      'box-shadow:0 4px 24px rgba(0,0,0,0.55);transition:opacity 0.3s;' +
      'font-family:Inter,sans-serif;pointer-events:none;';
    document.body.appendChild(banner);
  }
  var styles = {
    info:    { bg:'rgba(15,23,42,0.97)',   color:'#93c5fd', border:'rgba(59,130,246,0.5)'  },
    success: { bg:'rgba(6,78,59,0.97)',    color:'#6ee7b7', border:'rgba(16,185,129,0.5)'  },
    warning: { bg:'rgba(78,37,0,0.97)',    color:'#fcd34d', border:'rgba(245,158,11,0.5)'  },
    offline: { bg:'rgba(67,20,7,0.97)',    color:'#fca5a5', border:'rgba(239,68,68,0.5)'   },
    error:   { bg:'rgba(127,29,29,0.97)',  color:'#fca5a5', border:'rgba(239,68,68,0.5)'   },
  };
  var s = styles[type] || styles.info;
  banner.style.background = s.bg;
  banner.style.color      = s.color;
  banner.style.border     = '1px solid ' + s.border;
  banner.style.opacity    = '1';
  banner.style.display    = 'block';
  banner.textContent      = msg;
  clearTimeout(banner._t);
  if (!persist) banner._t = setTimeout(function() { banner.style.opacity = '0'; }, 3500);
}

// Update all UI elements
function updateBtn() {
  var manual   = localStorage.getItem(MANUAL_KEY) === '1';
  var noSignal = !navigator.onLine;

  // Top bar small button
  var dot   = document.getElementById('offline-status-dot');
  var label = document.getElementById('offline-status-label');
  var topBtn = document.getElementById('offline-toggle-btn');

  // Strip button
  var stripTitle = document.getElementById('offline-strip-title');
  var stripDesc  = document.getElementById('offline-strip-desc');
  var switchEl   = document.getElementById('offline-toggle-switch');
  var knob       = document.getElementById('offline-toggle-knob');

  if (noSignal) {
    if (topBtn) { topBtn.style.background = 'rgba(239,68,68,0.15)'; topBtn.style.borderColor = 'rgba(239,68,68,0.4)'; }
    if (dot)    { dot.style.background = '#f87171'; dot.style.boxShadow = '0 0 7px #ef4444'; }
    if (label)  label.textContent = '📵 No Signal';
    if (stripTitle) stripTitle.textContent = '📵 No Signal — Offline Mode Active';
    if (stripDesc)  stripDesc.style.color  = '#f87171';
    if (stripDesc)  stripDesc.textContent  = 'No internet. Scores saved to your device automatically.';
    if (switchEl)   switchEl.style.background = '#ef4444';
    if (knob)       { knob.style.transform = 'translateX(24px)'; knob.style.background = '#fff'; }
  } else if (manual) {
    if (topBtn) { topBtn.style.background = 'rgba(245,158,11,0.15)'; topBtn.style.borderColor = 'rgba(245,158,11,0.4)'; }
    if (dot)    { dot.style.background = '#fbbf24'; dot.style.boxShadow = '0 0 7px #f59e0b'; }
    if (label)  label.textContent = '✈ Offline Mode';
    if (stripTitle) stripTitle.textContent = '✈ Offline Mode ON';
    if (stripDesc)  stripDesc.style.color  = '#fbbf24';
    if (stripDesc)  stripDesc.textContent  = 'Scores saved locally. Tap to go online and sync.';
    if (switchEl)   switchEl.style.background = '#f59e0b';
    if (knob)       { knob.style.transform = 'translateX(24px)'; knob.style.background = '#fff'; }
  } else {
    if (topBtn) { topBtn.style.background = 'rgba(16,185,129,0.12)'; topBtn.style.borderColor = 'rgba(16,185,129,0.35)'; }
    if (dot)    { dot.style.background = '#34d399'; dot.style.boxShadow = '0 0 7px #10b981'; }
    if (label)  label.textContent = '🌐 Online';
    if (stripTitle) stripTitle.textContent = 'Offline Mode';
    if (stripDesc)  stripDesc.style.color  = '#475569';
    if (stripDesc)  stripDesc.textContent  = 'Tap to enable — scores saved to device when no signal.';
    if (switchEl)   switchEl.style.background = 'rgba(255,255,255,0.1)';
    if (knob)       { knob.style.transform = 'translateX(0px)'; knob.style.background = '#475569'; }
  }

  getPending().then(function(items) {
    var n = items.length;
    var badge = document.getElementById('offline-pending-badge');
    var strip = document.getElementById('offline-pending-strip');
    if (badge) { badge.textContent = n > 0 ? n : ''; badge.style.display = n > 0 ? 'flex' : 'none'; }
    if (strip) { strip.textContent = n + ' pending'; strip.style.display = n > 0 ? 'inline' : 'none'; }
  }).catch(function() {});
}

// Sync pending
function syncPending() {
  getPending().then(function(pending) {
    if (!pending.length) { updateBtn(); return; }
    showBanner('Syncing ' + pending.length + ' score(s)...', 'info', false);
    var csrf = '';
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) csrf = meta.content || '';
    var done = 0, synced = 0, failed = 0, total = pending.length;
    pending.forEach(function(item) {
      var body = new URLSearchParams();
      Object.keys(item.scores).forEach(function(k) { body.append(k, item.scores[k]); });
      if (csrf) body.append('_csrf', csrf);
      fetch(item.url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), credentials: 'same-origin' })
        .then(function(res) {
          if (res.ok || res.redirected || res.status < 400) {
            return deletePending(item.id).then(function() { synced++; finish(); });
          } else { failed++; finish(); }
        }).catch(function() { failed++; finish(); });
    });
    function finish() {
      done++;
      if (done < total) return;
      if (synced > 0 && failed === 0) showBanner('✓ ' + synced + ' score(s) synced!', 'success', false);
      else if (synced > 0) showBanner('✓ ' + synced + ' synced, ' + failed + ' failed', 'warning', false);
      else showBanner('Sync failed — will retry when reconnected', 'offline', true);
      updateBtn();
    }
  }).catch(function() {});
}

// Toggle handler
window.toggleOfflineMode = function() {
  if (!navigator.onLine) {
    showBanner('📵 No internet — already offline.', 'offline', false);
    updateBtn();
    return;
  }
  var manual = localStorage.getItem(MANUAL_KEY) === '1';
  if (manual) {
    localStorage.removeItem(MANUAL_KEY);
    showBanner('🌐 Online mode. Syncing...', 'success', false);
    updateBtn();
    setTimeout(syncPending, 400);
  } else {
    localStorage.setItem(MANUAL_KEY, '1');
    showBanner('✈ Offline mode ON — scores saved locally.', 'warning', true);
    updateBtn();
  }
};

// Offline-aware submit
window.offlineAwareSubmit = function(form) {
  if (!isOffline()) {
    syncPending();
    form.submit();
    return;
  }
  var formData = new FormData(form);
  savePending(form.action, formData).then(function() {
    return getPending();
  }).then(function(items) {
    showBanner('📦 Saved offline (' + items.length + ' pending). Syncs when online.', 'warning', true);
    updateBtn();
    var btns = form.querySelectorAll('button[type="submit"], input[type="submit"]');
    btns.forEach(function(btn) {
      var orig = btn.tagName === 'BUTTON' ? btn.textContent : btn.value;
      if (btn.tagName === 'BUTTON') btn.textContent = '✓ Saved Offline';
      else btn.value = '✓ Saved Offline';
      btn.disabled = true;
      setTimeout(function() {
        if (btn.tagName === 'BUTTON') btn.textContent = orig;
        else btn.value = orig;
        btn.disabled = false;
      }, 2500);
    });
  }).catch(function() {
    showBanner('Could not save offline. Storage may be full.', 'error', false);
  });
};

// Init
function init() {
  updateBtn();
  getPending().then(function(items) {
    if (items.length > 0) showBanner('📦 ' + items.length + ' score(s) pending sync', 'warning', true);
  }).catch(function() {});
  if (navigator.onLine && localStorage.getItem(MANUAL_KEY) !== '1') syncPending();
  window.addEventListener('online', function() {
    if (localStorage.getItem(MANUAL_KEY) !== '1') {
      updateBtn();
      showBanner('🌐 Connection restored — syncing...', 'success', false);
      setTimeout(syncPending, 600);
    }
  });
  window.addEventListener('offline', function() {
    updateBtn();
    showBanner('📵 No signal — offline mode active.', 'offline', true);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
