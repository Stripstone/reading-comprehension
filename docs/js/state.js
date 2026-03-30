// Split from original app.js during role-based phase-1 restructure.
// File: state.js
// Note: This is still global-script architecture (no bundler/modules required).

// ===================================
  // READING COMPREHENSION APP
  // ===================================
  
  // ===================================
  // APPLICATION STATE
  // ===================================
  
  const TIERS = [
    { min: TIER_MASTERFUL, name: 'Masterful', emoji: '🏛️' },
    { min: TIER_PROFICIENT, name: 'Proficient', emoji: '📜' },
    { min: TIER_COMPETENT, name: 'Competent', emoji: '📚' },
    { min: TIER_DEVELOPING, name: 'Developing', emoji: '🌱' },
    { min: 0, name: 'Fragmented', emoji: '🧩' }
  ];
  
  let pages = [];
  let pageData = [];
  let currentPageIndex = 0;
  window.__rcPendingRestorePageIndex = -1;
  
  // Current mode: 'reading', 'comprehension', 'research'
  let appMode = 'reading';   // default mode
  let thesisText = ''; // research mode input — coming soon

  // Current subscription tier: 'free', 'paid', 'premium'
  // During prototype: controls feature access in UI but does not enforce usage limits.
  let appTier = 'free';

  // ---- Token Tracking ----
  // Session token counter. Counts consumption per category for diagnostic purposes.
  // Tokens do not enforce limits during prototype — this is observational only.
  // Resets when tier changes.
  //
  // Token costs (must match ExperienceSpec):
  //   TTS page (cloud)     = 1
  //   AI Evaluate          = 2
  //   Generate anchors     = 1
  //   Research analysis    = 3

  const TOKEN_COSTS = {
    tts:      1,
    evaluate: 2,
    anchors:  1,
    research: 3,
  };

  const TOKEN_ALLOWANCES = {
    free:    100,
    paid:    1000,
    premium: 10000,
  };

  let sessionTokens = {
    remaining: TOKEN_ALLOWANCES['free'],
    spent: { tts: 0, evaluate: 0, anchors: 0, research: 0 },
  };

  function tokenSpend(category) {
    const cost = TOKEN_COSTS[category] || 0;
    if (!cost) return;
    sessionTokens.spent[category] = (sessionTokens.spent[category] || 0) + cost;
    sessionTokens.remaining = Math.max(0, sessionTokens.remaining - cost);
  }

  function tokenReset() {
    sessionTokens = {
      remaining: TOKEN_ALLOWANCES[appTier] || 1000,
      spent: { tts: 0, evaluate: 0, anchors: 0, research: 0 },
    };
  }

// ---- Persistence strip (stabilization mode) ----
const RC_STRIPPED_PERSIST_KEYS = [
  "rc_session_v2",
  "rc_session_meta_v2",
  "rc_tts_speed",
  "rc_browser_voice",
  "rc_voice_variant",
  "rc_app_tier",
  "rc_app_mode",
  "rc_autoplay"
];

function purgeStrippedRuntimePersistence() {
  try {
    RC_STRIPPED_PERSIST_KEYS.forEach((key) => {
      try { localStorage.removeItem(key); } catch (_) {}
      try { sessionStorage.removeItem(key); } catch (_) {}
    });
  } catch (_) {}
  try { window.__rcRuntimePersistenceStripped = true; } catch (_) {}
}

purgeStrippedRuntimePersistence();
window.purgeStrippedRuntimePersistence = purgeStrippedRuntimePersistence;

// ---- Persistence ----
// Persist learner work per-page-hash so switching chapters/sources doesn't wipe progress.
// Also persist the last-opened session so refresh restores the current view.
const STORAGE_KEY_SESSION = "rc_session_v2";
const STORAGE_KEY_META = "rc_session_meta_v2"; // small future-proof hook

function getConsolidationCacheKey(pageHash) {
  return `rc_consolidation_${pageHash}`;
}

let _persistTimer = null;
function schedulePersistSession() {
  try {
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(() => {
      _persistTimer = null;
      persistSessionNow();
    }, 250);
  } catch (_) {}
}

function persistSessionNow() {
  return false;
}

function clearPersistedSession() {
  try { purgeStrippedRuntimePersistence(); } catch (_) {}
}

function clearPersistedWorkForPageHashes(pageHashes, { clearAnchors = false } = {}) {
  const hashes = (pageHashes || []).filter(Boolean);
  for (const h of hashes) {
    try { localStorage.removeItem(getConsolidationCacheKey(h)); } catch (_) {}
    if (clearAnchors) {
      try { localStorage.removeItem(getAnchorCacheKey(h)); } catch (_) {}
    }
  }
}

function loadPersistedSessionIfAny() {
  return false;
}


// If a saved session was written before page hashes were computed (e.g. user never generated anchors),
// the session snapshot may not include pageHashes. In that case, we compute them on boot and then
// rehydrate per-page persisted work (ratings / AI feedback / panel state) keyed by the hash.
async function ensurePageHashesAndRehydrate() {
  return;
}

// Stable-ish text hashing: must match the canonical pageHash used by anchors + cache keys.
// Do NOT whitespace-normalize here, or persisted per-page records (rc_consolidation_<hash>) won't rehydrate.
async function stableHashText(text) {
  return await sha256HexBrowser(String(text ?? ""));
}

 // Stores: { text, consolidation, charCount, completedOnTime, isSandstone, rating }
  let timers = [];
  let intervals = [];
  let lastFocusedPageIndex = -1; // for keyboard navigation

  function inferCurrentPageIndex() {
    // 1) Active element within a page
    const active = document.activeElement;
    if (active) {
      const pageEl = active.closest?.(".page");
      if (pageEl?.dataset?.pageIndex) {
        const idx = parseInt(pageEl.dataset.pageIndex, 10);
        if (!Number.isNaN(idx)) return idx;
      }
    }

    // 2) Page closest to top of viewport
    const pageEls = Array.from(document.querySelectorAll(".page"));
    if (!pageEls.length) return -1;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (const el of pageEls) {
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.top);
      if (dist < bestDist) {
        bestDist = dist;
        const idx = parseInt(el.dataset.pageIndex || "-1", 10);
        if (!Number.isNaN(idx)) bestIdx = idx;
      }
    }
    return bestIdx;
  }

  // When true, the UI is in the "Evaluation" phase (compasses unlocked).
  // In this phase, the Next button should advance pages without focusing the textarea.
  let evaluationPhase = false;

  // Diagnostics (hidden panel): capture last AI request/response for bug-fixing
  let lastAIDiagnostics = null;

  let goalTime = DEFAULT_TIME_GOAL;
  let goalCharCount = DEFAULT_CHAR_GOAL;

  // -----------------------------------
  // Debug flag helper
  // -----------------------------------
  // We support truthy URL forms: ?debug=1, ?debug=true, ?debug (empty), ?debug=on/yes
  // and treat ?debug=0/false/off/no as disabled.
  function isDebugEnabledFromUrl() {
    try {
      const params = new URLSearchParams(location.search);
      if (!params.has('debug')) return false;
      const v = (params.get('debug') || '').trim().toLowerCase();
      if (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
      return false;
    } catch (_) {
      return false;
    }
  }

  // -----------------------------------
  // Passage highlighting (first-class feature)
  // -----------------------------------
// ==============================
// TEXT TO SPEECH

function getReadingRestoreStatus() {
  return {
    currentPageIndex: Number.isFinite(currentPageIndex) ? currentPageIndex : 0,
    pendingRestorePageIndex: Number(window.__rcPendingRestorePageIndex ?? -1),
    lastFocusedPageIndex: Number(typeof lastFocusedPageIndex === 'number' ? lastFocusedPageIndex : -1),
    pageCount: Array.isArray(pages) ? pages.length : 0
  };
}

window.getReadingRestoreStatus = getReadingRestoreStatus;
