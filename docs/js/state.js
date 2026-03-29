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
  try {
    // 1) Persist consolidations per pageHash so switching chapters doesn't wipe work.
    for (const p of (pageData || [])) {
      const h = p?.pageHash;
      if (!h) continue;
      // v2: persist evaluation-stage inputs too (compass rating + sandstone) and any
      // returned AI feedback so refresh does not wipe the evaluation phase.
      const record = {
        v: 2,
        savedAt: Date.now(),
        consolidation: p?.consolidation || "",
        rating: Number(p?.rating || 0) || 0,
        isSandstone: !!p?.isSandstone,
        // Whether the AI feedback panel is currently expanded for this page.
        // This is purely a UI convenience so users can return and still see the memory.
        aiExpanded: !!p?.aiExpanded,
        aiFeedbackRaw: typeof p?.aiFeedbackRaw === 'string' ? p.aiFeedbackRaw : "",
        aiAt: p?.aiAt ?? null,
        aiRating: p?.aiRating ?? null,
      };
      localStorage.setItem(getConsolidationCacheKey(h), JSON.stringify(record));
    }

    // 2) Persist a lightweight snapshot of the last-opened session for refresh restore.
    const payload = {
      v: 2,
      savedAt: Date.now(),
      pages: pages.slice(),
      pageHashes: pageData.map(p => p?.pageHash || ""),
      consolidations: pageData.map(p => p?.consolidation || "")
    };
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(payload));
    localStorage.setItem(STORAGE_KEY_META, JSON.stringify({ savedAt: payload.savedAt }));
  } catch (e) {
    // Ignore quota / private mode errors; app should still function.
  }
}

function clearPersistedSession() {
  try { localStorage.removeItem(STORAGE_KEY_SESSION); } catch (_) {}
  try { localStorage.removeItem(STORAGE_KEY_META); } catch (_) {}
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
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESSION);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 2) return false;
    if (!Array.isArray(parsed.pages)) return false;

    pages = parsed.pages;
    const incomingHashes = Array.isArray(parsed.pageHashes) ? parsed.pageHashes : [];
    const incomingConsolidations = Array.isArray(parsed.consolidations) ? parsed.consolidations : [];

    // Rehydrate runtime-only fields (AI output is intentionally not persisted).
    pageData = pages.map((t, idx) => {
      const pageHash = incomingHashes[idx] || "";
      let consolidation = incomingConsolidations[idx] || "";
      let rating = 0;
      let isSandstone = false;
      let aiExpanded = false;
      let aiFeedbackRaw = "";
      let aiAt = null;
      let aiRating = null;
      if (pageHash) {
        try {
          const rawC = localStorage.getItem(getConsolidationCacheKey(pageHash));
          if (rawC) {
            const rec = JSON.parse(rawC);
            if (rec && typeof rec.consolidation === 'string') consolidation = rec.consolidation;
            // Back-compat: v1 stored only consolidation.
            const r = Number(rec?.rating || 0);
            rating = Number.isFinite(r) ? r : 0;
            isSandstone = !!rec?.isSandstone;
            aiExpanded = !!rec?.aiExpanded;
            aiFeedbackRaw = typeof rec?.aiFeedbackRaw === 'string' ? rec.aiFeedbackRaw : "";
            aiAt = rec?.aiAt ?? null;
            aiRating = rec?.aiRating ?? null;
          }
        } catch (_) {}
      }
      return {
        text: t,
        consolidation,
        aiExpanded,
        aiFeedbackRaw,
        aiAt,
        aiRating,
        charCount: (consolidation || "").length,
        completedOnTime: true,
        isSandstone,
        rating,
        pageHash,
        anchors: null,
        anchorVersion: 0,
        anchorsMeta: null
      };
    });

    // Defensive: ensure parallel structure
    if (pages.length !== pageData.length) {
      // Try to reconcile by truncating to the shortest.
      const n = Math.min(pages.length, pageData.length);
      pages = pages.slice(0, n);
      pageData = pageData.slice(0, n);
    }

    currentPageIndex = Math.min(currentPageIndex, Math.max(0, pages.length - 1));
    return pages.length > 0;
  } catch (e) {
    return false;
  }
}


// If a saved session was written before page hashes were computed (e.g. user never generated anchors),
// the session snapshot may not include pageHashes. In that case, we compute them on boot and then
// rehydrate per-page persisted work (ratings / AI feedback / panel state) keyed by the hash.
async function ensurePageHashesAndRehydrate() {
  try {
    if (!Array.isArray(pages) || !Array.isArray(pageData) || !pages.length) return;
    let changed = false;

    for (let idx = 0; idx < pages.length; idx++) {
      const text = pages[idx] || "";
      const p = pageData[idx];
      if (!p) continue;

      if (!p.pageHash) {
        const h = await stableHashText(text);
        if (h) {
          p.pageHash = h;
          changed = true;
        }
      }

      const h = p.pageHash;
      if (!h) continue;

      // Rehydrate from per-page record if present.
      try {
        const rawC = localStorage.getItem(getConsolidationCacheKey(h));
        if (rawC) {
          const rec = JSON.parse(rawC);
          if (rec && typeof rec.consolidation === 'string') p.consolidation = rec.consolidation;
          const r = Number(rec?.rating || 0);
          p.rating = Number.isFinite(r) ? r : 0;
          p.isSandstone = !!rec?.isSandstone;
          p.aiExpanded = !!rec?.aiExpanded;
          p.aiFeedbackRaw = typeof rec?.aiFeedbackRaw === 'string' ? rec.aiFeedbackRaw : "";
          p.aiAt = rec?.aiAt ?? null;
          p.aiRating = rec?.aiRating ?? null;
          p.charCount = (p.consolidation || "").length;
        }
      } catch (_) {}
    }

    if (changed) {
      // Update the session snapshot so future reloads have hashes immediately.
      persistSessionNow();
      render();
      try { updateDiagnostics(); } catch (_) {}
    }
  } catch (_) {}
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
