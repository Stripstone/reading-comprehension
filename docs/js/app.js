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

// Stable-ish text hashing: normalize whitespace to avoid accidental churn.
async function stableHashText(text) {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  return await sha256HexBrowser(normalized);
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
  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function applyHighlightSnippetsToPage(pageIndex, snippets) {
    const pageEl = document.querySelectorAll('.page')[pageIndex];
    if (!pageEl) return;
    const textEl = pageEl.querySelector('.page-text');
    if (!textEl) return;

    const source = String(pages?.[pageIndex] ?? textEl.textContent ?? '');
    const list = Array.isArray(snippets) ? snippets.map(s => String(s || '').trim()).filter(Boolean) : [];

    if (!list.length) {
      textEl.textContent = source;
      return;
    }

    // Find all occurrences of each snippet (simple + deterministic).
    const ranges = [];
    for (const snip of list) {
      let idx = 0;
      while (idx < source.length) {
        const found = source.indexOf(snip, idx);
        if (found === -1) break;
        ranges.push({ start: found, end: found + snip.length });
        idx = found + Math.max(1, snip.length);
      }
    }

    if (!ranges.length) {
      // If nothing matched exactly, show the plain source.
      textEl.textContent = source;
      return;
    }

    // Merge overlapping ranges.
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (!last || r.start > last.end) {
        merged.push({ start: r.start, end: r.end });
      } else {
        last.end = Math.max(last.end, r.end);
      }
    }

    let out = '';
    let cursor = 0;
    for (const r of merged) {
      if (r.start > cursor) out += escapeHtml(source.slice(cursor, r.start));
      out += `<mark class="highlight-missed">${escapeHtml(source.slice(r.start, r.end))}</mark>`;
      cursor = r.end;
    }
    if (cursor < source.length) out += escapeHtml(source.slice(cursor));

    textEl.innerHTML = out;
  }

  // ===================================
  // Anchors (core idea targets)
  // ===================================

  const API_BASE = "https://reading-comprehension-rpwd.vercel.app";
const ANCHOR_VERSION = 5;
  const anchorsInFlight = new Map(); // pageHash -> Promise

  // Global anchors diagnostics record surfaced via the 🔧 Diagnostics panel.
  // This is REQUIRED so "Load Pages" / "Add Pages" always produces tangible
  // runtime evidence even when anchors come from cache.
  let lastAnchorsDiagnostics = null;

  // -----------------------------------
  // Anchors diagnostics (REQUIRED when ?debug=1)
  // -----------------------------------
  // Policy: every anchor load trigger must write a tangible diagnostic record,
  // even on cache hits, so runtime validation never relies on "ghost" behavior.
  function isAnchorsDebugEnabled() {
    return isDebugEnabledFromUrl();
  }

  function setAnchorsDiagnostics(pageEl, pageIndex, patch) {
    try {
      if (!isAnchorsDebugEnabled()) return;
      const pd = pageData?.[pageIndex];
      if (!pd) return;

      pd.anchorsDiagnostics = Object.assign({}, pd.anchorsDiagnostics || {}, patch || {});
      pd.anchorsDiagnostics.ts = Date.now();

      // Always update global record (even if pageEl is not present).
      lastAnchorsDiagnostics = Object.assign({ pageIndex }, pd.anchorsDiagnostics);

      if (!pageEl) return;

      const pre = pageEl.querySelector('.anchors-debug-pre');
      if (pre) {
        const d = pd.anchorsDiagnostics || {};
        const lines = [
          `stage: ${d.stage || ''}`,
          `pageIndex: ${pageIndex}`,
          `pageHash: ${(d.pageHash || pd.pageHash || '').slice(0, 12)}`,
          `cacheHit: ${String(d.cacheHit)}`,
          `api: ${d.api ? `${d.api.url} (${d.api.status})` : ''}`,
          `anchors: ${typeof d.anchorCount === 'number' ? d.anchorCount : ''}`,
          `spansInjected: ${typeof d.spanCount === 'number' ? d.spanCount : ''}`,
          d.error ? `error: ${d.error}` : '',
        ].filter(Boolean);
        pre.textContent = lines.join('\\n');
      }

      const counter = pageEl.querySelector('.anchors-counter');
      if (counter) {
        const d = pd.anchorsDiagnostics || {};
        const shortHash = String(d.pageHash || pd.pageHash || '').slice(0, 8);
        counter.title = `anchors dbg — hash:${shortHash} cacheHit:${String(d.cacheHit)} stage:${d.stage || ''}`;
      }
    } catch (_) {}
  }

  async function sha256HexBrowser(text) {
    const enc = new TextEncoder();
    const data = enc.encode(String(text ?? ""));
    const hash = await crypto.subtle.digest('SHA-256', data);
    const bytes = Array.from(new Uint8Array(hash));
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function normalizeForMatch(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Deterministic stopword list for anchor term extraction/matching.
  // Keep intentionally small; we're not doing NLP, just avoiding glue-words.
  const ANCHOR_STOPWORDS = new Set([
    'a','an','and','are','as','at','be','been','being','but','by','can','could','did','do','does','doing',
    'for','from','had','has','have','having','he','her','here','hers','him','his','how','i','if','in','into',
    'is','it','its','just','like','may','me','more','most','my','no','not','of','off','on','one','or','our',
    'out','over','people','so','some','such','than','that','the','their','them','then','there','these','they',
    'this','those','to','too','under','up','us','was','we','were','what','when','where','which','who','why',
    'will','with','without','you','your'
  ]);

  // Weak verbs and helper words that often become "strange" anchor keywords.
  // We intentionally filter these out for a more satisfying UX.
  const ANCHOR_WEAK_VERBS = new Set([
    'be','been','being','is','are','was','were','am',
    'have','has','had','having',
    'do','does','did','doing',
    'get','gets','got','getting',
    'make','makes','made','making',
    'feel','feels','felt','feeling',
    // common "action" verbs / helper words that tend to become unhelpful anchor keywords
    // (we prefer the nouns/concepts around them)
    'create','creates','created','creating',
    'need','needs','needed','needing',
    'start','starts','started','starting',
    'earn','earns','earned','earning',
    'move','moves','moved','moving',
    'begin','begins','began','beginning',
    'able','right'
  ]);

  // Simple normalization into a stable trigger token.
  // Robustness comes from generating "trim variants" rather than heavy NLP.
  function baseForm(token) {
    let t = String(token || '').toLowerCase().trim();
    if (!t) return '';
    t = t.replace(/[^a-z0-9]/g, '');
    if (!t) return '';
    return t;
  }

  // Generate shortened forms by dropping 1–4 characters from the end.
  // Rule:
  // - If token length < 4 => no trimming.
  // - Otherwise return token plus t[:-1..-4] as long as length >= minRemain.
  function trimVariants(token, minRemain = 3) {
    const t = baseForm(token);
    if (!t) return [];
    if (t.length < 4) return [t];
    const out = [t];
    for (let k = 1; k <= 4; k++) {
      const n = t.length - k;
      if (n < minRemain) continue;
      out.push(t.slice(0, n));
    }
    return out;
  }

  function tokenizeBase(text) {
    const s = normalizeForMatch(text);
    if (!s) return [];
    const raw = s.split(' ').filter(Boolean);
    const out = [];
    for (const w of raw) {
      const b = baseForm(w);
      if (!b) continue;
      if (b.length < 4) continue;
      if (ANCHOR_STOPWORDS.has(b)) continue;
      if (ANCHOR_WEAK_VERBS.has(b)) continue;
      out.push(b);
    }
    return out;
  }

  function extractEssentialTerms(anchor) {
    // UX rule: ANY keyword should be able to activate an anchor.
    // So we take a UNION of:
    // - model-provided terms (often semantic)
    // - terms derived from the quote itself (often literal)
    // This prevents cases like "generational" not activating when the model only provided "wealth".
    const rawTerms = Array.isArray(anchor?.terms) ? anchor.terms : [];
    // Terms are already normalized server-side, but we apply baseForm to match user variations.
    const modelTerms = rawTerms.flatMap(t => tokenizeBase(t));
    const quoteTerms = tokenizeBase(anchor?.quote || '');

    const out = [];
    const seen = new Set();
    [...modelTerms, ...quoteTerms].forEach(w => {
      if (!w) return;
      if (seen.has(w)) return;
      seen.add(w);
      out.push(w);
    });
    return out.slice(0, 6);
  }

  function quoteChunkMatch(quote, inputNorm) {
    const q = normalizeForMatch(quote);
    if (!q || !inputNorm) return false;
    // If the quote is short, allow direct substring match.
    if (q.length <= 40) return inputNorm.includes(q);
    // Otherwise, try 3-word chunks (deterministic)
    const words = q.split(" ").filter(Boolean);
    if (words.length < 3) return false;
    for (let i = 0; i <= words.length - 3; i++) {
      const chunk = words.slice(i, i + 3).join(" ");
      if (chunk.length >= 12 && inputNorm.includes(chunk)) return true;
    }
    return false;
  }

  function buildAnchorsHtml(sourceText, anchors) {
    const src = String(sourceText || '');
    const list = Array.isArray(anchors) ? anchors : [];
    if (!list.length) return escapeHtml(src);

    // Compute non-overlapping ranges from first occurrence of each quote.
    const ranges = [];
    for (const a of list) {
      const q = String(a?.quote || '');
      if (!q) continue;
      const idx = src.indexOf(q);
      if (idx === -1) continue;
      ranges.push({ start: idx, end: idx + q.length, id: String(a?.id || '') });
    }

    if (!ranges.length) return escapeHtml(src);

    // Prefer longer quotes first when overlaps exist, then earlier start.
    ranges.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const chosen = [];
    const overlaps = (r1, r2) => !(r1.end <= r2.start || r2.end <= r1.start);
    for (const r of ranges) {
      if (chosen.some(c => overlaps(c, r))) continue;
      chosen.push(r);
    }
    chosen.sort((a, b) => a.start - b.start);

    let out = '';
    let cursor = 0;
    for (const r of chosen) {
      if (r.start > cursor) out += escapeHtml(src.slice(cursor, r.start));
      const segment = src.slice(r.start, r.end);
      out += `<span class="anchor" data-anchor-id="${escapeHtml(r.id)}">${escapeHtml(segment)}</span>`;
      cursor = r.end;
    }
    if (cursor < src.length) out += escapeHtml(src.slice(cursor));
    return out;
  }

  function getAnchorCacheKey(pageHash) {
    return `anchors:${ANCHOR_VERSION}:${pageHash}`;
  }

  function readAnchorsFromCache(pageHash) {
    try {
      const raw = localStorage.getItem(getAnchorCacheKey(pageHash));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.anchorVersion !== ANCHOR_VERSION) return null;
      if (!Array.isArray(parsed.anchors)) return null;
    // Back-compat: older cache shape was { anchors: [...] }.
    // Newer cache may include extra fields produced by /api/anchors.
    return {
      ...parsed,
      // Anchors endpoint no longer emits pageBetterConsolidation (evaluate owns that).
      pageBetterConsolidation: undefined,
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : undefined,
    };
    } catch (_) {
      return null;
    }
  }

function writeAnchorsToCache(pageHash, payload) {
    try {
    const toStore = {
      anchors: payload?.anchors,
      pageBetterConsolidation: undefined,
      candidates: payload?.candidates,
      anchorVersion: ANCHOR_VERSION,
      createdAt: Date.now(),
    };
    localStorage.setItem(getAnchorCacheKey(pageHash), JSON.stringify(toStore));
    } catch (_) {
      // ignore quota errors
    }
  }

  async function fetchAnchorsForPageText(pageText, pageHash) {
    const debug = isDebugEnabledFromUrl();
    const url = `${API_BASE}/api/anchors`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageText, maxAnchors: 5, debug: debug ? 1 : 0 }),
    });
    const txt = await resp.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { error: 'Invalid JSON from /api/anchors', detail: txt }; }
    if (!resp.ok) {
      const err = new Error(data?.error || 'Anchors API error');
      err.details = data;
      throw err;
    }
    // Basic schema check
    if (!Array.isArray(data?.anchors) || !data?.meta?.pageHash) {
      const err = new Error('Invalid /api/anchors response schema');
      err.details = data;
      throw err;
    }
    if (String(data.meta.pageHash) !== String(pageHash)) {
      const err = new Error('Anchors pageHash mismatch');
      err.details = { expected: pageHash, got: data?.meta?.pageHash };
      throw err;
    }

    // In debug mode, surface diagnostics in the console AND return enough metadata
    // for the on-page anchors debug panel.
    if (debug) {
      try {
        console.info('[Anchors] /api/anchors response', {
          status: resp.status,
          pageHash: data?.meta?.pageHash,
          anchorVersion: data?.meta?.anchorVersion,
          anchors: Array.isArray(data?.anchors) ? data.anchors.length : null,
          debug: data?.debug,
        });
      } catch (_) {}
    }
    return { data, api: { url, status: resp.status }, rawText: debug ? txt : undefined };
  }

  async function ensureAnchorsForPageIndex(pageIndex, pageElForDiag = null) {
    const text = String(pages?.[pageIndex] || '');
    if (!text) return null;

    const pd = pageData?.[pageIndex];
    if (!pd) return null;

    // If already loaded for this pageHash, reuse.
    if (pd.pageHash && pd.anchors && pd.anchorVersion === ANCHOR_VERSION) return pd.anchors;

    // Diagnostics: trigger recorded as soon as anchors are requested.
    setAnchorsDiagnostics(pageElForDiag, pageIndex, { stage: 'trigger', cacheHit: null });

    const pageHash = pd.pageHash || await sha256HexBrowser(text);
    pd.pageHash = pageHash;
    setAnchorsDiagnostics(pageElForDiag, pageIndex, { stage: 'pageHash', pageHash, cacheHit: null });

    const cached = readAnchorsFromCache(pageHash);
    // Use cache only if it matches current anchor version
    if (cached?.anchors && cached.anchorVersion === ANCHOR_VERSION) {
      pd.anchors = cached.anchors;
      // No pageBetterConsolidation in anchors cache (evaluate owns that).
      pd.anchorCandidates = cached.candidates;
      pd.anchorVersion = cached.anchorVersion;
      pd.anchorsMeta = { createdAt: cached.createdAt, cacheHit: true };
      setAnchorsDiagnostics(pageElForDiag, pageIndex, {
        stage: 'cache-hit',
        pageHash,
        cacheHit: true,
        anchorCount: cached.anchors.length,
        pageBetterConsolidation: null,
        candidates: Array.isArray(cached.candidates) ? cached.candidates : null,
        api: null,
      });
      if (isDebugEnabledFromUrl()) {
        try {
          console.info("[Anchors] cache hit", { pageHash, anchorVersion: cached.anchorVersion, createdAt: cached.createdAt });
        } catch (_) {}
      }
      return pd.anchors;
    }

    if (cached?.anchors && cached.anchorVersion !== ANCHOR_VERSION) {
      // Cache exists but is stale — force a re-fetch so new server contract can be validated.
      pd.anchorsMeta = { createdAt: cached.createdAt, cacheHit: false, cacheStale: true, cachedAnchorVersion: cached.anchorVersion, expectedAnchorVersion: ANCHOR_VERSION };
      setAnchorsDiagnostics(pageElForDiag, pageIndex, {
        stage: 'cache-stale',
        pageHash,
        cacheHit: false,
        cacheStale: true,
        cachedAnchorVersion: cached.anchorVersion,
        expectedAnchorVersion: ANCHOR_VERSION,
        anchorCount: cached.anchors.length,
        api: null,
      });
      if (isDebugEnabledFromUrl()) {
        try {
          console.info("[Anchors] cache stale (will refetch)", { pageHash, cachedAnchorVersion: cached.anchorVersion, expectedAnchorVersion: ANCHOR_VERSION });
        } catch (_) {}
      }
    }

    // De-dupe concurrent fetches by pageHash.
    if (anchorsInFlight.has(pageHash)) {
      await anchorsInFlight.get(pageHash);
      return pd.anchors || null;
    }

    const p = (async () => {
      setAnchorsDiagnostics(pageElForDiag, pageIndex, { stage: 'fetching', pageHash, cacheHit: false });
      const out = await fetchAnchorsForPageText(text, pageHash);
      const data = out.data;
      pd.anchors = data.anchors;
      // No pageBetterConsolidation in anchors response (evaluate owns that).
      pd.anchorCandidates = data.candidates;
      pd.anchorVersion = data.meta.anchorVersion;
      pd.anchorsMeta = { createdAt: Date.now(), cacheHit: false };
      pd.anchorsRawDebug = data?.debug || null;
      setAnchorsDiagnostics(pageElForDiag, pageIndex, {
        stage: 'fetched',
        pageHash,
        cacheHit: false,
        api: out.api,
        anchorCount: Array.isArray(data.anchors) ? data.anchors.length : null,
        pageBetterConsolidation: null,
        candidates: Array.isArray(data.candidates) ? data.candidates : null,
      });
      writeAnchorsToCache(pageHash, {
        anchors: data.anchors,
        pageBetterConsolidation: null,
        candidates: data.candidates,
      });
    })();

    anchorsInFlight.set(pageHash, p);
    try {
      await p;
      return pd.anchors;
    } finally {
      anchorsInFlight.delete(pageHash);
    }
  }

  function updateAnchorsUIForPage(pageEl, pageIndex, userText) {
    const pd = pageData?.[pageIndex];
    if (!pageEl || !pd?.anchors) return;

    const inputNorm = normalizeForMatch(userText);
    const userBaseTokens = tokenizeBase(userText);
    // Expand user tokens into trimmed variants for robust matching.
    // Example: "generational" -> ["generational","generationa","generation","generatio","generati"]
    // This intentionally does NOT require variants to be "real words"; it's just a deterministic trigger key.
    const userVariantSet = new Set();
    for (const t of userBaseTokens) {
      for (const v of trimVariants(t, 3)) userVariantSet.add(v);
    }
    const anchors = pd.anchors;
    const spans = pageEl.querySelectorAll('.page-text .anchor');

    // Phase 2 UX contract:
    // - Counter unlocks an anchor as soon as ANY essential keyword matches.
    // - Visual intensity reflects how many essential keywords are present.
    // - First match should be NOTICEABLE (>= 50% intensity), additional matches strengthen it.
    // - Additionally, the matched keyword(s) inside the anchor quote should be fully highlighted.
    // UX tuning:
    // - First match should be clearly visible, but not overpowering.
    // - Additional matches increase intensity.
    const ANCHOR_ALPHA_MAX = 0.90;
    const ANCHOR_ALPHA_FIRST = 0.40;

    const foundIds = new Set();
    const byId = new Map(anchors.map(a => [String(a.id), a]));
    const matchDetails = [];

    spans.forEach(span => {
      const id = String(span.getAttribute('data-anchor-id') || '');
      const a = byId.get(id);
      if (!a) return;

      const essential = extractEssentialTerms(a);
      // A term is considered matched if ANY of its trim variants appears in the userVariantSet.
      const matched = [];
      for (const term of essential) {
        const variants = trimVariants(term, 3);
        if (variants.some(v => userVariantSet.has(v))) matched.push(term);
      }

      // If the user effectively quoted the passage (chunk match), treat as fully satisfied.
      const quoteMatch = quoteChunkMatch(a.quote, inputNorm);
      const total = Math.max(1, essential.length);
      const matchCount = quoteMatch ? total : matched.length;
      const counted = matchCount >= 1;
      const ratio = Math.min(1, matchCount / total);

      // Apply progressive alpha.
      // UX rule: first match should jump to >= 50% visibility; more matches approach max.
      let alpha = 0;
      if (matchCount >= 1) {
        if (total <= 1) {
          alpha = ANCHOR_ALPHA_MAX;
        } else {
          const extraSteps = Math.min(total, matchCount) - 1;
          const denom = Math.max(1, total - 1);
          const extra = (ANCHOR_ALPHA_MAX - ANCHOR_ALPHA_FIRST) * (extraSteps / denom);
          alpha = Math.min(ANCHOR_ALPHA_MAX, ANCHOR_ALPHA_FIRST + extra);
        }
      }
      span.style.setProperty('--anchor-alpha', String(alpha));

      // Fully highlight the matched keyword(s) inside the anchor quote.
      // This gives the "Oh, I found a word" feedback without changing matching rules.
      applyMatchedTermHighlight(span, quoteMatch ? essential : matched);

      if (counted) foundIds.add(id);

      // Collect match reasoning for debug (only tiny payload).
      matchDetails.push({
        id,
        terms: essential,
        matchedTerms: quoteMatch ? essential : matched,
        matchedBaseForms: quoteMatch ? essential : matched,
        matchedBaseFormsViaTrim: quoteMatch ? essential : matched,
        userBaseTokensSample: userBaseTokens.slice(0, 18),
        userTrimTokensSample: Array.from(userVariantSet).slice(0, 18),
        matchCount,
        totalTerms: total,
        counted,
        completionRatio: Number(ratio.toFixed(2)),
        matchedBy: quoteMatch ? 'quote' : 'terms'
      });
    });

    const counter = pageEl.querySelector('.anchors-counter');
    if (counter) counter.textContent = `Anchors Found: ${foundIds.size}/${anchors.length}`;

    // Surface match reasoning in diagnostics when debug is enabled.
    if (isDebugEnabledFromUrl()) {
      setAnchorsDiagnostics(pageEl, pageIndex, {
        stage: 'matches-updated',
        found: foundIds.size,
        // Keep small: only include first 8 anchors worth of details.
        matchDetails: matchDetails.slice(0, 8)
      });
    }
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyMatchedTermHighlight(span, matchedTerms) {
    if (!span) return;
    const original = span.dataset.originalText ?? span.textContent;
    // Always reset to original before applying new markup.
    span.textContent = original;
    span.dataset.originalText = original;

    const terms = Array.isArray(matchedTerms)
      ? matchedTerms.map(t => String(t || '').trim()).filter(Boolean)
      : [];
    if (!terms.length) return;

    // Prefer longer terms first to avoid partial overlap issues.
    terms.sort((a, b) => b.length - a.length);

    // Terms are trigger keys; create a forgiving surface pattern for the quote.
    // We allow up to 4 trailing word characters so:
    // - "student" highlights "students"
    // - "generation" highlights "generational"
    // This is aligned with the trim-variant matching rule.
    const variants = [];
    for (const t of terms) {
      const esc = escapeRegExp(t);
      variants.push(`${esc}\\w{0,4}`);
    }

    const pattern = variants.join('|');
    if (!pattern) return;

    const re = new RegExp(`\\b(${pattern})\\b`, 'gi');
    const text = original;
    const parts = text.split(re);
    if (parts.length <= 1) return;

    // Rebuild with matched segments wrapped.
    let html = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i % 2 === 1) {
        html += `<span class="anchor-term-found">${escapeHtml(part)}</span>`;
      } else {
        html += escapeHtml(part);
      }
    }
    span.innerHTML = html;
  }

  function bindHintButton(pageEl, pageIndex) {
    const btn = pageEl.querySelector('.hint-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const pd = pageData?.[pageIndex];
      if (!pd?.anchors?.length) return;

      // 2s fade-in / 2s fade-out visual override.
      const spans = pageEl.querySelectorAll('.page-text .anchor');
      spans.forEach(s => { s.style.transitionDuration = '2s'; });
      // Inline CSS vars beat class rules; explicitly set alpha for hint.
      spans.forEach(s => {
        s.dataset.anchorAlphaPrev = s.style.getPropertyValue('--anchor-alpha') || '';
        s.style.setProperty('--anchor-alpha', '0.90');
      });
      pageEl.classList.add('anchor-hint-active');

      // Hold for 2 seconds, then return to match-based visibility over 2 seconds.
      setTimeout(() => {
        pageEl.classList.remove('anchor-hint-active');
        // After fade-out completes, restore normal transition speed and refresh matches.
        setTimeout(() => {
          spans.forEach(s => { s.style.transitionDuration = '0.35s'; });
          spans.forEach(s => {
            // Clear hint override; updateAnchorsUIForPage will re-apply match-based alpha.
            delete s.dataset.anchorAlphaPrev;
          });
          const textarea = pageEl.querySelector('textarea');
          updateAnchorsUIForPage(pageEl, pageIndex, textarea ? textarea.value : '');
        }, 2000);
      }, 2000);
    });
  }

  async function hydrateAnchorsIntoPageEl(pageEl, pageIndex) {
    const text = String(pages?.[pageIndex] || '');
    if (!pageEl || !text) return;
    const textEl = pageEl.querySelector('.page-text');
    if (!textEl) return;

    try {
      setAnchorsDiagnostics(pageEl, pageIndex, { stage: 'hydrate-start', cacheHit: null });
      const anchors = await ensureAnchorsForPageIndex(pageIndex, pageEl);
      if (!anchors || !anchors.length) return;
      // Only apply if the text element is still for this page.
      textEl.innerHTML = buildAnchorsHtml(text, anchors);

      // If we failed to inject any spans, make it visible in debug.
      const spanCount = textEl.querySelectorAll('.anchor').length;
      setAnchorsDiagnostics(pageEl, pageIndex, { stage: 'spans-injected', spanCount, anchorCount: anchors.length });
      if (spanCount === 0) {
        const counter = pageEl.querySelector('.anchors-counter');
        if (counter) counter.textContent = `Anchors Found: 0/${anchors.length}`;
        if (isDebugEnabledFromUrl()) {
          console.warn('[Anchors] No spans injected. Quotes may not match the rendered page text exactly.', {
            pageIndex,
            anchorsSample: anchors.slice(0, 3),
          });
        }
      }

      const textarea = pageEl.querySelector('textarea');
      updateAnchorsUIForPage(pageEl, pageIndex, textarea ? textarea.value : '');
      const btn = pageEl.querySelector('.hint-btn');
      if (btn) btn.disabled = false;
    } catch (e) {
      const counter = pageEl.querySelector('.anchors-counter');
      if (counter) counter.textContent = 'Anchors: error';
      const btn = pageEl.querySelector('.hint-btn');
      if (btn) btn.disabled = true;

      setAnchorsDiagnostics(pageEl, pageIndex, { stage: 'error', error: String(e?.message || e) });

      if (isDebugEnabledFromUrl()) {
        console.warn('Anchors failed', e);
      }
    }
  }

  const sandSound = document.getElementById("sandSound");
  const stoneSound = document.getElementById("stoneSound");
  const rewardSound = document.getElementById("rewardSound");
  const compassSound = document.getElementById("compassSound");
  const pageTurnSound = document.getElementById("pageTurnSound");
  const evaluateSound = document.getElementById("evaluateSound");
  
  // Set initial volumes
  function loadSavedVolumes() {
    try {
      const raw = localStorage.getItem('rc_volumes');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveVolumes(v) {
    try { localStorage.setItem('rc_volumes', JSON.stringify(v)); } catch (_) {}
  }

  const savedVol = loadSavedVolumes() || {};
  sandSound.volume = typeof savedVol.sand === 'number' ? savedVol.sand : SAND_VOLUME;
  stoneSound.volume = typeof savedVol.stone === 'number' ? savedVol.stone : STONE_VOLUME;
  rewardSound.volume = typeof savedVol.reward === 'number' ? savedVol.reward : REWARD_VOLUME;
  compassSound.volume = typeof savedVol.compass === 'number' ? savedVol.compass : COMPASS_VOLUME;
  pageTurnSound.volume = typeof savedVol.pageTurn === 'number' ? savedVol.pageTurn : PAGE_TURN_VOLUME;
  evaluateSound.volume = typeof savedVol.evaluate === 'number' ? savedVol.evaluate : EVALUATE_VOLUME;
  music.volume = typeof savedVol.music === 'number' ? savedVol.music : MUSIC_VOLUME;

  // Small helper used by the volume panel
  function setVolume(key, val) {
    const v = Math.max(0, Math.min(1, Number(val)));
    const cur = loadSavedVolumes() || {};
    cur[key] = v;
    saveVolumes(cur);
    if (key === 'sand') sandSound.volume = v;
    if (key === 'stone') stoneSound.volume = v;
    if (key === 'reward') rewardSound.volume = v;
    if (key === 'compass') compassSound.volume = v;
    if (key === 'pageTurn') pageTurnSound.volume = v;
    if (key === 'evaluate') evaluateSound.volume = v;
    if (key === 'music') music.volume = v;
  }
  
  // Set initial input values from constants
  document.getElementById("goalTimeInput").value = DEFAULT_TIME_GOAL;
  document.getElementById("goalCharInput").value = DEFAULT_CHAR_GOAL;

  
  // ===================================
  // 📚 BOOK IMPORT (manifest-based)
  // ===================================
  // Notes:
  // - Static hosts cannot list directories. We rely on a manifest at: assets/books/index.json
  // - Loading a selection fills #bulkInput, then calls addPages() (existing behavior preserved).

  function titleFromBookId(id) {
    if (!id) return "";
    let t = String(id);
    t = t.replace(/^BOOK[_-]*/i, "");
    t = t.replace(/[_-]+/g, " ");
    t = t.replace(/([a-z])([A-Z])/g, "$1 $2");
    return t.trim().replace(/\s+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  function splitIntoPages(raw) {
    // Primary UX: users paste normal text (paragraphs separated by blank lines).
    // We also support legacy delimiters (---, "## Page X") without requiring them.
    let input = String(raw || "");
    input = input.replace(/\r\n?/g, "\n").trim();
    if (!input) return [];

    // Normalize "## Page X" into a hard delimiter
    input = input.replace(/^\s*##\s*Page\s+\d+.*$/gim, "\n\n---\n\n");

    // Split on explicit hard delimiters first.
    const hardChunks = input.split(/\n\s*---\s*\n/g);

    // Paragraph splitting (blank lines) + fallback for single-newline paragraphs.
    const out = [];

    const startsNewParagraph = (prevLine, nextLine) => {
      if (!prevLine || !nextLine) return false;
      const prevEndsSentence = /[.!?\"”']\s*$/.test(prevLine.trim());
      const nextStartsPara = /^[A-Z0-9“"'\(\[]/.test(nextLine.trim());
      return prevEndsSentence && nextStartsPara;
    };

    for (const hc of hardChunks) {
      const chunk = String(hc || "").trim();
      if (!chunk) continue;

      // 1) Normal: blank-line-separated paragraphs.
      let paras = chunk.split(/\n\s*\n+/g).map(s => s.trim()).filter(Boolean);

      // 2) Fallback: single newlines between paragraphs (common when copying from web).
      if (paras.length <= 1 && /\n/.test(chunk)) {
        const lines = chunk.split(/\n+/).map(l => l.trimEnd());
        const tmp = [];
        let buf = [];
        for (let i = 0; i < lines.length; i++) {
          const line = (lines[i] || "").trim();
          if (!line) continue;
          if (/^[#—]/.test(line)) continue;
          buf.push(line);
          const next = (lines[i + 1] || "").trim();
          if (startsNewParagraph(line, next)) {
            tmp.push(buf.join(" ").replace(/\s+/g, " ").trim());
            buf = [];
          }
        }
        if (buf.length) tmp.push(buf.join(" ").replace(/\s+/g, " ").trim());
        if (tmp.length > 1) paras = tmp;
      }

      for (const p of paras) {
        const cleaned = p
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !/^[#—]/.test(l))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (cleaned) out.push(cleaned);
      }
    }

    return out;
  }

  function parseChaptersFromMarkdown(raw) {
    const text = String(raw || "");
    const lines = text.split(/\r?\n/);

    const chapters = [];
    let current = null;

    function pushCurrent() {
      if (!current) return;
      const rawText = current.rawLines.join("\n").trim();
      if (rawText) chapters.push({ title: current.title, raw: rawText });
    }

    for (const line of lines) {
      // H1 headings define chapters
      const h1 = line.match(/^\s{0,3}#\s+(.*)\s*$/);
      if (h1) {
        pushCurrent();
        const title = (h1[1] || "").trim() || `Chapter ${chapters.length + 1}`;
        current = { title, rawLines: [] };
        continue;
      }

      // Everything else belongs to the current chapter (or implicit intro)
      if (!current) current = { title: "Introduction", rawLines: [] };
      current.rawLines.push(line);
    }

    pushCurrent();
    return chapters;
  }

  async function initBookImporter() {
    const sourceSel = document.getElementById("importSource");
    const bookControls = document.getElementById("bookControls");
    const textControls = document.getElementById("textControls");
    const bookSelect = document.getElementById("bookSelect");
    const chapterControls = document.getElementById("chapterControls");
    const chapterSelect = document.getElementById("chapterSelect");
    const pageControls = document.getElementById("pageControls");
    const pageStart = document.getElementById("pageStart");
    const pageEnd = document.getElementById("pageEnd");
    const loadBtn = document.getElementById("loadBookSelection");
    const appendBtn = document.getElementById("appendBookSelection");
    const bulkInput = document.getElementById("bulkInput");

    if (!sourceSel || !bookControls || !bookSelect || !chapterControls || !chapterSelect || !pageControls || !pageStart || !pageEnd || !loadBtn || !appendBtn || !bulkInput) {
      console.warn("Book importer: missing required elements");
      return;
    }

    let manifest = [];
    let currentBookRaw = "";
    let hasExplicitChapters = false;

    // When chapters exist, we keep chapter pages in memory
    let chapterList = []; // {title, raw}
    let currentPages = []; // [{title, text}]
    let currentChapterIndex = null;

    function setSourceUI() {
      const isBook = sourceSel.value === "book";
      bookControls.style.display = isBook ? "flex" : "none";
      if (textControls) textControls.style.display = isBook ? "none" : "block";

      // UX: "Add Pages" only makes sense for ad-hoc Text input.
      // For Books, allowing out-of-order appends adds confusion with no value.
      if (appendBtn) appendBtn.style.display = isBook ? "none" : "inline-block";
    }

    function countExplicitH1(text) {
      const lines = String(text || "").split(/\r?\n/);
      let count = 0;
      for (const line of lines) if (/^\s{0,3}#\s+/.test(line)) count++;
      return count;
    }

    function parsePagesWithTitles(raw) {
      const text = String(raw || "");
      const lines = text.split(/\r?\n/);

      const pages = [];
      let cur = null;

      function push() {
        if (!cur) return;
        const cleaned = cur.lines
          .map(l => l.trim())
          .filter(l => l && !/^\s{0,3}#{1,6}\s+/.test(l) && !/^\s*[—-]{2,}\s*$/.test(l));

        const body = cleaned.join(" ").trim();
        if (body) pages.push({ title: cur.title, text: body });
      }

      for (const line of lines) {
        const h2 = line.match(/^\s{0,3}##\s+(.*)\s*$/);
        if (h2) {
          push();
          const title = (h2[1] || "").trim() || `Page ${pages.length + 1}`;
          cur = { title, lines: [] };
          continue;
        }
        if (!cur) cur = { title: "Page 1", lines: [] };
        cur.lines.push(line);
      }
      push();

      // Fallback: if no H2 pages were detected, try --- separators
      if (pages.length <= 1) {
        const blocks = String(raw || "").trim().split(/\n---\n/g);
        if (blocks.length > 1) {
          const out = [];
          blocks.forEach((blk, i) => {
            const cleaned = blk.split(/\r?\n/)
              .map(l => l.trim())
              .filter(l => l && !/^\s{0,3}#{1,6}\s+/.test(l) && !/^\s*[—-]{2,}\s*$/.test(l));
            const body = cleaned.join(" ").trim();
            if (body) out.push({ title: `Page ${out.length + 1}`, text: body });
          });
          return out.length ? out : pages;
        }
      }

      
  // If the user didn't use explicit separators (--- / ## Page X), fall back to a
  // "paragraph pages" heuristic: blocks separated by one-or-more blank lines.
  // This matches typical copy/paste behavior (news articles, essays, etc.).
  const usedExplicitSeparators = /\n\s*---\s*\n/.test(raw) || /^\s*##\s*Page\s+\d+/im.test(raw);
  if (!usedExplicitSeparators) {
    const blocks = raw
      .replace(/\r\n?/g, "\n")
      .split(/\n\s*\n+/)
      .map(b => b.trim())
      .filter(Boolean);

    // If we got multiple blocks, treat each as a page.
    if (blocks.length > 1) {
      pages = blocks.map((b, i) => ({
        title: `Page ${i + 1}`,
        text: b.replace(/\s+/g, " ").trim()
      }));
    }
  }

  return pages;
    }

    function setSelectOptions(selectEl, options, placeholder) {
      selectEl.innerHTML = "";
      if (placeholder) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = placeholder;
        selectEl.appendChild(opt);
      }
      options.forEach((o) => {
        const opt = document.createElement("option");
        opt.value = String(o.value);
        opt.textContent = o.label;
        selectEl.appendChild(opt);
      });
    }

    function populatePagesSelect(pages) {
      currentPages = pages || [];
      if (!currentPages.length) {
        setSelectOptions(pageStart, [], "No pages detected");
        setSelectOptions(pageEnd, [], "No pages detected");
        return;
      }

      const opts = currentPages.map((p, idx) => ({
        value: idx,
        label: `${idx + 1}. ${p.title || `Page ${idx + 1}`}`
      }));

      setSelectOptions(pageStart, opts, "Start page…");
      setSelectOptions(pageEnd, opts, "End page…");

      // Default to full range
      pageStart.value = "0";
      pageEnd.value = String(currentPages.length - 1);
    }

    function getCurrentChapterRaw() {
      if (hasExplicitChapters && Number.isFinite(currentChapterIndex) && chapterList[currentChapterIndex]) {
        return chapterList[currentChapterIndex].raw;
      }
      return currentBookRaw;
    }

    function refreshChapterAndPagesUI() {
      // Chapters present?
      if (!hasExplicitChapters) {
        chapterControls.style.display = "none";
        currentChapterIndex = null;
        const pages = parsePagesWithTitles(currentBookRaw);
        populatePagesSelect(pages);
        return;
      }

      chapterControls.style.display = "flex";
      const chapOpts = chapterList.map((ch, idx) => ({ value: idx, label: ch.title || `Chapter ${idx + 1}` }));
      setSelectOptions(chapterSelect, chapOpts, "Select a chapter…");
      chapterSelect.value = "0";
      currentChapterIndex = 0;

      const pages = parsePagesWithTitles(getCurrentChapterRaw());
      populatePagesSelect(pages);
    }

    async function loadManifest() {
      const candidates = [
        "assets/books/index.json",
        "index.json"
      ];

      let lastErr = null;
      for (const path of candidates) {
        try {
          const res = await fetch(path, { cache: "no-cache" });
          if (!res.ok) throw new Error(`manifest fetch failed (${res.status}) at ${path}`);
          const data = await res.json();
          manifest = (Array.isArray(data) ? data : []).map((b) => {
            const id = b.id || b.name || "";
            const p = b.path || (id ? `assets/books/${id}.md` : "");
            const title = b.title || titleFromBookId(id) || id || "Untitled";
            return { id, title, path: p };
          }).filter(b => b.id && b.path);

          return;
        } catch (e) {
          lastErr = e;
        }
      }
      // Fallback for local file:// usage (fetch is often blocked). If an embedded manifest exists, use it.
      try {
        if (window.EMBED_MANIFEST && Array.isArray(window.EMBED_MANIFEST)) {
          const data = window.EMBED_MANIFEST;
          manifest = (Array.isArray(data) ? data : []).map((b) => {
            const id = b.id || b.name || "";
            const p = b.path || (id ? `assets/books/${id}.md` : "");
            const title = b.title || titleFromBookId(id) || id || "Untitled";
            return { id, title, path: p };
          }).filter(b => b.id && b.path);
          return;
        }
      } catch (_) {}
      throw lastErr || new Error("manifest fetch failed");
    }

    async function loadBook(id) {
      currentBookRaw = "";
      chapterList = [];
      hasExplicitChapters = false;
      currentChapterIndex = null;

      setSelectOptions(chapterSelect, [], "Loading…");
      setSelectOptions(pageStart, [], "Loading…");
      setSelectOptions(pageEnd, [], "Loading…");

      const entry = manifest.find(b => b.id === id);
      if (!entry) {
        setSelectOptions(chapterSelect, [], "Select a book first");
        setSelectOptions(pageStart, [], "Select a book first");
        setSelectOptions(pageEnd, [], "Select a book first");
        return;
      }

      try {
        const res = await fetch(entry.path, { cache: "no-cache" });
        if (!res.ok) throw new Error(`book fetch failed (${res.status}) at ${entry.path}`);
        currentBookRaw = await res.text();

        hasExplicitChapters = countExplicitH1(currentBookRaw) > 0;
        if (hasExplicitChapters) {
          chapterList = parseChaptersFromMarkdown(currentBookRaw);
        }

        refreshChapterAndPagesUI();
      } catch (e) {
        // Fallback for local file:// usage: try embedded books
        try {
          if (window.EMBED_BOOKS && typeof window.EMBED_BOOKS[id] === "string") {
            currentBookRaw = window.EMBED_BOOKS[id];
            hasExplicitChapters = countExplicitH1(currentBookRaw) > 0;
            if (hasExplicitChapters) {
              chapterList = parseChaptersFromMarkdown(currentBookRaw);
            }
            refreshChapterAndPagesUI();
            return;
          }
        } catch (_) {}

        setSelectOptions(chapterSelect, [], "Failed to load book");
        setSelectOptions(pageStart, [], "Failed to load book");
        setSelectOptions(pageEnd, [], "Failed to load book");
        console.error("Book load error:", e);
      }
    }

    function applySelectionToBulkInput(text, { append = false } = {}) {
      bulkInput.value = String(text || "").trim();
      if (append) appendPages();
      else addPages();
    }

    // Events
    sourceSel.addEventListener("change", setSourceUI);
    setSourceUI();

    bookSelect.addEventListener("change", async () => {
      const id = bookSelect.value;
      if (!id) return;
      await loadBook(id);
    });

    chapterSelect.addEventListener("change", () => {
      const idx = parseInt(chapterSelect.value || "", 10);
      if (!Number.isFinite(idx)) return;
      currentChapterIndex = idx;
      const pages = parsePagesWithTitles(getCurrentChapterRaw());
      populatePagesSelect(pages);
    });

    // Keep end >= start
    pageStart.addEventListener("change", () => {
      const s = parseInt(pageStart.value || "0", 10);
      const e = parseInt(pageEnd.value || "0", 10);
      if (Number.isFinite(s) && Number.isFinite(e) && e < s) pageEnd.value = String(s);
    });
    pageEnd.addEventListener("change", () => {
      const s = parseInt(pageStart.value || "0", 10);
      const e = parseInt(pageEnd.value || "0", 10);
      if (Number.isFinite(s) && Number.isFinite(e) && e < s) pageStart.value = String(e);
    });

    loadBtn.addEventListener("click", () => {
      // Dual-purpose button: in Text mode, it just loads pages from the textarea.
      if (sourceSel.value === "text") {
        addPages();
        return;
      }

      // Book mode: load selected book/page slice into the textarea, then add pages.
      if (!currentBookRaw) return;
      if (!currentPages.length) return;

      const s = Math.max(0, parseInt(pageStart.value || "0", 10));
      const e = Math.max(s, parseInt(pageEnd.value || String(s), 10));

      const slice = currentPages
        .slice(s, e + 1)
        .map((p) => p.text)
        .filter(Boolean);
      // Keep delimiter in a single JS string line (prevents accidental raw-newline parse errors)
      applySelectionToBulkInput(slice.join("\n---\n"), { append: false });
    });

    appendBtn.addEventListener("click", () => {
      // Dual-purpose button: in Text mode, append from textarea.
      if (sourceSel.value === "text") {
        appendPages();
        return;
      }

      // Book mode: append selected slice.
      if (!currentBookRaw) return;
      if (!currentPages.length) return;

      const s = Math.max(0, parseInt(pageStart.value || "0", 10));
      const e = Math.max(s, parseInt(pageEnd.value || String(s), 10));

      const slice = currentPages
        .slice(s, e + 1)
        .map((p) => p.text)
        .filter(Boolean);

      applySelectionToBulkInput(slice.join("\n---\n"), { append: true });
    });

    try {
      await loadManifest();
      // Populate book select
      bookSelect.innerHTML = "";
      if (manifest.length === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No books found";
        bookSelect.appendChild(opt);
        return;
      }
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select a book…";
      bookSelect.appendChild(placeholder);

      manifest.forEach((b) => {
        const opt = document.createElement("option");
        opt.value = b.id;
        opt.textContent = b.title;
        bookSelect.appendChild(opt);
      });
    } catch (e) {
      bookSelect.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Failed to load manifest";
      bookSelect.appendChild(opt);
      console.error("Book manifest load error:", e);
    }
  }



  async function addPages() {
    const input = document.getElementById("bulkInput").value;
    goalTime = parseInt(document.getElementById("goalTimeInput").value);
    goalCharCount = parseInt(document.getElementById("goalCharInput").value);
    if (!input || !input.trim()) return;

    // UX rule: whenever user generates new pages, start fresh (no leftover pages)
    if (pages.length > 0) resetSession({ confirm: false });

    // Split pasted text into pages using paragraph breaks (blank lines).
    // Still supports legacy delimiters (--- / "## Page X") if present.
    const newPages = splitIntoPages(input);
    for (const pageText of newPages) {
      const pageHash = await stableHashText(pageText);
      let consolidation = "";
      let rating = 0;
      let isSandstone = false;
      let aiExpanded = false;
      let aiFeedbackRaw = "";
      let aiAt = null;
      let aiRating = null;
      try {
        const rawC = localStorage.getItem(getConsolidationCacheKey(pageHash));
        if (rawC) {
          const rec = JSON.parse(rawC);
          if (rec && typeof rec.consolidation === 'string') consolidation = rec.consolidation;
          const r = Number(rec?.rating || 0);
          rating = Number.isFinite(r) ? r : 0;
          isSandstone = !!rec?.isSandstone;
          aiExpanded = !!rec?.aiExpanded;
          aiFeedbackRaw = typeof rec?.aiFeedbackRaw === 'string' ? rec.aiFeedbackRaw : "";
          aiAt = rec?.aiAt ?? null;
          aiRating = rec?.aiRating ?? null;
        }
      } catch (_) {}

      pages.push(pageText);
      pageData.push({
        text: pageText,
        consolidation,
        aiExpanded,
        aiFeedbackRaw,
        aiAt,
        aiRating,
        charCount: (consolidation || "").length,
        completedOnTime: true, // Assume true until sandstoned
        isSandstone,
        rating,
        // Anchors
        pageHash,
        anchors: null,
        anchorVersion: 0,
        anchorsMeta: null
      });
    }

    document.getElementById("bulkInput").value = "";
    schedulePersistSession();
    render();
    checkSubmitButton();
  }

  // Append pages to the existing session (does NOT clear pages/timers/ratings).
  // Uses the same splitting rules as addPages().
  async function appendPages() {
    const input = document.getElementById("bulkInput").value;
    goalTime = parseInt(document.getElementById("goalTimeInput").value);
    goalCharCount = parseInt(document.getElementById("goalCharInput").value);
    if (!input || !input.trim()) return;

    const newPages = splitIntoPages(input);
    for (const pageText of newPages) {
      const pageHash = await stableHashText(pageText);
      let consolidation = "";
      let rating = 0;
      let isSandstone = false;
      let aiExpanded = false;
      let aiFeedbackRaw = "";
      let aiAt = null;
      let aiRating = null;
      try {
        const rawC = localStorage.getItem(getConsolidationCacheKey(pageHash));
        if (rawC) {
          const rec = JSON.parse(rawC);
          if (rec && typeof rec.consolidation === 'string') consolidation = rec.consolidation;
          const r = Number(rec?.rating || 0);
          rating = Number.isFinite(r) ? r : 0;
          isSandstone = !!rec?.isSandstone;
          aiExpanded = !!rec?.aiExpanded;
          aiFeedbackRaw = typeof rec?.aiFeedbackRaw === 'string' ? rec.aiFeedbackRaw : "";
          aiAt = rec?.aiAt ?? null;
          aiRating = rec?.aiRating ?? null;
        }
      } catch (_) {}

      pages.push(pageText);
      pageData.push({
        text: pageText,
        consolidation,
        aiExpanded,
        aiFeedbackRaw,
        aiAt,
        aiRating,
        charCount: (consolidation || "").length,
        completedOnTime: true,
        isSandstone,
        rating,
        // Anchors
        pageHash,
        anchors: null,
        anchorVersion: 0,
        anchorsMeta: null
      });
    }

    document.getElementById("bulkInput").value = "";
    render();
    checkSubmitButton();
  }

  function resetSession({ confirm = true, clearPersistedWork = false, clearAnchors = false } = {}) {
    if (confirm && !window.confirm("Clear all pages, consolidations, and timers?")) return false;

    if (clearPersistedWork) {
      clearPersistedWorkForPageHashes(pageData.map(p => p?.pageHash), { clearAnchors });
    }
    pages = [];
    pageData = [];
    timers = [];
    intervals.forEach(i => clearInterval(i));
    intervals = [];
    sandSound.pause();
    document.getElementById("pages").innerHTML = "";
    document.getElementById("submitBtn").disabled = true;
    document.getElementById("verdictSection").style.display = "none";
    lastFocusedPageIndex = -1;
    evaluationPhase = false;
    clearPersistedSession();
    return true;
  }

  function render() {
    const container = document.getElementById("pages");
    container.innerHTML = "";

    pages.forEach((text, i) => {
      timers[i] ??= 0;

      const page = document.createElement("div");
      page.className = "page";
      page.dataset.pageIndex = String(i);

      page.innerHTML = `
        <div class="page-header">Page ${i + 1}</div>
        <div class="page-text">${escapeHtml(text)}</div>

        <div class="anchors-row">
          <div class="anchors-ui anchors-ui--right">
            <div class="anchors-counter" title="Anchors">Anchors Found: 0/0</div>
            <button type="button" class="top-btn hint-btn" disabled>Hint</button>
          </div>
        </div>

        <div class="page-header">Consolidation</div>

        <div class="sand-wrapper">
          <textarea placeholder="What was this page really about?"></textarea>
          <div class="sand-layer"></div>
        </div>

        <div class="info-row">
          <div class="counter-section">
            <div class="timer">Timer: ${timers[i]} / ${goalTime}</div>
            <div class="char-counter">Characters: <span class="char-count">0</span> / ${goalCharCount}</div></div>

          <div class="evaluation-section">
            <div class="evaluation-label">Evaluation</div>
            <div class="stars locked" data-page="${i}">
              <span class="star" data-value="1">🧭</span>
              <span class="star" data-value="2">🧭</span>
              <span class="star" data-value="3">🧭</span>
              <span class="star" data-value="4">🧭</span>
              <span class="star" data-value="5">🧭</span>
            </div>
          </div>

          <div class="action-buttons">
            <button class="top-btn" onclick="goToNext()">▶ Next</button>
            <button class="ai-btn" data-page="${i}" style="display: none;">▼ AI Evaluate&nbsp;&nbsp;</button>
          </div>
        </div>
        
        <div class="ai-feedback" data-page="${i}" style="display: none;">
          <!-- AI feedback will be inserted here -->
        </div>
      `;

      const textarea = page.querySelector("textarea");
      const sand = page.querySelector(".sand-layer");
      const timerDiv = page.querySelector(".timer");
      const wrapper = page.querySelector(".sand-wrapper");
      const charCountSpan = page.querySelector(".char-count");
      const starsDiv = page.querySelector(".evaluation-section .stars");

      // Character tracking
      textarea.value = pageData[i].consolidation || "";
      charCountSpan.textContent = Math.min(pageData[i].charCount, goalCharCount);
      
      textarea.addEventListener("input", (e) => {
        const count = e.target.value.length;
        pageData[i].consolidation = e.target.value;
        pageData[i].charCount = count;
        charCountSpan.textContent = Math.min(count, goalCharCount);

        // Anchors: deterministic matching (UI-only; no inference).
        updateAnchorsUIForPage(page, i, e.target.value);
        
        // Check if all pages have text to unlock compasses
        checkCompassUnlock();
      });

      // Persist learner work when they leave the field (reduces churn while typing).
      textarea.addEventListener("blur", () => {
        schedulePersistSession();
      });

      // Clicking anywhere on the page should make "Next" advance from that page.
      page.addEventListener("pointerdown", () => {
        lastFocusedPageIndex = i;
      });

      // Timer events
      textarea.addEventListener("focus", () => {
        
        lastFocusedPageIndex = i;
// Scroll to show entire page card (passage + textarea) instead of centering on textarea
        const pageCard = textarea.closest('.page');
        pageCard.scrollIntoView({ 
          behavior: 'instant',
          block: 'start',
          inline: 'nearest'
        });
        
        // Page turn immersion: activate stripe if starting fresh
        if (pageData[i].charCount === 0) {
          page.classList.add('page-active');
          if (!allSoundsMuted) {
            pageTurnSound.currentTime = 0;
            pageTurnSound.play();
          }
        }
        startTimer(i, sand, timerDiv, wrapper, textarea);
      });
      
      textarea.addEventListener("blur", () => {
        // Deactivate page stripe when leaving
        page.classList.remove('page-active');
        stopTimer(i);
        checkCompassUnlock(); // Check if compasses should unlock when user leaves textarea
      });


      // Keyboard navigation (iPad + desktop)
      textarea.addEventListener("keydown", (e) => {
        // Enter: unfocus textarea (Shift+Enter remains normal newline behavior)
        // This makes iPad flow smoother: user can hit Enter to dismiss keyboard,
        // then press Enter again (global) to jump to next box or click AI.
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          // Prevent the global Enter handler from running in the same event.
          // (blur changes activeElement, which would otherwise trigger goToNext).
          e.stopPropagation();
          textarea.blur();
          return;
        }

        // Esc: unfocus textarea
        if (e.key === "Escape") {
          e.preventDefault();
          textarea.blur();
        }
      });

      // Compass click handlers
      const stars = starsDiv.querySelectorAll(".star");
      stars.forEach(star => {
        star.addEventListener("click", () => {
          if (starsDiv.classList.contains("locked")) return;
          const value = parseInt(star.dataset.value);
          setRating(i, value, stars);
        });
      });
      
      // AI button click handler
      const aiBtn = page.querySelector(".ai-btn");
      if (aiBtn) {
        aiBtn.addEventListener("click", () => evaluatePageWithAI(i));
      }

      // Restore AI panel visibility + content if it was previously opened.
      // (User-facing state; persisted per pageHash.)
      const feedbackDiv = page.querySelector(`.ai-feedback[data-page="${i}"]`);
      if (aiBtn && feedbackDiv) {
        const hasFeedback = String(pageData[i]?.aiFeedbackRaw || '').trim().length > 0;
        if (hasFeedback) {
          // Ensure the button is available if there is saved feedback.
          aiBtn.style.display = 'block';
          // If the panel is expanded, show it and rebuild the formatted UI.
          if (pageData[i]?.aiExpanded) {
            feedbackDiv.style.display = 'block';
            aiBtn.textContent = '▲ AI Evaluate';
            // Rehydrate the formatted view from persisted raw feedback.
            displayAIFeedback(i, pageData[i].aiFeedbackRaw, null);
          } else {
            feedbackDiv.style.display = 'none';
            aiBtn.textContent = '▼ AI Evaluate';
          }
        }
      }
      
      // Restore previous rating if exists
      if (pageData[i].rating > 0) {
        const evalStars = starsDiv.querySelectorAll(".star");
        evalStars.forEach((star, starIdx) => {
          if (starIdx < pageData[i].rating) {
            star.classList.add("filled");
          }
        });
        // Stop animation since this page is already rated
        starsDiv.classList.add('rated');
      }
      
      // Restore sandstone state if applicable
      if (pageData[i].isSandstone) {
        wrapper.classList.add("sandstone");
        textarea.readOnly = true;
        const evalStars = page.querySelector(".evaluation-section .stars");
        evalStars.classList.add("locked");
        evalStars.style.opacity = "0.15";
        sand.style.height = "100%";
      } else if (timers[i] > 0) {
        // Restore partial sand if timer was running
        const sandStartTime = goalTime * (1 - SAND_START_PERCENTAGE);
	const sandDuration = goalTime * SAND_START_PERCENTAGE;
        if (timers[i] >= sandStartTime) {
          const sandElapsed = timers[i] - sandStartTime;
          const pct = Math.min(sandElapsed / sandDuration, 1);
          sand.style.height = `${pct * 100}%`;
        }
      }

      container.appendChild(page);

      // Anchors: bind hint button and hydrate anchors asynchronously (with local cache).
      bindHintButton(page, i);
      // Always start with plain text (safe), then wrap quotes once anchors are available.
      // If this page already has anchors cached in pageData, hydrate will apply immediately.
      hydrateAnchorsIntoPageEl(page, i);

    });
    
    // Check states after rendering
    checkCompassUnlock();
    checkSubmitButton();
  }

  function startTimer(i, sand, timerDiv, wrapper, textarea) {
    if (intervals[i]) return;

    let sandSoundStarted = false;

    intervals[i] = setInterval(() => {
      timers[i]++;
      
      // Sand starts when configured percentage of time remains
      const sandStartTime = goalTime * (1 - SAND_START_PERCENTAGE);
      const sandDuration = goalTime * SAND_START_PERCENTAGE;
      
      if (timers[i] >= sandStartTime) {
        // Start sand sound when sand starts (if not muted)
        if (!sandSoundStarted) {
          sandSound.currentTime = 0;
          if (!allSoundsMuted) {
            if (window.playSfx) window.playSfx(sandSound, { restart: true, loop: true, retries: 3, delay: 120 });
            else sandSound.play();
          }
          sandSoundStarted = true;
        }
        
        const sandElapsed = timers[i] - sandStartTime;
        const pct = Math.min(sandElapsed / sandDuration, 1);
        sand.style.height = `${pct * 100}%`;
      }
      
      timerDiv.textContent = `Timer: ${timers[i]} / ${goalTime}`;

      if (timers[i] >= goalTime) {
        clearInterval(intervals[i]);
        intervals[i] = null;

        sandSound.pause();
        if (!allSoundsMuted) {
          stoneSound.currentTime = 0;
          if (window.playSfx) window.playSfx(stoneSound, { restart: true, loop: false, retries: 4, delay: 160 });
          else stoneSound.play();
        }

        wrapper.classList.add("sandstone");
        textarea.readOnly = true;
        textarea.blur();
        
        // Mark page as sandstoned and failed timing
        pageData[i].isSandstone = true;
        pageData[i].completedOnTime = false;
        pageData[i].editedAt = Date.now();
        
        // Block compasses on this page permanently
        const starsDiv = wrapper.closest(".page").querySelector(".evaluation-section .stars");
        starsDiv.classList.add("locked");
        starsDiv.style.opacity = "0.15";
        
        checkSubmitButton();
        schedulePersistSession();
      }
    }, 1000);
  }

  function stopTimer(i) {
    clearInterval(intervals[i]);
    intervals[i] = null;
    sandSound.pause();
  }

  /**
   * Clear Session
   * - Keeps loaded pages.
   * - Clears learner work (consolidations + AI feedback) for the currently loaded pages.
   * - By default, keeps anchors (fast reload); toggle if you want to invalidate old anchors.
   */
  function clearSession() {
    if (!pageData.length) return;

    const ALSO_CLEAR_ANCHORS = false;

    for (let i = 0; i < pageData.length; i++) {
      const p = pageData[i];
      p.consolidation = '';
      p.charCount = 0;
      p.completedOnTime = true;
      p.isSandstone = false;
      p.rating = 0;
      p.aiExpanded = false;
      p.aiFeedbackRaw = '';
      p.aiAt = null;
      p.aiRating = null;
      p.editedAt = Date.now();
      if (ALSO_CLEAR_ANCHORS) {
        p.anchors = null;
        p.anchorsMeta = null;
      }
    }

    if (ALSO_CLEAR_ANCHORS) {
      try { inMemoryAnchorsCache = Object.create(null); } catch (_) {}
    }

    // Clear persisted learner consolidations for currently loaded pages.
    clearPersistedWorkForPageHashes(pageData.map(p => p?.pageHash), { clearAnchors: ALSO_CLEAR_ANCHORS });

    schedulePersistSession();
    render();
  }

  // ===================================
  // 🧭 COMPASS & SUBMISSION LOGIC
  // ===================================
  
  function checkCompassUnlock() {
    // UX rule:
    // - Allow AI feedback page-by-page (show AI button once that page has text)
    // - Do NOT allow compass rating until ALL pages have at least 1 character AND no textarea is focused
    const allHaveText = pageData.every(p => p.isSandstone || p.charCount > 0);
    const noTextareaFocused = document.activeElement.tagName !== 'TEXTAREA';

    const allPages = document.querySelectorAll(".page");
    allPages.forEach((pageEl, i) => {
      const aiBtn = pageEl.querySelector(".ai-btn");
      if (aiBtn) {
        const canShowAI = !pageData[i]?.isSandstone && (pageData[i]?.charCount || 0) > 0;
        aiBtn.style.display = canShowAI ? 'block' : 'none';
      }
    });

    // Track phase so navigation can behave differently.
    evaluationPhase = !!(allHaveText && noTextareaFocused);

    if (!evaluationPhase) return;

    let anyUnlocked = false;
    allPages.forEach((pageEl, i) => {
      const starsDiv = pageEl.querySelector(".stars");
      const evalSection = pageEl.querySelector(".evaluation-section");
      if (!pageData[i].isSandstone && starsDiv) {
        starsDiv.classList.remove("locked");
        if (!starsDiv.classList.contains('rated') && evalSection) {
          evalSection.classList.add('ready');
          anyUnlocked = true;
        }

        // If this page already has an AI response rendered, enabling compasses
        // should also enable the "Use This Rating" button.
        updateUseRatingButtons(i);
      }
    });

    if (anyUnlocked && !allSoundsMuted) {
      evaluateSound.currentTime = 0;
      if (window.playSfx) window.playSfx(evaluateSound, { restart: true, loop: false, retries: 2, delay: 120 });
      else evaluateSound.play();
    }
  }

  // "Use This Rating" should only be clickable once the page is in Evaluation stage.
  function canUseAIRating(pageIndex) {
    const pageEl = document.querySelectorAll('.page')[pageIndex];
    if (!pageEl) return false;
    if (pageData?.[pageIndex]?.isSandstone) return false;
    const starsDiv = pageEl.querySelector('.evaluation-section .stars');
    const evalSection = pageEl.querySelector('.evaluation-section');
    if (!starsDiv || !evalSection) return false;
    return !starsDiv.classList.contains('locked') && evalSection.classList.contains('ready');
  }

  function updateUseRatingButtons(pageIndex) {
    const feedbackDiv = document.querySelector(`.ai-feedback[data-page="${pageIndex}"]`);
    if (!feedbackDiv) return;
    const useBtn = feedbackDiv.querySelector('.use-rating-btn');
    if (!useBtn) return;
    const rating = Number(useBtn.getAttribute('data-rating') || '0');
    const enabled = rating > 0 && canUseAIRating(pageIndex);
    useBtn.disabled = !enabled;
    useBtn.title = enabled ? '' : 'Locked until Evaluation stage.';
  }

  function scrollToTop() {
    const firstPage = document.querySelector('.page');
    if (firstPage) {
      firstPage.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  }

  function goToNext(currentIndex) {
    // Navigation rules:
    // - Consolidation phase: focus the next editable textarea.
    // - Evaluation phase: DO NOT focus the textarea; scroll to the next page block instead.
    // currentIndex is the page index the user is "on" (0-based). Use -1 to start from the beginning.

    // If no explicit index was provided, try to advance from the page the user was interacting with.
    if (typeof currentIndex !== "number") {
      currentIndex = lastFocusedPageIndex;
      if (currentIndex < 0) currentIndex = inferCurrentPageIndex();
    }

    // Keep phase flag up to date (especially when called from buttons).
    checkCompassUnlock();

    const pageEls = document.querySelectorAll('.page');

    if (evaluationPhase) {
      // Scroll to the next page, or wrap to top.
      const nextIdx = (pageEls.length > 0) ? ((currentIndex + 1) % pageEls.length) : 0;
      const target = pageEls[nextIdx];
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        scrollToTop();
      }
      // Ensure no textarea gets auto-focused.
      const active = document.activeElement;
      if (active && active.tagName === 'TEXTAREA') active.blur();
      return;
    }

    // Consolidation phase: focus the next editable textarea.
    const textareas = document.querySelectorAll('.page textarea');
    for (let j = currentIndex + 1; j < textareas.length; j++) {
      const ta = textareas[j];
      if (ta && !ta.readOnly && !ta.disabled) {
        ta.focus();
        return;
      }
    }

    // none remain → force unlock sequence
    const active = document.activeElement;
    if (active && active.tagName === "TEXTAREA") active.blur();
    checkCompassUnlock();
    scrollToTop();
  }

  // Global keyboard navigation:
  // - Enter (when not in a textarea): go to next consolidation box
  // - Esc (when in a textarea): unfocus textarea
  document.addEventListener("keydown", (e) => {
    // Esc handled per-textarea; this is a backup for cases where focus is on something else.
    if (e.key === "Escape") {
      const active = document.activeElement;
      if (active && active.tagName === "TEXTAREA") {
        e.preventDefault();
        active.blur();
      }
      return;
    }

    if (e.key !== "Enter" || e.shiftKey) return;

    const active = document.activeElement;
    if (active && active.tagName === "TEXTAREA") return;

    e.preventDefault();

    // If user has never focused a page yet, treat as start
    const startIndex = (lastFocusedPageIndex === -1) ? -1 : lastFocusedPageIndex;
    goToNext(startIndex);

  });



  async function evaluatePageWithAI(pageIndex) {
    const aiBtn = document.querySelector(`.ai-btn[data-page="${pageIndex}"]`);
    const feedbackDiv = document.querySelector(`.ai-feedback[data-page="${pageIndex}"]`);
    if (!aiBtn || !feedbackDiv) return;

    // Toggle if already open
    if (feedbackDiv.style.display === 'block') {
      feedbackDiv.style.display = 'none';
      aiBtn.textContent = '▼ AI Evaluate';
      if (pageData?.[pageIndex]) {
        pageData[pageIndex].aiExpanded = false;
        schedulePersistSession();
      }
      return;
    }

    aiBtn.textContent = '⏳ Loading...';
    aiBtn.classList.add('loading');
    feedbackDiv.style.display = 'block';
    feedbackDiv.innerHTML = '<div style="text-align: center; opacity: 0.6;">Analyzing...</div>';

    if (pageData?.[pageIndex]) {
      pageData[pageIndex].aiExpanded = true;
      schedulePersistSession();
    }

    const page = pageData[pageIndex];
    const pageElement = document.querySelectorAll('.page')[pageIndex];
    const passageText = pageElement.querySelector('.page-text').textContent;
    const userText = page?.consolidation || "";

    // Diagnostics flag (URL): when enabled, the API returns extra debug fields that are
    // stored only in lastAIDiagnostics (never rendered into the normal UI).
    const debugEnabled = isDebugEnabledFromUrl();

    const MAX_DEBUG_CHARS = 900; // small on purpose
    const pageTextForRequest = passageText; // never alter grading input for debugging

    // Prefer anchor-owned better consolidation (from page state or cache)
    // so /api/evaluate can focus on grading instead of re-summarizing.
    // Use the same stable hash as /api/anchors so we can pull the anchor pack from memory.
    // Anchors compute pageHash via: await sha256HexBrowser(pageText)
    const pageHashForEval = (page && page.pageHash)
      ? page.pageHash
      : await sha256HexBrowser(pageTextForRequest);
    // Anchor packs are cached in localStorage (see readAnchorsFromCache/writeAnchorsToCache).
    // Use that canonical cache here rather than a separate in-memory map.
    const cachedAnchorPack = readAnchorsFromCache(pageHashForEval);

    const requestPayload = {
      pageText: pageTextForRequest,
      userText,
      // Optional context coming from /api/anchors. This is stable, page-level, and not user-dependent.
      // Evaluate generates Better consolidation itself; do not pass any page-level better consolidation from anchors.
      anchors: Array.isArray(page?.anchors) ? page.anchors : undefined,
      betterCharLimit: goalCharCount,
      bulletMaxChars: 110,
      debug: debugEnabled ? "1" : undefined
    };
    // Keep diagnostics readable without changing the actual request sent to the API.
    const diagRequest = (() => {
      if (!debugEnabled) return requestPayload;
      try {
        const clone = JSON.parse(JSON.stringify(requestPayload));
        const max = 2000; // cap stored text only (not sent)
        if (typeof clone.pageText === 'string' && clone.pageText.length > max) {
          clone.pageText = clone.pageText.slice(0, max) + `… (truncated, ${clone.pageText.length} chars total)`;
        }
        if (typeof clone.userText === 'string' && clone.userText.length > max) {
          clone.userText = clone.userText.slice(0, max) + `… (truncated, ${clone.userText.length} chars total)`;
        }
        return clone;
      } catch (_) {
        return requestPayload;
      }
    })();


    // remove undefined keys (optional)
    if (!requestPayload.debug) delete requestPayload.debug;

    try {
      const response = await fetch("https://reading-comprehension-rpwd.vercel.app/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });

      const rawText = await response.text();
      if (!response.ok) {
        lastAIDiagnostics = {
          kind: 'evaluate',
          pageIndex,
          status: response.status,
          request: diagRequest,
          responseText: rawText,
          at: new Date().toISOString()
        };
        throw new Error(rawText);
      }

      const data = JSON.parse(rawText || "{}");
      lastAIDiagnostics = {
        kind: 'evaluate',
        pageIndex,
        status: response.status,
        request: diagRequest,
        responseText: rawText,
        // If the API returned debug info, keep it out of the normal UI and only
        // expose it via the diagnostics panel.
        debug: data && data.debug ? data.debug : undefined,
        at: new Date().toISOString()
      };
      // Passage highlighting is now owned by anchors; evaluation is for rating + analysis only.
      // Evaluation should not clear existing highlights (anchors own passage highlighting).
      displayAIFeedback(pageIndex, data.feedback || "", null);

      aiBtn.textContent = '▲ AI Evaluate';
      aiBtn.classList.remove('loading');
    } catch (error) {
      console.error('AI evaluation error:', error);
      if (!lastAIDiagnostics) {
        lastAIDiagnostics = {
          kind: 'evaluate',
          pageIndex,
          status: 0,
          request: diagRequest,
          responseText: String(error?.message || error || ''),
          at: new Date().toISOString()
        };
      }
      feedbackDiv.innerHTML =
        '<div style="color: #8B2500;">Error getting AI feedback. Check console and verify AI Host is running.</div>';
      aiBtn.textContent = '▼ AI Evaluate';
      aiBtn.classList.remove('loading');

      if (pageData?.[pageIndex]) {
        pageData[pageIndex].aiExpanded = false;
        schedulePersistSession();
      }
    }
  }

  function displayAIFeedback(pageIndex, feedback, highlightSnippets = null) {
    const feedbackDiv = document.querySelector(`.ai-feedback[data-page="${pageIndex}"]`);
    if (!feedbackDiv) return;

    // Persist raw feedback so Final Summary can reuse it later.
    if (pageData?.[pageIndex]) {
      pageData[pageIndex].aiFeedbackRaw = String(feedback || "");
      pageData[pageIndex].aiAt = Date.now();
      // If we are displaying feedback, we consider the panel open.
      // (Toggling closed is handled in evaluatePageWithAI.)
      if (pageData[pageIndex].aiExpanded !== false) pageData[pageIndex].aiExpanded = true;
      if (Array.isArray(highlightSnippets)) {
        pageData[pageIndex].highlightSnippets = highlightSnippets
          .map(s => String(s || '').trim())
          .filter(Boolean);
      }
      schedulePersistSession();
    }

    // Apply yellow highlights ONLY if explicitly provided.
    // Passing null/undefined preserves existing highlights (anchors).
    if (Array.isArray(highlightSnippets)) {
      applyHighlightSnippetsToPage(pageIndex, pageData?.[pageIndex]?.highlightSnippets || []);
    }

    // Robust parsing:
    // - Works with \n or \r\n
    // - Tolerates extra lines (rare model drift)
    // - Accepts quoted or unquoted "better consolidation" line
    // - Accepts label variants: "Better consolidation:", "Example of Strong Consolidation:", "**Strong Consolidation:**"
    const rawLines = String(feedback || "")
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    // 1) Rating (🧭🧭⚪⚪⚪ (2/5))
    const ratingLine = rawLines.find(l => /[🧭⚪]+\s*\(\d\/5\)/.test(l)) || "";
    const ratingMatch = ratingLine.match(/([🧭⚪]+)\s*\((\d)\/5\)/);
    const rating = ratingMatch ? parseInt(ratingMatch[2], 10) : 0;

    // 2) Analysis: first non-rating line after the rating line
    let analysis = "";
    const ratingIdx = rawLines.indexOf(ratingLine);
    if (ratingIdx >= 0) {
      analysis = rawLines.slice(ratingIdx + 1).find(l => !/better consolidation/i.test(l) && !/strong consolidation/i.test(l)) || "";
    } else {
      analysis = rawLines[1] || "";
    }

    // 3) Better consolidation: locate label, then take remaining lines
    const labelIdx = rawLines.findIndex(l =>
      /^better consolidation\s*:?\s*$/i.test(l) ||
      /^example of strong consolidation\s*:?\s*$/i.test(l) ||
      /^\*\*strong consolidation:\*\*\s*$/i.test(l) ||
      /^strong consolidation\s*:?\s*$/i.test(l)
    );

    let betterExample = "";
    if (labelIdx >= 0) {
      const after = rawLines.slice(labelIdx + 1);
      if (after.length) betterExample = after.join(" ");

      // Strip optional surrounding quotes
      betterExample = betterExample.replace(/^"+/, "").replace(/"+$/, "").trim();

      // Strip the optional trailing "This consolidation..." sentence if included
      betterExample = betterExample.replace(/\s*This consolidation\b.*$/i, "").trim();
    } else if (rawLines.length >= 4) {
      // Back-compat: exactly 4 lines
      betterExample = rawLines[3].replace(/^"+/, "").replace(/"+$/, "").trim();
    }

    // Build HTML
    let html = '';

    if (ratingMatch) {
      html += `<div class="ai-rating">${ratingMatch[1]} <span class="ai-score">(${rating}/5)</span></div>`;
    }

    if (analysis) {
      html += `<div class="ai-analysis">${analysis}</div>`;
    }

    if (betterExample) {
      html += `<div class="better-example">
        <div class="better-label">Better consolidation:</div>
        "${betterExample}"
      </div>`;
    }

    // Actions: "Use This Rating" is disabled until the page reaches Evaluation stage.
    const useDisabled = !(rating > 0 && canUseAIRating(pageIndex));
    html += `<div class="ai-actions">`
    html += `<button class="use-rating-btn" data-rating="${rating}" ${useDisabled ? 'disabled' : ''} onclick="applyAIRating(${pageIndex}, ${rating})">Use This Rating (${rating}/5)</button>`;
    html += `<button class="next-after-ai-btn" onclick="goToNext(${pageIndex})">Next Page →</button>`;
    html += `</div>`;
    feedbackDiv.innerHTML = html;

    // In case the compass unlock happens after AI renders, keep button state synced.
    updateUseRatingButtons(pageIndex);
  }


  function applyAIRating(pageIndex, rating) {
    const starsDiv = document.querySelector(`.stars[data-page="${pageIndex}"]`);
    if (!starsDiv) return;
    
    const stars = starsDiv.querySelectorAll(".star");
    setRating(pageIndex, rating, stars);

    // UX: after accepting the AI rating, advance to the next page.
    // Exception: on the final page, do NOT wrap to the first page (keep the user in place).
    // (The dedicated Next button handles wrap-to-first.)
    const lastIndex = pageData.length - 1;
    if (pageIndex < lastIndex) {
      // In Evaluation phase this will scroll without focusing the textarea.
      goToNext(pageIndex);
    }
  }

  function setRating(pageIndex, value, stars) {
    pageData[pageIndex].rating = value;
    pageData[pageIndex].editedAt = Date.now();
    // Persist immediately-ish so refresh doesn't wipe compass work.
    schedulePersistSession();
    
    // Play compass click sound
    if (!allSoundsMuted) {
      compassSound.currentTime = 0;
      compassSound.play();
    }
    
    // Mark this compass group as rated (stops animation)
    const starsDiv = stars[0].closest('.stars');
    starsDiv.classList.add('rated');
    
    // Stop label glow animation
    const evalSection = starsDiv.closest('.evaluation-section');
    evalSection.classList.remove('ready');
    
    // Fill stars up to the clicked value
    stars.forEach((star, i) => {
      if (i < value) {
        star.classList.add("filled");
      } else {
        star.classList.remove("filled");
      }
    });
    
    checkSubmitButton();
  }

  function checkSubmitButton() {
    // Enable submit when all non-sandstone pages have been rated
    const nonSandstonePages = pageData.filter(p => !p.isSandstone);
    
    // If all pages are sandstone, enable immediately
    if (nonSandstonePages.length === 0 && pageData.length > 0) {
      document.getElementById("submitBtn").disabled = false;
      return;
    }
    
    // Otherwise check if all non-sandstone pages are rated
    const allRated = nonSandstonePages.every(p => p.rating > 0);
    document.getElementById("submitBtn").disabled = !allRated;
  }

  // ===================================
  // 📊 EVALUATION & TIER SYSTEM
  // ===================================
  
  function calculateScores() {
    const totalPages = pageData.length;
    if (totalPages === 0) return null;
    
    // 1. Comprehension Score (55 pts) - compass self-evaluation
    const nonSandstonePages = pageData.filter(p => !p.isSandstone);
    let comprehensionScore = 0;
    if (nonSandstonePages.length > 0) {
      const totalRating = nonSandstonePages.reduce((sum, p) => sum + p.rating, 0);
      const avgRating = totalRating / nonSandstonePages.length;
      comprehensionScore = (avgRating / 5) * WEIGHT_COMPREHENSION;
    }
    
    // 2. Discipline Score (25 pts) - completed on time with gradient penalty for insufficient length
    // Full credit if >= 90% of goal, proportional penalty if below
    const minChars = Math.floor(goalCharCount * (1 - COMPRESSION_TOLERANCE));
    let disciplineScore = 0;
    
    pageData.forEach(p => {
      if (!p.completedOnTime) {
        // Sandstoned: no points
        disciplineScore += 0;
      } else if (p.charCount >= minChars) {
        // Met 90% threshold: full points
        disciplineScore += WEIGHT_DISCIPLINE;
      } else {
        // Below threshold: proportional credit (0 to minChars range)
        disciplineScore += (p.charCount / minChars) * WEIGHT_DISCIPLINE;
      }
    });
    disciplineScore = disciplineScore / totalPages;
    
    // 3. Compression Score (20 pts) - character count sweet spot
    let compressionScore = 0;
    pageData.forEach(p => {
      const chars = p.charCount;
      const goal = goalCharCount;
      const sweetSpotMin = Math.floor(goal * (1 - COMPRESSION_TOLERANCE));
      const sweetSpotMax = Math.ceil(goal * (1 + COMPRESSION_TOLERANCE));
      
      if (chars < sweetSpotMin) {
        // Under sweet spot: proportional penalty
        compressionScore += (chars / goal) * WEIGHT_COMPRESSION;
      } else if (chars <= sweetSpotMax) {
        // In sweet spot: full points
        compressionScore += WEIGHT_COMPRESSION;
      } else {
        // Over sweet spot: penalty
        const overAmount = chars - sweetSpotMax;
        const penalty = (overAmount / goal) * WEIGHT_COMPRESSION;
        compressionScore += Math.max(0, WEIGHT_COMPRESSION - penalty);
      }
    });
    compressionScore = compressionScore / totalPages;
    
    const totalScore = comprehensionScore + disciplineScore + compressionScore;
    
    return {
      comprehension: Math.round(comprehensionScore * 10) / 10,
      discipline: Math.round(disciplineScore * 10) / 10,
      compression: Math.round(compressionScore * 10) / 10,
      total: Math.round(totalScore * 10) / 10
    };
  }
  
  function getTier(score) {
    for (let tier of TIERS) {
      if (score >= tier.min) return tier;
    }
    return TIERS[TIERS.length - 1]; // Fallback to lowest tier
  }
  
  function submitEvaluation() {
    const btn = document.getElementById("submitBtn");
    btn.disabled = true;
    
    // Calculate scores
    const scores = calculateScores();
    if (!scores) {
      alert("No pages to evaluate!");
      btn.disabled = false;
      return;
    }
    
    const tier = getTier(scores.total);
    const advice = getNextTierAdvice(tier.name);
    
    // Calculate session stats
    const totalPages = pageData.length;
    const sandstoned = pageData.filter(p => p.isSandstone).length;
    const avgRating = pageData.filter(p => !p.isSandstone).length > 0
      ? pageData.filter(p => !p.isSandstone).reduce((sum, p) => sum + p.rating, 0) / pageData.filter(p => !p.isSandstone).length
      : 0;
    const avgChars = pageData.reduce((sum, p) => sum + p.charCount, 0) / totalPages;
    
    // Update verdict section
    const verdictSection = document.getElementById("verdictSection");
    verdictSection.innerHTML = `
      <div class="seal">${tier.emoji}</div>
      <div class="tier-name">${tier.name}</div>
      <div class="tier-subtitle">Total Score: ${scores.total}</div>
      
      <div class="score-breakdown">
        <div class="score-item">
          <div class="score-label">Comprehension</div>
          <div class="score-value">${scores.comprehension}</div>
          <div class="score-desc">Self-evaluation</div>
        </div>
        <div class="score-item">
          <div class="score-label">Discipline</div>
          <div class="score-value">${scores.discipline}</div>
          <div class="score-desc">On time + substance</div>
        </div>
        <div class="score-item">
          <div class="score-label">Compression</div>
          <div class="score-value">${scores.compression}</div>
          <div class="score-desc">Concise writing</div>
        </div>
      </div>

      <div class="explanation-section">
        <p><strong>Comprehension (${scores.comprehension}/${WEIGHT_COMPREHENSION}):</strong> Your honest self-assessment of how well you understood the material's core ideas, accuracy, and engagement.</p>
        
        <p><strong>Discipline (${scores.discipline}/${WEIGHT_DISCIPLINE}):</strong> Completed before time runs out. Full credit at 90%+ of character goal (${Math.floor(goalCharCount * (1 - COMPRESSION_TOLERANCE))}+ chars). Below that, credit scales proportionally down to zero.</p>
        
        <p><strong>Compression (${scores.compression}/${WEIGHT_COMPRESSION}):</strong> Writing concise summaries that capture meaning without being too brief or verbose. Sweet spot: ${Math.floor(goalCharCount * (1 - COMPRESSION_TOLERANCE))}-${Math.ceil(goalCharCount * (1 + COMPRESSION_TOLERANCE))} characters (90-110% of goal).</p>
      </div>

      ${advice ? `<div class="next-tier-advice">
        <div class="advice-label">Next Level</div>
        <p>${advice}</p>
      </div>` : ''}

      <div class="session-stats">
        <div class="stat-item">
          <span class="stat-label">Pages completed:</span>
          <span class="stat-value">${totalPages - sandstoned}/${totalPages}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Pages sandstoned:</span>
          <span class="stat-value">${sandstoned}/${totalPages}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Avg compass rating:</span>
          <span class="stat-value">${avgRating.toFixed(1)}/5</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Avg characters:</span>
          <span class="stat-value">${Math.round(avgChars)}</span>
        </div>
      </div>

      <div class="final-summary-controls" style="margin-top: 18px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
        <button class="submit-btn" id="finalSummaryBtn" type="button" onclick="generateFinalSummary()">Unlock Final Summary</button>
        <button class="submit-btn" id="printResultsBtn" type="button" onclick="printResults()" style="opacity:0.9;">Print Results</button>
      </div>

      <div id="finalSummaryStatus" style="margin-top:10px; text-align:center; font-size: 14px; opacity:0.8;"></div>
      <div id="finalSummaryOutput" style="margin-top:12px; display:none;"></div>
    `;
    
    // Show verdict with animation
    verdictSection.style.display = "block";
    
    // Play reward sound
    if (!allSoundsMuted) {
      rewardSound.currentTime = 0;
      rewardSound.play();
    }
    
    // Optional: Trigger confetti for Masterful
    if (tier.name === 'Masterful') {
      triggerConfetti();
    }
  }

  // ===================================
  // 🧠 FINAL SUMMARY (CHAPTER CONSOLIDATION)
  // ===================================

  function buildFinalSummaryPagesPayload() {
    // Tiered input:
    // 1) Use stored AI feedback if present for a page.
    // 2) Otherwise fall back to raw page text + user consolidation.
    // This keeps token usage controlled and avoids reprocessing pages that already have feedback.
    return pageData
      .map((p, idx) => {
        const ai = String(p?.aiFeedbackRaw ?? "").trim();
        const pageText = String(p?.text ?? "").trim();
        const userText = String(p?.consolidation ?? "").trim();

        if (ai) return { n: idx + 1, aiFeedback: ai };
        return { n: idx + 1, pageText, userText };
      })
      .filter((p) => {
        const ai = String(p?.aiFeedback ?? "").trim();
        const t = String(p?.pageText ?? "").trim();
        const u = String(p?.userText ?? "").trim();
        return ai || t || u;
      });
  }

  async function generateFinalSummary() {
    const btn = document.getElementById("finalSummaryBtn");
    const status = document.getElementById("finalSummaryStatus");
    const out = document.getElementById("finalSummaryOutput");
    if (!btn || !status || !out) return;

    const pagesPayload = buildFinalSummaryPagesPayload();
    if (!pagesPayload.length) {
      status.textContent = "Insufficient material to summarize.";
      return;
    }

    btn.disabled = true;
    status.textContent = "Generating final summary…";
    out.style.display = "none";
    out.innerHTML = "";

    const requestPayload = { title: "", pages: pagesPayload };

    try {
      const response = await fetch("https://reading-comprehension-rpwd.vercel.app/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });

      const rawText = await response.text();
      if (!response.ok) {
        lastAIDiagnostics = {
          kind: 'summary',
          status: response.status,
          request: diagRequest,
          responseText: rawText,
          at: new Date().toISOString()
        };
        throw new Error(rawText);
      }

      const data = JSON.parse(rawText || "{}");
      lastAIDiagnostics = {
        kind: 'summary',
        status: response.status,
        request: diagRequest,
        responseText: rawText,
        at: new Date().toISOString()
      };
      const summary = String(data?.summary ?? "").trim();
      if (!summary) {
        status.textContent = "No summary returned.";
        btn.disabled = false;
        return;
      }

      status.textContent = "";
      out.style.display = "block";
      out.innerHTML = `
        <div style="white-space:pre-wrap; line-height:1.45; padding:14px; border: 1px solid var(--border); border-radius: 10px; background: rgba(255,255,255,0.04);">
          ${escapeHtml(summary)}
        </div>
      `;
    } catch (err) {
      console.error("Final summary error:", err);
      status.textContent = "Error generating final summary. Check console.";
      btn.disabled = false;
    }
  }
  function printResults() {
    // Simple, stable text print (no UI/CSS parity attempts).
    const verdict = document.getElementById("verdictSection");
    if (!verdict) return;

    const text = verdict.innerText || "";

    const w = window.open("", "_blank", "width=800,height=600");
    if (!w) return;

    w.document.open();
    w.document.write(`
      <!doctype html>
      <html><head><meta charset="utf-8" />
      <title>Reading Results</title>
      <style>
        body { font-family: monospace; padding: 40px; white-space: pre-wrap; line-height: 1.6; }
      </style>
      </head><body>${escapeHtml(text)}</body></html>
    `);
    w.document.close();

    w.focus();
    w.print();
  }

  // Keep escaping helper for rendering AI text safely into HTML blocks.
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  
  function getNextTierAdvice(currentTier) {
    const advice = {
      'Fragmented': 'Focus on writing substantial consolidations (90%+ of your character goal) before time runs out. Discipline means both beating the timer AND writing enough to capture the core idea.',
      'Developing': 'Build consistency by finishing every page on time and within the character goal. Be honest in your self-evaluations to identify gaps.',
      'Competent': 'Capture the main mechanisms and causal relationships in each passage, not just surface-level facts. This depth will raise your comprehension score.',
      'Proficient': 'Perfect your compression hit the sweet spot every time and consistently rate yourself 5/5 when you have truly mastered the material.',
      'Masterful': 'Outstanding work! You have mastered focused reading, honest self-assessment, and concise consolidation. Keep this discipline as you tackle harder material.'
    };
    return advice[currentTier] || '';
  }
  
  function triggerConfetti() {
    const colors = ['#c17d4a', '#8B2500', '#a96939', '#d4af37'];
    for (let i = 0; i < 50; i++) {
      setTimeout(() => {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animationDuration = (Math.random() * 2 + 2) + 's';
        document.body.appendChild(confetti);
        
        setTimeout(() => confetti.remove(), 3000);
      }, i * 30);
    }
  }

  // Initialize optional Book Import UI
  initBookImporter();

  // ===================================
  // 🛠️ Utility Panels (Volume + Diagnostics)
  // ===================================

  (function initUtilityPanels() {
    const musicToggleBtn = document.getElementById('musicToggle');
    const toggleMusicBtn = document.getElementById('toggleMusicBtn');
    const volumePanel = document.getElementById('volumePanel');
    const volumeCloseBtn = document.getElementById('volumeCloseBtn');

    // Diagnostics are debug-only and must not alter the normal UI layout.
    // We build the button + panel dynamically (appended to <body>) so it cannot
    // create empty boxes inside .top-controls.
    let diagBtn = null;
    let diagPanel = null;
    let diagCloseBtn = null;
    let diagText = null;
    let diagCopyBtn = null;

    // URL flag: show diagnostics when debug is present/truthy.
    const debugEnabled = isDebugEnabledFromUrl();

    // If any legacy diag elements exist in the DOM (from older patches), hide them
    // so they don't consume layout space.
    ['diagBtn', 'diagPanel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        try { el.style.display = 'none'; } catch (_) {}
      }
    });

    // Hide any legacy "debug" dropdown/controls if present.
    if (debugEnabled) {
      const legacySelectors = [
        '#debugControls', '#debugControl', '#debugPanelLegacy', '#debugSelect', '#debugMode',
        '#debugDropdown', '#debugToggle', '#debugMenu', '.debug-controls', '.debug-control',
        '.debug-dropdown', '.debug-select', '.debug-toggle'
      ];
      legacySelectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          try { el.style.display = 'none'; } catch (_) {}
        });
      });
    }

    function hideAllPanels() {
      if (volumePanel) volumePanel.style.display = 'none';
      if (diagPanel) diagPanel.style.display = 'none';
    }

    // Volume panel wiring
    if (musicToggleBtn && volumePanel) {
      const sliders = {
        music: document.getElementById('vol_music'),
        sand: document.getElementById('vol_sand'),
        stone: document.getElementById('vol_stone'),
        reward: document.getElementById('vol_reward'),
        compass: document.getElementById('vol_compass'),
        pageTurn: document.getElementById('vol_pageTurn'),
        evaluate: document.getElementById('vol_evaluate'),
      };

      function syncSlidersFromState() {
        if (sliders.music) sliders.music.value = String(music.volume);
        if (sliders.sand) sliders.sand.value = String(sandSound.volume);
        if (sliders.stone) sliders.stone.value = String(stoneSound.volume);
        if (sliders.reward) sliders.reward.value = String(rewardSound.volume);
        if (sliders.compass) sliders.compass.value = String(compassSound.volume);
        if (sliders.pageTurn) sliders.pageTurn.value = String(pageTurnSound.volume);
        if (sliders.evaluate) sliders.evaluate.value = String(evaluateSound.volume);
      }

      Object.entries(sliders).forEach(([key, el]) => {
        if (!el) return;
        el.addEventListener('input', () => setVolume(key, el.value));
      });

      // Open the volume panel from the existing music button (no extra top-controls button).
      musicToggleBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        const isOpen = volumePanel.style.display === 'block';
        hideAllPanels();
        if (!isOpen) {
          syncSlidersFromState();
          // Position the panel just ABOVE the music toggle so it never drops below the fold.
          // (iPad cursor can't reach off-page dropdowns.)
          try {
            // Temporarily show invisibly so we can measure height.
            volumePanel.style.visibility = 'hidden';
            volumePanel.style.display = 'block';

            const rect = musicToggleBtn.getBoundingClientRect();
            const panelW = volumePanel.offsetWidth;
            const panelH = volumePanel.offsetHeight;

            const gap = 10;
            const top = Math.max(10, rect.top - panelH - gap);
            const left = Math.min(
              window.innerWidth - panelW - 10,
              Math.max(10, rect.right - panelW)
            );

            volumePanel.style.top = `${top}px`;
            volumePanel.style.left = `${left}px`;
          } catch (_) {}
          volumePanel.style.visibility = 'visible';
        }
      });

      if (volumeCloseBtn) volumeCloseBtn.addEventListener('click', () => (volumePanel.style.display = 'none'));
      if (toggleMusicBtn) toggleMusicBtn.addEventListener('click', () => window.toggleMusic && window.toggleMusic());
    }

    // Diagnostics panel wiring (debug-only)
    function ensureDiagUI() {
      if (!debugEnabled) return;
      if (diagBtn && diagPanel && diagText) return;

      // Button: match the music button styling and sit beside it.
      diagBtn = document.createElement('button');
      diagBtn.id = 'diagBtn';
      diagBtn.type = 'button';
      diagBtn.className = 'music-button';
      diagBtn.title = 'Diagnostics';
      diagBtn.innerHTML = '<span id="diagIcon">🔧</span>';

      // IMPORTANT: .music-button is fixed bottom-right. If we don't offset,
      // the diagnostics button will sit directly under the music button.
      // Nudge it left so both are visible.
      diagBtn.style.right = '88px';
      diagBtn.style.bottom = '20px';

      if (musicToggleBtn && musicToggleBtn.parentElement) {
        musicToggleBtn.parentElement.insertBefore(diagBtn, musicToggleBtn);
      } else {
        // fallback: fixed top-right (only if the DOM changes)
        document.body.appendChild(diagBtn);
        diagBtn.style.position = 'fixed';
        diagBtn.style.top = '16px';
        diagBtn.style.right = '64px';
        diagBtn.style.zIndex = '1000';
      }

      // Panel: same conventions as the Sound panel (fixed, above the button)
      diagPanel = document.createElement('div');
      diagPanel.id = 'diagPanel';
      diagPanel.style.display = 'none';
      diagPanel.style.position = 'fixed';
      diagPanel.style.zIndex = '1000';
      diagPanel.style.width = '420px';
      diagPanel.style.maxWidth = '92vw';
      diagPanel.style.padding = '12px';
      diagPanel.style.border = '2px solid var(--border)';
      diagPanel.style.borderRadius = '10px';
      diagPanel.style.background = 'var(--secondary-bg)';
      diagPanel.style.boxShadow = '0 8px 28px rgba(0,0,0,0.22)';
      diagPanel.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <strong style="font-size: 13px; opacity:0.9;">Diagnostics</strong>
          <button type="button" id="diagCloseBtn" style="padding:6px 10px;">✕</button>
        </div>
        <textarea id="diagText" readonly style="width:100%; height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 12px; padding: 10px;"></textarea>
        <div style="display:flex; gap:10px; margin-top:10px; justify-content:flex-end;">
          <button type="button" id="diagCopyBtn">Copy</button>
        </div>
      `;
      document.body.appendChild(diagPanel);

      diagCloseBtn = diagPanel.querySelector('#diagCloseBtn');
      diagText = diagPanel.querySelector('#diagText');
      diagCopyBtn = diagPanel.querySelector('#diagCopyBtn');

      function positionPanelAboveButton(btn, panel) {
        if (!btn || !panel) return;
        try {
          panel.style.visibility = 'hidden';
          panel.style.display = 'block';
          const rect = btn.getBoundingClientRect();
          const panelW = panel.offsetWidth;
          const panelH = panel.offsetHeight;
          const gap = 10;
          const top = Math.max(10, rect.top - panelH - gap);
          const left = Math.min(
            window.innerWidth - panelW - 10,
            Math.max(10, rect.right - panelW)
          );
          panel.style.top = `${top}px`;
          panel.style.left = `${left}px`;
        } catch (_) {}
        panel.style.visibility = 'visible';
      }

      function setDiagVisible(v) {
        if (!diagPanel || !diagText) return;
        if (!v) {
          diagPanel.style.display = 'none';
          return;
        }
        const merged = {
          ai: lastAIDiagnostics || null,
          anchors: lastAnchorsDiagnostics || null,
        };
        const hasAny = Boolean(merged.ai || merged.anchors);
        const dump = hasAny
          ? JSON.stringify(merged, null, 2)
          : 'No diagnostics captured yet.\n\nTip: load pages with ?debug=1 (anchors) or run an AI eval.';
        diagText.value = dump;
        diagPanel.style.display = 'block';
        positionPanelAboveButton(diagBtn, diagPanel);
      }

      diagBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const isOpen = diagPanel && diagPanel.style.display === 'block';
        hideAllPanels();
        setDiagVisible(!isOpen);
      });

      if (diagCloseBtn) diagCloseBtn.addEventListener('click', () => setDiagVisible(false));
      if (diagCopyBtn && diagText) {
        diagCopyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(diagText.value || '');
            diagCopyBtn.textContent = 'Copied';
            setTimeout(() => (diagCopyBtn.textContent = 'Copy'), 900);
          } catch (_) {
            diagText.select();
            document.execCommand('copy');
          }
        });
      }

      // Ctrl+Alt+D toggles diagnostics (debug-only)
      document.addEventListener('keydown', (e) => {
        if (!debugEnabled) return;
        if (!(e.ctrlKey && e.altKey && (e.key === 'd' || e.key === 'D'))) return;
        const isOpen = diagPanel && diagPanel.style.display === 'block';
        hideAllPanels();
        setDiagVisible(!isOpen);
      });
    }

    // Build debug UI only when enabled.
    ensureDiagUI();

    // Click outside closes panels (lightweight)
    document.addEventListener('click', (e) => {
      const t = e.target;
      const inVol = volumePanel && volumePanel.contains(t);
      const inDiag = diagPanel && diagPanel.contains(t);
      const isVolBtn = musicToggleBtn && (t === musicToggleBtn || musicToggleBtn.contains(t));
      const isDiagBtn = diagBtn && (t === diagBtn || diagBtn.contains(t));
      if (inVol || inDiag || isVolBtn || isDiagBtn) return;
      hideAllPanels();
    });
  })();

// --- Boot: restore local session if present ---
try {
  if (loadPersistedSessionIfAny()) {
    render();
    updateDiagnostics();
  }
} catch (_) {}
