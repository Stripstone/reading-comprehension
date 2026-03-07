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
//  - Preferred: Amazon Polly via /api/tts (consistent neural voice)
//  - Fallback: Browser SpeechSynthesis (free)
// ==============================

const TTS_STATE = {
  activeKey: null,
  audio: null,
  abort: null,
  volume: 1,
  // 'female' (default) or 'male' for Polly narrator selection
  voiceVariant: 'female',
  // sentence highlight state (page read)
  highlightPageKey: null,
  highlightPageEl: null,
  highlightOriginalHTML: null,
  highlightRAF: null,
  highlightSpans: null,
  highlightMarks: null,
  highlightEnds: null,
};

function optsForKeySentenceMarks(key) {
  // Only sentence-highlight during "Read page" (page-<index>) actions.
  return typeof key === "string" && key.startsWith("page-");
}

// Convert Polly byte offsets (UTF-8) to JS string indices
function utf8ByteOffsetToJsIndex(str, byteOffset) {
  const enc = new TextEncoder();
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const cp = str.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    bytes += enc.encode(ch).length;
    if (bytes > byteOffset) return i;
    if (cp > 0xFFFF) i++; // surrogate pair
  }
  return str.length;
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function ttsClearSentenceHighlight() {
  if (TTS_STATE.highlightRAF) {
    cancelAnimationFrame(TTS_STATE.highlightRAF);
    TTS_STATE.highlightRAF = null;
  }
  if (TTS_STATE.highlightPageEl && TTS_STATE.highlightOriginalHTML != null) {
    TTS_STATE.highlightPageEl.innerHTML = TTS_STATE.highlightOriginalHTML;
  }
  TTS_STATE.highlightPageKey = null;
  TTS_STATE.highlightPageEl = null;
  TTS_STATE.highlightOriginalHTML = null;
  TTS_STATE.highlightSpans = null;
  TTS_STATE.highlightMarks = null;
  TTS_STATE.highlightEnds = null;
}

function ttsMaybePrepareSentenceHighlight(key, rawText, marks) {
  // Only for page reads, and only if we got marks.
  if (!optsForKeySentenceMarks(key)) return;
  if (!Array.isArray(marks) || !marks.length) return;

  const pageIndex = Number(String(key).slice(5));
  if (!Number.isFinite(pageIndex)) return;

  // Pages are rendered as .page elements in DOM order.
  // (They do NOT carry a data-page attribute.)
  const pageEl = document.querySelectorAll('.page')[pageIndex];
  if (!pageEl) return;
  const textEl = pageEl.querySelector(".page-text");
  if (!textEl) return;

  // Reset any prior highlighting
  ttsClearSentenceHighlight();

  const text = String(rawText || textEl.textContent || "");
  const spansHtml = [];
  const spansMeta = [];

  // Convert Polly marks into JS index ranges
  const ranges = marks.map(m => {
    const start = utf8ByteOffsetToJsIndex(text, m.start);
    const end = utf8ByteOffsetToJsIndex(text, m.end);
    return { time: Number(m.time) || 0, start, end };
  }).filter(r => r.end > r.start);

  if (!ranges.length) return;

  // Build HTML with sentence spans
  let cursor = 0;
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (r.start > cursor) {
      spansHtml.push(escapeHTML(text.slice(cursor, r.start)));
    }
    const sentence = text.slice(r.start, r.end);
    spansHtml.push(`<span class="tts-sentence" data-tts-sent="${i}">${escapeHTML(sentence)}</span>`);
    spansMeta.push(r);
    cursor = r.end;
  }
  if (cursor < text.length) spansHtml.push(escapeHTML(text.slice(cursor)));

  TTS_STATE.highlightPageKey = key;
  TTS_STATE.highlightPageEl = textEl;
  TTS_STATE.highlightOriginalHTML = textEl.innerHTML;
  TTS_STATE.highlightMarks = spansMeta;

  // Precompute sentence end times (next sentence start, or Infinity)
  const ends = spansMeta.map((r, i) => (i + 1 < spansMeta.length ? spansMeta[i + 1].time : Infinity));
  TTS_STATE.highlightEnds = ends;

  textEl.innerHTML = spansHtml.join("");
  TTS_STATE.highlightSpans = Array.from(textEl.querySelectorAll(".tts-sentence"));
}

function ttsStartHighlightLoop(audio) {
  if (!audio || !TTS_STATE.highlightSpans || !TTS_STATE.highlightMarks) return;

  let lastIdx = -1;
  const tick = () => {
    if (!TTS_STATE.audio || TTS_STATE.audio !== audio) return;
    if (!TTS_STATE.highlightSpans || !TTS_STATE.highlightMarks) return;
    const t = audio.currentTime * 1000;

    // Find current sentence by time
    let idx = -1;
    const marks = TTS_STATE.highlightMarks;
    const ends = TTS_STATE.highlightEnds || [];
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].time;
      const end = ends[i] ?? Infinity;
      if (t >= start && t < end) { idx = i; break; }
    }

    if (idx !== lastIdx) {
      // Copy Anchors "hint" mechanics: drive a CSS var alpha per span.
      // Fade out the previous sentence highlight.
      if (lastIdx >= 0 && TTS_STATE.highlightSpans[lastIdx]) {
        const prev = TTS_STATE.highlightSpans[lastIdx];
        prev.style.setProperty('--tts-alpha', '0');
      }

      // Fade in the new sentence highlight.
      if (idx >= 0 && TTS_STATE.highlightSpans[idx]) {
        const cur = TTS_STATE.highlightSpans[idx];
        // Make the active sentence highlight fully readable (avoid washed-out opacity).
        cur.style.setProperty('--tts-alpha', '1');

        // Mobile: scroll ONLY the reading pane (.page-text), not the document.
        // (Avoid scrollIntoView which can move the whole page.)
        try {
          const isMobile = window.matchMedia && window.matchMedia('(max-width: 480px)').matches;
          const pane = TTS_STATE.highlightPageEl;
          if (isMobile && pane) {
            // Only if pane is actually scrollable.
            const canScroll = pane.scrollHeight > pane.clientHeight + 4;
            if (canScroll) {
              const curTop = cur.offsetTop;
              const curHeight = cur.offsetHeight;
              const desired = curTop - (pane.clientHeight / 2) + (curHeight / 2);
              const nextScroll = Math.max(0, Math.min(desired, pane.scrollHeight - pane.clientHeight));
              pane.scrollTop = nextScroll;
            }
          }
        } catch (_) {}
      }

      lastIdx = idx;
    }

    TTS_STATE.highlightRAF = requestAnimationFrame(tick);
  };

  if (TTS_STATE.highlightRAF) cancelAnimationFrame(TTS_STATE.highlightRAF);
  TTS_STATE.highlightRAF = requestAnimationFrame(tick);
}

function browserTtsSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function browserTtsStop() {
  if (!browserTtsSupported()) return;
  window.speechSynthesis.cancel();
}

function browserPickVoice() {
  try {
    const voices = window.speechSynthesis.getVoices() || [];
    return (
      voices.find(v => /Google/i.test(v.name) && /en/i.test(v.lang)) ||
      voices.find(v => /Microsoft/i.test(v.name) && /en/i.test(v.lang)) ||
      voices.find(v => (v.lang || "").toLowerCase().startsWith("en")) ||
      voices[0] ||
      null
    );
  } catch {
    return null;
  }
}

function ttsStop() {
  // Stop any in-flight fetch
  if (TTS_STATE.abort) {
    try { TTS_STATE.abort.abort(); } catch (_) {}
    TTS_STATE.abort = null;
  }
  // Stop any audio playback
  if (TTS_STATE.audio) {
    try {
      TTS_STATE.audio.pause();
      TTS_STATE.audio.src = "";
    } catch (_) {}
    TTS_STATE.audio = null;
  }
  // Stop browser fallback
  browserTtsStop();
  ttsClearSentenceHighlight();
  TTS_STATE.activeKey = null;
}

async function pollyFetchUrl(text, opts = {}) {
  const controller = new AbortController();
  TTS_STATE.abort = controller;

  // IMPORTANT:
  // Do NOT hardcode voice/engine here.
  // We want the server-side defaults (Vercel env: POLLY_VOICE_ID / POLLY_ENGINE)
  // to take effect so changing env vars changes the narrator without being
  // overridden by the client.
  const payload = { text };
  if (opts && opts.sentenceMarks) payload.speechMarks = "sentence";

  // Optional voice variant (server maps male/female to env vars).
  // Default is female if omitted.
  try {
    if (String(TTS_STATE.voiceVariant || '').toLowerCase() === 'male') {
      payload.voiceVariant = 'male';
    }
  } catch (_) {}

  // Developer override: if you set localStorage.tts_nocache = "1",
  // the server will regenerate audio even if an S3 object already exists.
  // (Useful while auditioning voices.)
  try {
    if (localStorage.getItem("tts_nocache") === "1") payload.nocache = true;
  } catch (_) {}

  const base = (typeof resolveApiBase === "function") ? resolveApiBase() : "";
  const endpoint = base ? `${base}/api/tts` : "/api/tts";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });

  let data = null;
  let rawText = "";
  try {
    rawText = await res.text();
    data = rawText ? JSON.parse(rawText) : null;
  } catch (_) {
    // ignore parse errors; we'll surface rawText
  }

  if (!res.ok || !data?.url) {
    const detail = data?.detail || data?.message || rawText || "";
    const msg = data?.error
      ? `${data.error}${detail ? `: ${detail}` : ""}`
      : `TTS request failed (${res.status})${detail ? `: ${detail}` : ""}`;
    throw new Error(msg);
  }
  return { url: data.url, sentenceMarks: Array.isArray(data.sentenceMarks) ? data.sentenceMarks : null };
}

function browserSpeakQueue(key, parts) {
  if (!browserTtsSupported()) {
    alert("Text-to-speech is not supported in this browser.");
    return;
  }

  const queue = (parts || []).map(t => String(t || "").trim()).filter(Boolean);
  if (!queue.length) return;

  // Toggle behavior
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    if (TTS_STATE.activeKey === key) {
      ttsStop();
      return;
    }
    ttsStop();
  }

  TTS_STATE.activeKey = key;
  let idx = 0;
  const voice = browserPickVoice();

  const speakNext = () => {
    if (idx >= queue.length) {
      TTS_STATE.activeKey = null;
      return;
    }
    const utter = new SpeechSynthesisUtterance(queue[idx]);
    utter.lang = "en-US";
    utter.rate = 1;
    utter.pitch = 1;
    // Browser TTS volume (0..1). Persisted via the Voices slider.
    try { utter.volume = Math.max(0, Math.min(1, Number(TTS_STATE.volume ?? 1))); } catch (_) {}
    if (voice) utter.voice = voice;
    utter.onend = () => { idx += 1; speakNext(); };
    utter.onerror = () => { TTS_STATE.activeKey = null; };
    window.speechSynthesis.speak(utter);
  };

  speakNext();
}

async function ttsSpeakQueue(key, parts) {
  const queue = (parts || []).map(t => String(t || "").trim()).filter(Boolean);
  if (!queue.length) return;

  // Toggle behavior:
  // - Clicking the same action stops (even if we're still fetching).
  // - Clicking a different action stops current and starts the new one.
  if (TTS_STATE.activeKey === key) {
    ttsStop();
    return;
  }
  if (TTS_STATE.activeKey && TTS_STATE.activeKey !== key) {
    ttsStop();
  }
  TTS_STATE.activeKey = key;

  // Preferred path: Polly via /api/tts. If it fails, fall back to browser voices.
  try {
    for (let i = 0; i < queue.length; i++) {
      const wantMarks = (i === 0 && optsForKeySentenceMarks(key));
      const tts = await pollyFetchUrl(queue[i], { sentenceMarks: wantMarks });
      const url = tts.url;
      if (wantMarks) ttsMaybePrepareSentenceHighlight(key, queue[i], tts.sentenceMarks);
      if (TTS_STATE.activeKey !== key) return; // cancelled mid-flight

      // Play URL (sequential)
      await new Promise((resolve, reject) => {
        const audio = new Audio(url);
        TTS_STATE.audio = audio;
        // Polly audio volume (0..1). Persisted via the Voices slider.
        try { audio.volume = Math.max(0, Math.min(1, Number(TTS_STATE.volume ?? 1))); } catch (_) {}
        // Start sentence highlight loop if prepared for this action.
        ttsStartHighlightLoop(audio);
        audio.onended = () => { ttsClearSentenceHighlight(); resolve(); };
        audio.onerror = () => reject(new Error("Audio playback failed"));
        audio.play().catch(reject);
      });
    }
    TTS_STATE.activeKey = null;
  } catch (err) {
    // IMPORTANT: If the user explicitly stopped (or switched actions) while Polly
    // was fetching/playing, do NOT fall back to browser TTS.
    if (TTS_STATE.activeKey !== key) return;
    if (err && (err.name === 'AbortError' || String(err).includes('aborted'))) return;

    // If Polly isn't configured yet (or otherwise fails), don't spam alerts; just fall back.
    console.warn("Polly TTS unavailable, falling back to browser TTS:", err);
    ttsStop();
    browserSpeakQueue(key, queue);
  }
}

// Some browsers load voices asynchronously.
if (browserTtsSupported()) {
  window.speechSynthesis.onvoiceschanged = () => { /* no-op */ };
}


// Best-practice stop conditions:
// - If the user navigates away or the tab is hidden, stop speaking.
// - This prevents "no way to turn it off" situations on mobile.
try {
  window.addEventListener("pagehide", () => ttsStop(), { passive: true });
  window.addEventListener("beforeunload", () => ttsStop(), { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) ttsStop();
  }, { passive: true });
} catch (_) {}

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

  // API base:
  // - On Vercel (static+API together) we can use relative paths.
  // - On GitHub Pages (static only) we need an absolute Vercel URL.
  // Override precedence:
  //   1) ?api=https://your-vercel.app
  //   2) localStorage rc_api_base
  //   3) default fallback
  const DEFAULT_API_BASE = "https://reading-comprehension-rpwd.vercel.app";
  function resolveApiBase() {
    try {
      const qs = new URLSearchParams(window.location.search);
      const fromQs = (qs.get('api') || '').trim();
      if (fromQs) return fromQs.replace(/\/$/, '');
      const fromLs = (localStorage.getItem('rc_api_base') || '').trim();
      if (fromLs) return fromLs.replace(/\/$/, '');
      // If we're already on a host that should serve /api (e.g., Vercel), prefer relative.
      if (window.location.hostname.endsWith('vercel.app')) return "";
      return DEFAULT_API_BASE;
    } catch (_) {
      return DEFAULT_API_BASE;
    }
  }
  const API_BASE = resolveApiBase();
  function apiUrl(path) {
    // path should start with '/'
    return API_BASE ? (API_BASE + path) : path;
  }
  // ----------------------------------------------------
  // Anchor cache invalidation
  // ----------------------------------------------------
  // Anchors are cached in localStorage under keys like:
  //   anchors:<ANCHOR_VERSION>:<pageHash>
  // During iterative development, logic/prompt changes can make old cached
  // anchors look like "hallucinated" runtime bugs. To prevent that, we treat
  // ANCHOR_ENGINE_VERSION as the broad truth for anchor-system behavior.
  // If it changes, we wipe ALL anchor cache entries before continuing.
  const ANCHOR_ENGINE_VERSION = "2.1.0";
  const ANCHOR_ENGINE_VERSION_KEY = "rc_anchor_engine_version";

  function invalidateAnchorsCacheIfNeeded() {
    try {
      const stored = localStorage.getItem(ANCHOR_ENGINE_VERSION_KEY);
      if (stored === ANCHOR_ENGINE_VERSION) return;

      // Remove ALL cached anchor entries (any version).
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith('anchors:')) {
          localStorage.removeItem(k);
        }
      }
      localStorage.setItem(ANCHOR_ENGINE_VERSION_KEY, ANCHOR_ENGINE_VERSION);
      try { console.info('[AnchorEngine] cache cleared (version change)', { from: stored, to: ANCHOR_ENGINE_VERSION }); } catch (_) {}
    } catch (_) {
      // ignore (private mode / quota)
    }
  }

  // IMPORTANT: run before any anchor cache reads.
  invalidateAnchorsCacheIfNeeded();

const ANCHOR_VERSION = 6;
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
    // Matching should feel generous, but not "free".
    // We prioritize literal quote terms, and only keep a small number of extra model terms
    // (to support paraphrase) while filtering low-signal filler.
    const rawTerms = Array.isArray(anchor?.terms) ? anchor.terms : [];

    const quoteTerms = tokenizeBase(anchor?.quote || "");
    const quoteSet = new Set(quoteTerms);

    const STOP = new Set([
      "a","an","the","and","or","but","so","to","of","in","on","for","with","at","by","from","as","it","its",
      "is","are","was","were","be","been","being","do","does","did","have","has","had",
      "this","that","these","those","you","your","we","our","they","their","i","me","my",
      "can","could","should","would","will","just","very","really","more","most","less","much",
      "about","into","over","under","than","then","when","how","why","what","who"
    ]);

    function isHighSignal(term) {
      if (!term) return false;
      if (/\d/.test(term)) return true; // numbers, wpm, percentages
      if (term.length >= 8) return true; // longer words tend to be more specific
      return ["hundred","hundreds","percent","wpm","spreeder","triforce","monologue","tracker","insight","insights"].includes(term);
    }

    // Normalize model terms via tokenizeBase, but filter filler.
    const modelTermsAll = rawTerms.flatMap(t => tokenizeBase(t));
    const modelTerms = modelTermsAll.filter(w => w && !STOP.has(w));

    const out = [];
    const seen = new Set();

    // 1) Always include quote terms first (literal spine)
    for (const w of quoteTerms) {
      if (!w || STOP.has(w) || seen.has(w)) continue;
      seen.add(w);
      out.push(w);
      if (out.length >= 6) return out;
    }

    // 2) Add a small number of extra model terms (paraphrase support),
    // preferring those that are either in the quote OR high-signal.
    let extras = 0;
    for (const w of modelTerms) {
      if (!w || seen.has(w)) continue;
      if (quoteSet.has(w) || isHighSignal(w)) {
        seen.add(w);
        out.push(w);
        extras += quoteSet.has(w) ? 0 : 1;
      }
      if (out.length >= 6 || extras >= 2) break;
    }

    return out.slice(0, 6);
  }
function shouldCountAnchor(anchor, quoteMatch, matchedTerms, matchCount, totalTerms) {
    // Quote match counts as found.
    if (quoteMatch) return true;

    const weight = Number(anchor?.weight ?? 1);
    const ratio = totalTerms > 0 ? (matchCount / totalTerms) : 0;

    // High-signal terms are the ones that tend to carry the "mechanism" or key detail.
    const HIGH = new Set(["hundred","hundreds","percent","wpm","spreeder","triforce","monologue","tracker","insight","insights"]);
    const hasHigh = Array.isArray(anchor?.terms) && anchor.terms.some(t => HIGH.has(String(t).toLowerCase()));
    const matchedHigh = Array.isArray(matchedTerms) && matchedTerms.some(t => HIGH.has(String(t).toLowerCase()));

    // Progressive strictness:
    // - weight 3: require strong completion (or at least one high-signal term)
    // - weight 2: require moderate completion
    // - weight 1: allow a single meaningful hit
    if (weight >= 3) {
      if (hasHigh && !matchedHigh) return false;
      return ratio >= 0.8 || matchCount >= Math.min(3, totalTerms);
    }
    if (weight === 2) {
      if (hasHigh && !matchedHigh) return false;
      return ratio >= 0.6 || matchCount >= Math.min(2, totalTerms);
    }
    // weight 1
    return matchCount >= 1;
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
      const counted = shouldCountAnchor(a, quoteMatch, matched, matchCount, total);
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
  // Voices (TTS) volume is handled separately from music/SFX.
  TTS_STATE.volume = typeof savedVol.voice === 'number' ? savedVol.voice : 1;

  // Voice variant (male/female) for Polly. Default: female.
  try {
    const v = String(localStorage.getItem('rc_voice_variant') || '').toLowerCase();
    if (v === 'male' || v === 'female') TTS_STATE.voiceVariant = v;
  } catch (_) {}
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
    if (key === 'voice') {
      TTS_STATE.volume = v;
      // Apply immediately if Polly audio is currently playing.
      if (TTS_STATE.audio && typeof TTS_STATE.audio.volume === 'number') {
        try { TTS_STATE.audio.volume = v; } catch (_) {}
      }
    }
  }
  
  // Set initial input values from constants
  document.getElementById("goalTimeInput").value = DEFAULT_TIME_GOAL;
  document.getElementById("goalCharInput").value = DEFAULT_CHAR_GOAL;

  // Difficulty presets: set time + character targets with one click.
  (function initDifficultyPresets() {
    const btnEasy = document.getElementById('difficultyEasy');
    const btnMed = document.getElementById('difficultyMedium');
    const btnHard = document.getElementById('difficultyHard');
    const timeEl = document.getElementById('goalTimeInput');
    const charEl = document.getElementById('goalCharInput');
    if (!btnEasy || !btnMed || !btnHard || !timeEl || !charEl) return;

    const PRESETS = {
      easy:   { time: 90,  chars: 200 },
      medium: { time: 150, chars: 260 },
      hard:   { time: 300, chars: 340 },
    };

    function setActive(mode) {
      [btnEasy, btnMed, btnHard].forEach((b) => b.classList.remove('is-active'));
      btnEasy.setAttribute('aria-pressed', String(mode === 'easy'));
      btnMed.setAttribute('aria-pressed', String(mode === 'medium'));
      btnHard.setAttribute('aria-pressed', String(mode === 'hard'));
      if (mode === 'easy') btnEasy.classList.add('is-active');
      if (mode === 'medium') btnMed.classList.add('is-active');
      if (mode === 'hard') btnHard.classList.add('is-active');
    }

    function applyPreset(mode) {
      const p = PRESETS[mode];
      if (!p) return;
      timeEl.value = String(p.time);
      charEl.value = String(p.chars);
      setActive(mode);
      try { localStorage.setItem('rc_difficulty', mode); } catch (_) {}
    }

    btnEasy.addEventListener('click', () => applyPreset('easy'));
    btnMed.addEventListener('click', () => applyPreset('medium'));
    btnHard.addEventListener('click', () => applyPreset('hard'));

    // Restore last selection if present; otherwise leave the current values.
    try {
      const saved = localStorage.getItem('rc_difficulty');
      if (saved && PRESETS[saved]) {
        applyPreset(saved);
      }
    } catch (_) {}
  })();

  
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

  // ===================================
  // LOCAL LIBRARY (IndexedDB)
  // ===================================
  const LOCAL_DB_NAME = 'rc_local_library_v1';
  const LOCAL_DB_VERSION = 1;
  const LOCAL_STORE_BOOKS = 'books';

  let _localDbPromise = null;

  function openLocalDb() {
    if (_localDbPromise) return _localDbPromise;
    _localDbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(LOCAL_STORE_BOOKS)) {
            db.createObjectStore(LOCAL_STORE_BOOKS, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      } catch (e) {
        reject(e);
      }
    });
    return _localDbPromise;
  }

  async function localBooksGetAll() {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_BOOKS, 'readonly');
      const store = tx.objectStore(LOCAL_STORE_BOOKS);
      const req = store.getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error || new Error('getAll failed'));
    });
  }

  async function localBookGet(id) {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_BOOKS, 'readonly');
      const store = tx.objectStore(LOCAL_STORE_BOOKS);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('get failed'));
    });
  }

  async function localBookPut(record) {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_BOOKS, 'readwrite');
      const store = tx.objectStore(LOCAL_STORE_BOOKS);
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('put failed'));
    });
  }

  async function localBookDelete(id) {
    const db = await openLocalDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_BOOKS, 'readwrite');
      const store = tx.objectStore(LOCAL_STORE_BOOKS);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('delete failed'));
    });
  }

  function isLocalBookId(id) {
    return typeof id === 'string' && id.startsWith('local:');
  }

  function stripLocalPrefix(id) {
    return isLocalBookId(id) ? id.slice('local:'.length) : id;
  }

  async function hashArrayBufferSha256(buf) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const bytes = new Uint8Array(digest);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      return b64.slice(0, 22);
    } catch (_) {
      // Fallback: not cryptographically strong, but stable.
      return String(Date.now());
    }
  }

  // ===================================
  // EPUB (client-side) -> Markdown (chapters + pages)
  // Requires JSZip (loaded in index.html)
  // ===================================

  function xmlParseSafe(xmlStr) {
    try {
      return new DOMParser().parseFromString(String(xmlStr || ''), 'application/xml');
    } catch (_) {
      return null;
    }
  }

  function htmlParseSafe(htmlStr) {
    try {
      return new DOMParser().parseFromString(String(htmlStr || ''), 'text/html');
    } catch (_) {
      return null;
    }
  }

  function normPath(p) {
    return String(p || '').replace(/^\//, '');
  }

  function joinPath(baseDir, rel) {
    const b = String(baseDir || '');
    const r = String(rel || '');
    if (!b) return normPath(r);
    if (!r) return normPath(b);
    if (/^https?:/i.test(r)) return r;
    if (r.startsWith('/')) return normPath(r);
    const out = (b.endsWith('/') ? b : (b + '/')) + r;
    // Resolve ./ and ../
    const parts = out.split('/');
    const stack = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') stack.pop();
      else stack.push(part);
    }
    return stack.join('/');
  }

  async function zipReadText(zip, path) {
    const f = zip.file(path);
    if (!f) return '';
    return await f.async('text');
  }

  async function epubFindOpfPath(zip) {
    const container = await zipReadText(zip, 'META-INF/container.xml');
    const doc = xmlParseSafe(container);
    if (!doc) return null;
    const rootfile = doc.querySelector('rootfile');
    const fullPath = rootfile?.getAttribute('full-path') || rootfile?.getAttribute('fullpath');
    return fullPath ? normPath(fullPath) : null;
  }

  function dirOf(path) {
    const p = String(path || '');
    const idx = p.lastIndexOf('/');
    return idx >= 0 ? p.slice(0, idx) : '';
  }

  function classifySection(title) {
    const t = String(title || '').toLowerCase();
    if (!t.trim()) return { type: 'unknown', tags: [] };
    const tags = [];
    let type = 'unknown';
    if (/\bchapter\b|\bch\.?\s*\d+\b/.test(t) || /^chapter\s+\w+/.test(t)) { type = 'chapter'; tags.push('Chapter'); }
    if (/\bintroduction\b|\bprologue\b|\bforeword\b/.test(t)) { type = 'intro'; tags.push('Intro'); }
    if (/\backnowledg|\bdedication|\bcopyright|\bpermissions|\babout\b/.test(t)) { type = 'front_matter'; tags.push('Front'); }
    if (/\bappendix\b|\breferences\b|\bbibliography\b|\bnotes\b/.test(t)) { type = 'appendix'; tags.push('Appendix'); }
    if (/\bindex\b|\bglossary\b/.test(t)) { type = 'index'; tags.push('Index'); }
    return { type, tags };
  }

  function defaultSelectedForTitle(title) {
    const cls = classifySection(title);
    // Default ON: chapters + intro. Default OFF: front matter / appendix / index.
    if (cls.type === 'chapter' || cls.type === 'intro') return true;
    if (cls.type === 'front_matter' || cls.type === 'appendix' || cls.type === 'index') return false;
    // Unknown: keep on (user can uncheck)
    return true;
  }

  function extractTextBlocksFromHtml(htmlStr) {
    const doc = htmlParseSafe(htmlStr);
    if (!doc) return [];
    const root = doc.body || doc.documentElement;
    if (!root) return [];

    const blocks = [];
    const candidates = root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li');
    candidates.forEach((el) => {
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt) return;
      // Ignore obvious nav junk
      if (txt.length < 2) return;
      blocks.push(txt);
    });
    // Fallback if markup is minimal
    if (blocks.length === 0) {
      const txt = (root.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt) blocks.push(txt);
    }
    return blocks;
  }

  function chunkBlocksToPages(blocks, targetChars = 1600) {
    // Locked behavior (v1):
    // - Target stable page size, but only break on paragraph boundary or sentence end (.?! + optional closing quote/bracket)
    // - Do NOT break when it would split a continuation:
    //   - next chunk starts with opening quote/paren/bracket
    //   - current ends with lead-in token (':', ';', em-dash, ',', 'such as', 'the following', 'including', ...)
    //   - inside an instruction/list block
    // - Guardrails: allow overflow up to hard max; then pick least-bad safe stop.
    // - Cleanup: merge micro-pages (< ~65% target) into neighbors when safe.

    const pagesOut = [];
    const target = Math.max(400, targetChars | 0);
    const softMax = Math.round(target * 1.15);
    const hardMax = Math.round(target * 1.35);
    const minChars = Math.round(target * 0.65);

    const strongStopRe = /[.!?]["'”’\)\]\}]*\s*$/;
    const openQuoteRe = /^\s*["“'\(\[]/;
    const leadInRe = /(\:|\;|—|\,|\bsuch as\b|\bas follows\b|\bthe following\b|\bincluding\b)\s*$/i;
    const listLineRe = /^\s*(\d+[\.|\)]\s+|box\s+\d+\s*:|line\s+\d+\s*:|part\s+[ivxlcdm]+\b)/i;

    function startsWithOpenQuote(s) {
      return openQuoteRe.test(String(s || '').trimStart());
    }

    function endsWithStrongStop(s) {
      return strongStopRe.test(String(s || '').trim());
    }

    function endsWithLeadIn(s) {
      return leadInRe.test(String(s || '').trim());
    }

    function lastNonEmptyLine(s) {
      const lines = String(s || '').split(/\n/).map(x => x.trim()).filter(Boolean);
      return lines.length ? lines[lines.length - 1] : '';
    }

    function looksLikeListContinuation(bufText, nextText) {
      const lastLine = lastNonEmptyLine(bufText);
      const nextLine = String(nextText || '').split(/\n/).map(x => x.trim()).filter(Boolean)[0] || '';
      return listLineRe.test(lastLine) || listLineRe.test(nextLine);
    }

    function findBestCut(text, maxIdx) {
      const t = String(text || '');
      const limit = Math.min(maxIdx, t.length);
      const slice = t.slice(0, limit);

      // Prefer paragraph boundary near the end.
      const para = slice.lastIndexOf('\n\n');
      if (para > minChars) return para;

      // Prefer strong sentence endings.
      const re = /[.!?]["'”’\)\]\}]*\s+/g;
      let m;
      let best = -1;
      while ((m = re.exec(slice)) !== null) {
        const endPos = re.lastIndex;
        if (endPos < minChars) continue;
        best = endPos;
      }
      if (best > 0) return best;

      // Fallback: whitespace.
      const ws = slice.lastIndexOf(' ');
      if (ws > minChars) return ws;

      return Math.min(limit, Math.max(minChars, Math.round(target)));
    }

    let buf = '';
    const cleanBlocks = (blocks || []).map(b => String(b || '').trim()).filter(Boolean);
    let i = 0;
    while (i < cleanBlocks.length) {
      const b = cleanBlocks[i];
      const nextBlock = (i + 1 < cleanBlocks.length) ? cleanBlocks[i + 1] : '';
      const candidate = buf ? (buf + '\n\n' + b) : b;

      // Keep filling up to target.
      if (candidate.length <= target) {
        buf = candidate;
        i++;
        continue;
      }

      // If buffer is empty and a single block is huge, force split at best cut.
      if (!buf) {
        const cut = findBestCut(candidate, hardMax);
        const page = candidate.slice(0, cut).trim();
        const rem = candidate.slice(cut).trim();
        if (page) pagesOut.push(page);
        buf = rem;
        i++;
        continue;
      }

      // We crossed target with the next block. Decide whether to finalize buf or continue.
      const continuation =
        startsWithOpenQuote(b) ||
        startsWithOpenQuote(nextBlock) ||
        endsWithLeadIn(buf) ||
        looksLikeListContinuation(buf, b);

      const safeToBreak = endsWithStrongStop(buf) && !endsWithLeadIn(buf) && !startsWithOpenQuote(b) && !looksLikeListContinuation(buf, b);

      if (buf.length >= target && safeToBreak && !continuation) {
        pagesOut.push(buf.trim());
        buf = '';
        continue;
      }

      // Otherwise, treat it as continuation: append and allow overflow up to hard max.
      buf = candidate;
      i++;

      if (buf.length >= hardMax) {
        // Forced cut: choose best cut <= hardMax, but avoid leaving a remainder starting with an opening quote.
        let cut = findBestCut(buf, hardMax);
        let page = buf.slice(0, cut).trim();
        let rem = buf.slice(cut).trim();

        // If remainder starts with an opening quote/paren/bracket, backtrack to an earlier cut if possible.
        if (rem && startsWithOpenQuote(rem)) {
          const earlier = findBestCut(buf, Math.max(minChars + 50, cut - 80));
          if (earlier > minChars && earlier < cut) {
            cut = earlier;
            page = buf.slice(0, cut).trim();
            rem = buf.slice(cut).trim();
          }
        }

        if (page) pagesOut.push(page);
        buf = rem;
      }
    }

    if (buf.trim()) pagesOut.push(buf.trim());

    // Cleanup micro-pages by merging into neighbors when safe.
    const merged = [];
    for (let j = 0; j < pagesOut.length; j++) {
      const p = pagesOut[j];
      if (!p) continue;
      if (p.length >= minChars || merged.length === 0) {
        merged.push(p);
        continue;
      }
      // Try merge with previous first.
      const prev = merged[merged.length - 1];
      if ((prev.length + 2 + p.length) <= hardMax) {
        merged[merged.length - 1] = (prev + '\n\n' + p).trim();
        continue;
      }
      // Otherwise merge with next by deferring: keep as-is.
      merged.push(p);
    }
    return merged;
  }

  function buildMarkdownBookFromSections(sections, { pageChars = 1600 } = {}) {
    const out = [];
    (sections || []).forEach((sec) => {
      const title = (sec?.title || 'Untitled Section').trim();
      out.push(`# ${title}`);
      out.push('');
      const pages = chunkBlocksToPages(sec?.blocks || [], pageChars);
      pages.forEach((p, idx) => {
        out.push(`## Page ${idx + 1}`);
        out.push('');
        out.push(p);
        out.push('');
      });
      out.push('');
    });
    return out.join('\n');
  }

  function _normEpubHref(href) {
    return String(href || '')
      .split('#')[0]
      .replace(/^\.\//, '')
      .replace(/^\//, '');
  }

  async function epubParseToc(zip, opfPath) {
    const opfText = await zipReadText(zip, opfPath);
    const opf = xmlParseSafe(opfText);
    if (!opf) return { metadata: {}, items: [] };

    const baseDir = dirOf(opfPath);
    const md = {};
    const titleEl = opf.querySelector('metadata > title, metadata > dc\\:title, dc\\:title');
    const creatorEl = opf.querySelector('metadata > creator, metadata > dc\\:creator, dc\\:creator');
    md.title = (titleEl?.textContent || '').trim();
    md.author = (creatorEl?.textContent || '').trim();

    // Build manifest map
    const manifest = new Map();
    opf.querySelectorAll('manifest > item').forEach((it) => {
      const id = it.getAttribute('id') || '';
      const href = it.getAttribute('href') || '';
      const mediaType = it.getAttribute('media-type') || it.getAttribute('mediaType') || '';
      const props = it.getAttribute('properties') || '';
      if (!id || !href) return;
      manifest.set(id, { id, href: joinPath(baseDir, href), mediaType, props });
    });

    // Spine order (used to extract full chapter ranges)
    const spineIds = [];
    opf.querySelectorAll('spine > itemref').forEach((it) => {
      const idref = it.getAttribute('idref');
      if (idref) spineIds.push(idref);
    });
    const spineHrefs = spineIds
      .map((idref) => manifest.get(idref)?.href)
      .filter(Boolean)
      .map(_normEpubHref);

    // EPUB3 nav
    const navItem = Array.from(manifest.values()).find(v => /\bnav\b/.test(v.props || ''));
    if (navItem) {
      const navHtml = await zipReadText(zip, navItem.href);
      const navDoc = htmlParseSafe(navHtml);
      const tocNav = navDoc?.querySelector('nav[epub\\:type="toc"], nav[epub\\:type="toc" i], nav[type="toc"], nav#toc');
      const links = tocNav ? tocNav.querySelectorAll('a[href]') : navDoc?.querySelectorAll('a[href]');
      const items = [];
      (links ? Array.from(links) : []).forEach((a) => {
        const href = a.getAttribute('href') || '';
        const title = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (!href || !title) return;
        const cleanHref = href.split('#')[0];
        if (!cleanHref) return;
        const full = joinPath(dirOf(navItem.href), cleanHref);
        items.push({ title, href: full });
      });
      // De-dupe
      const seen = new Set();
      const uniq = [];
      for (const it of items) {
        const k = it.title + '|' + it.href;
        if (seen.has(k)) continue;
        seen.add(k);
        uniq.push(it);
      }
      return { metadata: md, items: uniq, spineHrefs };
    }

    // EPUB2 NCX
    const spine = opf.querySelector('spine');
    const tocId = spine?.getAttribute('toc') || '';
    const tocItem = tocId ? manifest.get(tocId) : null;
    if (tocItem) {
      const ncxText = await zipReadText(zip, tocItem.href);
      const ncx = xmlParseSafe(ncxText);
      const navPoints = ncx ? Array.from(ncx.querySelectorAll('navPoint')) : [];
      const items = [];
      navPoints.forEach((np) => {
        const t = (np.querySelector('navLabel > text')?.textContent || '').trim();
        const src = (np.querySelector('content')?.getAttribute('src') || '').trim();
        if (!t || !src) return;
        const cleanHref = src.split('#')[0];
        const full = joinPath(dirOf(tocItem.href), cleanHref);
        items.push({ title: t, href: full });
      });
      return { metadata: md, items, spineHrefs };
    }

    // Worst-case: fall back to spine order
    const items = spineHrefs.map((href, i) => ({ title: `Section ${i + 1}`, href }));
    return { metadata: md, items, spineHrefs };
  }

  async function epubToMarkdownFromSelected(zip, tocItems, selectedIds, spineHrefs, { pageChars = 1600, onProgress = null } = {}) {
    // Extract each selected TOC item as a range in spine order: from its start file until next TOC start.
    const toc = (tocItems || [])
      .slice()
      .filter(x => x && x.href)
      .map((x, idx) => ({ ...x, _order: idx, _hrefNorm: _normEpubHref(x.href) }));

    const spine = Array.isArray(spineHrefs) ? spineHrefs.map(_normEpubHref) : [];
    const hrefToSpineIndex = new Map(spine.map((h, i) => [h, i]));
    toc.forEach((it) => { it.spineIndex = hrefToSpineIndex.has(it._hrefNorm) ? hrefToSpineIndex.get(it._hrefNorm) : null; });

    const chosen = toc.filter(it => selectedIds.has(it.id) && typeof it.spineIndex === 'number');
    chosen.sort((a, b) => a._order - b._order);

    const sections = [];
    let done = 0;
    for (let i = 0; i < chosen.length; i++) {
      const it = chosen[i];
      // Find the next TOC item after this one (regardless of selection) that has a spine index.
      let endSpine = spine.length;
      for (let j = it._order + 1; j < toc.length; j++) {
        const nxt = toc[j];
        if (typeof nxt.spineIndex === 'number' && nxt.spineIndex > it.spineIndex) {
          endSpine = nxt.spineIndex;
          break;
        }
      }

      const blocks = [];
      for (let s = it.spineIndex; s < endSpine; s++) {
        const href = spine[s];
        const html = await zipReadText(zip, href);
        extractTextBlocksFromHtml(html).forEach(b => blocks.push(b));
      }
      sections.push({ title: it.title, blocks });
      done++;
      if (typeof onProgress === 'function') onProgress({ done, total: chosen.length });
    }

    return buildMarkdownBookFromSections(sections, { pageChars });
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

      // Local library
      if (isLocalBookId(id)) {
        try {
          const rec = await localBookGet(stripLocalPrefix(id));
          if (!rec || typeof rec.markdown !== 'string') throw new Error('local book missing');
          currentBookRaw = rec.markdown;
          hasExplicitChapters = countExplicitH1(currentBookRaw) > 0;
          if (hasExplicitChapters) chapterList = parseChaptersFromMarkdown(currentBookRaw);
          refreshChapterAndPagesUI();
          return;
        } catch (e) {
          setSelectOptions(chapterSelect, [], "Failed to load local book");
          setSelectOptions(pageStart, [], "Failed to load local book");
          setSelectOptions(pageEnd, [], "Failed to load local book");
          console.error('Local book load error:', e);
          return;
        }
      }

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

    async function populateBookSelectWithLocal() {
      // Populate server + local books in one dropdown.
      bookSelect.innerHTML = "";

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select a book…";
      bookSelect.appendChild(placeholder);

      // Local books
      let locals = [];
      try { locals = await localBooksGetAll(); } catch (_) { locals = []; }
      if (locals.length) {
        const og = document.createElement('optgroup');
        og.label = 'Saved on this device';
        locals
          .slice()
          .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
          .forEach((b) => {
            const opt = document.createElement('option');
            opt.value = `local:${b.id}`;
            opt.textContent = b.title || 'Untitled (Local)';
            og.appendChild(opt);
          });
        bookSelect.appendChild(og);
      }

      // Server books
      if (manifest.length) {
        const og = document.createElement('optgroup');
        og.label = 'Server books';
        manifest.forEach((b) => {
          const opt = document.createElement('option');
          opt.value = b.id;
          opt.textContent = b.title;
          og.appendChild(opt);
        });
        bookSelect.appendChild(og);
      }

      if (!locals.length && !manifest.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No books found';
        bookSelect.appendChild(opt);
      }
    }

    try {
      await loadManifest();
      await populateBookSelectWithLocal();
    } catch (e) {
      // Even if manifest fails, still show local library.
      manifest = [];
      await populateBookSelectWithLocal();
      console.error("Book manifest load error:", e);
    }

    // Expose a tiny hook so the import modal can refresh the dropdown after import.
    window.__rcRefreshBookSelect = async () => {
      try { await populateBookSelectWithLocal(); } catch (_) {}
    };
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
    if (confirm && !window.confirm("Clear loaded pages and remove your consolidations and feedback?")) return false;

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

        <div class="page-actions">
          <button type="button" class="top-btn tts-btn" data-tts="page" data-page="${i}">🔊 Read page</button>
        </div>

        <div class="anchors-row">
          <div class="anchors-ui anchors-ui--right">
            <div class="anchors-counter" title="Anchors">Anchors Found: 0/0</div>
            <button type="button" class="top-btn hint-btn" disabled>Hint</button>
          </div>
        </div>

        <div class="anchors-nav">
          <button class="top-btn next-btn" onclick="goToNext(${i})">▶ Next</button>
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

      // TTS: Read page text
      const ttsPageBtn = page.querySelector('.tts-btn[data-tts="page"]');
      if (ttsPageBtn) {
        ttsPageBtn.addEventListener("click", () => {
          ttsSpeakQueue(`page-${i}`, [text]);
        });
      }


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
            try {
              displayAIFeedback(i, pageData[i].aiFeedbackRaw, null, feedbackDiv);
            } catch (e) {
              // Fallback: show raw text if formatted renderer fails.
              feedbackDiv.textContent = String(pageData[i].aiFeedbackRaw || '');
            }
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
   * Clear Session (single reset button)
   * - Clears user-facing state: loaded pages + learner work.
   * - Keeps anchors (anchors are version-gated and backend-owned).
   */
  // Single user-facing reset: clears the currently loaded pages and any work tied to them.
  // Keeps anchors (they are version-gated and backend-owned).
  function clearPages() {
    const ok = resetSession({ confirm: true, clearPersistedWork: true, clearAnchors: false });
    if (ok) {
      // Belt-and-suspenders: ensure any pending debounced save can't resurrect state.
      try { persistSessionNow(); } catch (_) {}
      render();
      try { updateDiagnostics(); } catch (_) {}
    }
  }

  // Back-compat alias (older HTML/button wiring)
  function clearSession() { return clearPages(); }

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
      const response = await fetch(apiUrl("/api/evaluate"), {
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
      // IMPORTANT: pass the feedbackDiv so we can render even if the page is mid-render.
      displayAIFeedback(pageIndex, data.feedback || "", null, feedbackDiv);
      // Flush immediately so reloads never miss AI feedback.
      try { persistSessionNow(); } catch (_) {}

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
      const diag = lastAIDiagnostics || null;
      const status = diag && typeof diag.status === 'number' ? diag.status : 0;
      const msg = String(error?.message || error || '').slice(0, 240);
      feedbackDiv.innerHTML =
        `<div style="color:#8B2500;">
          <div><b>AI Evaluate failed</b>${status ? ` (HTTP ${status})` : ''}.</div>
          <div style="opacity:0.85; font-size:13px; margin-top:6px;">${escapeHtml(msg || 'Unknown error')}</div>
          <div style="opacity:0.7; font-size:12px; margin-top:6px;">Tip: open DevTools → Network and look for <code>/api/evaluate</code>. (If you're on GitHub Pages, set <code>?api=</code> to your Vercel deployment.)</div>
        </div>`;
      aiBtn.textContent = '▼ AI Evaluate';
      aiBtn.classList.remove('loading');

      if (pageData?.[pageIndex]) {
        pageData[pageIndex].aiExpanded = false;
        schedulePersistSession();
      }
    }
  }

  function displayAIFeedback(pageIndex, feedback, highlightSnippets = null, feedbackDivOverride = null) {
    // If called during render, the feedback container may not yet be in the DOM.
    // Prefer the passed element, otherwise fall back to the canonical selector.
    const feedbackDiv = feedbackDivOverride || document.querySelector(`.ai-feedback[data-page="${pageIndex}"]`);
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

    // Store parsed strings for optional features (e.g., TTS)
    if (pageData?.[pageIndex]) {
      pageData[pageIndex].aiAnalysisText = analysis || "";
      pageData[pageIndex].aiBetterText = betterExample || "";
      schedulePersistSession();
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
        <div class="better-header">
          <div class="better-label">Better consolidation:</div>
          <button type="button" class="top-btn tts-btn tts-better" data-tts="better" data-page="${pageIndex}">🔊 Read</button>
        </div>
        <div class="better-text">"${betterExample}"</div>
      </div>`;
    }

    // Actions: "Use This Rating" is disabled until the page reaches Evaluation stage.
    const useDisabled = !(rating > 0 && canUseAIRating(pageIndex));
    html += `<div class="ai-actions">`
    html += `<button class="use-rating-btn" data-rating="${rating}" ${useDisabled ? 'disabled' : ''} onclick="applyAIRating(${pageIndex}, ${rating})">Use This Rating (${rating}/5)</button>`;
    html += `<button class="next-after-ai-btn" onclick="goToNext(${pageIndex})">Next Page →</button>`;
    html += `</div>`;
    feedbackDiv.innerHTML = html;

    // TTS: Read feedback statement (analysis) then better consolidation
    const ttsBetterBtn = feedbackDiv.querySelector('.tts-btn[data-tts="better"]');
    if (ttsBetterBtn) {
      ttsBetterBtn.addEventListener("click", () => {
        const a = pageData?.[pageIndex]?.aiAnalysisText || analysis || "";
        const b = pageData?.[pageIndex]?.aiBetterText || betterExample || "";
        ttsSpeakQueue(`better-${pageIndex}`, [a, b]);
      });
    }

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
    // Full credit if >= (1 - COMPRESSION_TOLERANCE) of goal, proportional penalty if below
    const minChars = Math.floor(goalCharCount * (1 - COMPRESSION_TOLERANCE));
    let disciplineScore = 0;
    
    pageData.forEach(p => {
      if (!p.completedOnTime) {
        // Sandstoned: no points
        disciplineScore += 0;
      } else if (p.charCount >= minChars) {
        // Met minimum-length threshold: full points
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
        
        <p><strong>Discipline (${scores.discipline}/${WEIGHT_DISCIPLINE}):</strong> Completed before time runs out. Full credit at ${Math.round((1 - COMPRESSION_TOLERANCE) * 100)}%+ of character goal (${Math.floor(goalCharCount * (1 - COMPRESSION_TOLERANCE))}+ chars). Below that, credit scales proportionally down to zero.</p>
        
        <p><strong>Compression (${scores.compression}/${WEIGHT_COMPRESSION}):</strong> Writing concise summaries that capture meaning without being too brief or verbose. Sweet spot: ${Math.floor(goalCharCount * (1 - COMPRESSION_TOLERANCE))}-${Math.ceil(goalCharCount * (1 + COMPRESSION_TOLERANCE))} characters (${Math.round((1 - COMPRESSION_TOLERANCE) * 100)}-${Math.round((1 + COMPRESSION_TOLERANCE) * 100)}% of goal).</p>
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
      const response = await fetch(apiUrl("/api/summary"), {
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

  // escapeHtml() is defined earlier (single canonical helper).
  
  function getNextTierAdvice(currentTier) {
    const advice = {
      'Fragmented': `Focus on writing substantial consolidations (${Math.round((1 - COMPRESSION_TOLERANCE) * 100)}%+ of your character goal) before time runs out. Discipline means both beating the timer AND writing enough to capture the core idea.`,
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
  // ➕ Import EPUB UI (local-first)
  // ===================================

  (function initEpubImportModal() {
    const openBtn = document.getElementById('importBookBtn');
    const modal = document.getElementById('importBookModal');
    const closeBtn = document.getElementById('importBookClose');

    const dropzone = document.getElementById('importDropzone');
    const browseBtn = document.getElementById('importBrowseBtn');
    const fileInput = document.getElementById('importFileInput');
    const scanBtn = document.getElementById('importScanBtn');
    const uploadStatus = document.getElementById('importUploadStatus');

    const stageUpload = document.getElementById('importStageUpload');
    const stagePick = document.getElementById('importStagePick');
    const stageProgress = document.getElementById('importStageProgress');

    const tocList = document.getElementById('importTocList');
    const filterInput = document.getElementById('importFilter');
    const selectAllBtn = document.getElementById('importSelectAll');
    const selectNoneBtn = document.getElementById('importSelectNone');
    const selectMainBtn = document.getElementById('importSelectMain');
    const selectionMeta = document.getElementById('importSelectionMeta');
    const advancedToggleBtn = document.getElementById('importAdvancedToggle');
    const advancedPanel = document.getElementById('importAdvancedPanel');
    const doImportBtn = document.getElementById('importDoImport');
    const backBtn = document.getElementById('importBackBtn');

    const pageSizeSel = document.getElementById('importPageSize');
    const keepParasChk = document.getElementById('importKeepParagraphs');

    const previewTitle = document.getElementById('importPreviewTitle');
    const previewBody = document.getElementById('importPreviewBody');

    const progMeta = document.getElementById('importProgressMeta');
    const progFill = document.getElementById('importProgressFill');
    const progDetail = document.getElementById('importProgressDetail');
    const doneBtn = document.getElementById('importDoneBtn');

    if (!openBtn || !modal) return;

    let _file = null;
    let _zip = null;
    let _tocItems = []; // {id,title,href,selected,tags,type,preview}
    let _activeId = null;
    let _spineHrefs = [];

    let _advancedMode = false;

    function setAdvancedMode(on) {
      _advancedMode = !!on;
      if (advancedPanel) advancedPanel.style.display = _advancedMode ? 'block' : 'none';
      if (tocList) tocList.style.display = _advancedMode ? 'none' : 'block';
      if (filterInput) filterInput.style.display = _advancedMode ? 'none' : 'block';

      // Hide selection tools when in advanced mode to avoid cramped layout.
      const tools = document.querySelector('.import-picker-tools');
      if (tools) tools.style.display = _advancedMode ? 'none' : 'flex';

      if (advancedToggleBtn) advancedToggleBtn.textContent = _advancedMode ? 'Contents' : 'Advanced';
    }

    function showModal() {
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      // reset view
      showStage('upload');
      setAdvancedMode(false);
    }

    function hideModal() {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }

    function showStage(which) {
      if (stageUpload) stageUpload.style.display = (which === 'upload') ? 'block' : 'none';
      if (stagePick) stagePick.style.display = (which === 'pick') ? 'block' : 'none';
      if (stageProgress) stageProgress.style.display = (which === 'progress') ? 'block' : 'none';
      if (which === 'pick') setAdvancedMode(false);
    }

    function setStatus(msg) {
      if (!uploadStatus) return;
      uploadStatus.style.display = msg ? 'block' : 'none';
      uploadStatus.textContent = msg || '';
    }

    function setProgress(pct, meta, detail) {
      if (progFill) progFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      if (progMeta) progMeta.textContent = meta || '';
      if (progDetail) progDetail.textContent = detail || '';
    }

    function escapeHtmlLite(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function updateSelectionMeta() {
      if (!selectionMeta) return;
      const n = _tocItems.filter(x => x.selected).length;
      selectionMeta.textContent = `Selected: ${n}`;
      if (doImportBtn) doImportBtn.disabled = n === 0;
    }

    function renderToc() {
      if (!tocList) return;
      const q = String(filterInput?.value || '').trim().toLowerCase();
      tocList.innerHTML = '';
      const frag = document.createDocumentFragment();
      _tocItems.forEach((it) => {
        if (q && !String(it.title || '').toLowerCase().includes(q)) return;
        const row = document.createElement('div');
        row.className = 'toc-row' + (it.id === _activeId ? ' is-active' : '');
        row.dataset.id = it.id;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!it.selected;
        cb.addEventListener('click', (e) => {
          e.stopPropagation();
          it.selected = cb.checked;
          updateSelectionMeta();
        });

        const body = document.createElement('div');
        const t = document.createElement('div');
        t.className = 'toc-title';
        t.textContent = it.title || 'Untitled';

        const meta = document.createElement('div');
        meta.className = 'toc-meta';
        meta.textContent = it.type === 'chapter' ? 'Chapter' : (it.type || 'Section');

        const pills = document.createElement('div');
        pills.className = 'toc-pills';
        (it.tags || []).forEach((p) => {
          const pill = document.createElement('span');
          pill.className = 'toc-pill';
          pill.textContent = p;
          pills.appendChild(pill);
        });

        body.appendChild(t);
        body.appendChild(meta);
        if (pills.childNodes.length) body.appendChild(pills);

        row.appendChild(cb);
        row.appendChild(body);

        row.addEventListener('click', async () => {
          _activeId = it.id;
          renderToc();
          if (previewTitle) previewTitle.textContent = it.title || 'Untitled';
          if (previewBody) previewBody.textContent = 'Loading preview…';
          try {
            // Preview the whole section range (from this TOC href until next TOC href in spine order)
            const spine = Array.isArray(_spineHrefs) ? _spineHrefs : [];
            const hrefToIndex = new Map(spine.map((h, idx) => [_normEpubHref(h), idx]));
            const start = hrefToIndex.get(_normEpubHref(it.href));
            let end = spine.length;
            for (let j = it._order + 1; j < _tocItems.length; j++) {
              const nxt = _tocItems[j];
              const ni = hrefToIndex.get(_normEpubHref(nxt.href));
              if (typeof ni === 'number' && typeof start === 'number' && ni > start) { end = ni; break; }
            }
            const blocks = [];
            if (typeof start === 'number') {
              for (let s = start; s < end; s++) {
                const html = await zipReadText(_zip, spine[s]);
                extractTextBlocksFromHtml(html).forEach(b => blocks.push(b));
              }
            }
            const sample = (blocks || []).slice(0, 10).join('\n\n');
            if (previewBody) previewBody.textContent = sample || '(No preview available)';
          } catch (e) {
            if (previewBody) previewBody.textContent = '(Preview failed to load)';
          }
        });

        frag.appendChild(row);
      });
      tocList.appendChild(frag);
    }

    async function onFileSelected(file) {
      _file = file || null;
      _zip = null;
      _tocItems = [];
      _activeId = null;
      if (!scanBtn) return;
      if (!_file) {
        scanBtn.disabled = true;
        setStatus('');
        return;
      }
      scanBtn.disabled = false;
      setStatus(`Selected: ${_file.name} (${Math.round((_file.size || 0) / 1024)} KB)`);
    }

    async function scanContents() {
      if (!_file) return;
      if (!window.JSZip) {
        setStatus('JSZip failed to load. Check your network connection.');
        return;
      }

      try {
        scanBtn.disabled = true;
        setStatus('Reading EPUB…');
        const buf = await _file.arrayBuffer();
        _zip = await JSZip.loadAsync(buf);
        const opfPath = await epubFindOpfPath(_zip);
        if (!opfPath) throw new Error('OPF not found');
        const { metadata, items, spineHrefs } = await epubParseToc(_zip, opfPath);
        _spineHrefs = Array.isArray(spineHrefs) ? spineHrefs : [];
        const baseTitle = (metadata?.title || _file.name.replace(/\.epub$/i, '')).trim();

        // Build toc list with ids
        _tocItems = (items || []).map((it, idx) => {
          const t = (it.title || `Section ${idx + 1}`).trim();

          // Drop obvious junk: TOC titles that are actually full paragraphs.
          const words = t.split(/\s+/).filter(Boolean);
          const looksLikeParagraph = (t.length > 120) || (t.length > 80 && words.length > 14) || (words.length > 24);
          if (looksLikeParagraph) return null;

          const cls = classifySection(t);
          return {
            id: `${idx}:${t}`,
            title: t,
            href: it.href,
            _order: idx,
            type: cls.type,
            tags: cls.tags,
            selected: defaultSelectedForTitle(t)
          };
        }).filter(Boolean);

        // De-dupe obvious junk: empty titles, duplicates by href
        const seenHref = new Set();
        _tocItems = _tocItems.filter((x) => {
          if (!x.title || x.title.length < 2) return false;
          if (!x.href) return false;
          if (seenHref.has(x.href)) return false;
          seenHref.add(x.href);
          return true;
        });

        // Ensure stable order field after filtering
        _tocItems.forEach((x, i) => { x._order = i; });

        // Default preview
        if (previewTitle) previewTitle.textContent = baseTitle;
        if (previewBody) previewBody.textContent = 'Select a section on the left to preview it.';

        updateSelectionMeta();
        renderToc();
        showStage('pick');
      } catch (e) {
        console.error('EPUB scan error:', e);
        setStatus('Failed to scan EPUB. Try another file.');
      } finally {
        scanBtn.disabled = !_file;
      }
    }

    async function doImportSelected() {
      if (!_file || !_zip) return;
      const selectedIds = new Set(_tocItems.filter(x => x.selected).map(x => x.id));
      if (selectedIds.size === 0) return;

      try {
        showStage('progress');
        doneBtn.style.display = 'none';
        setProgress(0, 'Preparing', '');

        const buf = await _file.arrayBuffer();
        const bookHash = await hashArrayBufferSha256(buf);

        // Create a stable record id per file hash
        const id = bookHash;
        const title = _file.name.replace(/\.epub$/i, '').trim();

        const total = selectedIds.size;
        let createdPages = 0;

        // Build markdown
        const pageChars = parseInt(pageSizeSel?.value || '1600', 10) || 1600;
        // keepParasChk is currently informational; paragraph preservation is the default behavior.

        const md = await epubToMarkdownFromSelected(
          _zip,
          _tocItems,
          selectedIds,
          _spineHrefs,
          {
            pageChars,
            onProgress: ({ done, total }) => {
              const pct = total ? Math.round((done / total) * 80) : 0;
              setProgress(pct, `Extracting sections (${done}/${total})`, `${createdPages} pages created`);
            }
          }
        );

        // Estimate page count by counting H2
        createdPages = (md.match(/^\s*##\s+/gm) || []).length;
        setProgress(92, 'Saving to device', `${createdPages} pages created`);

        const record = {
          id,
          title,
          createdAt: Date.now(),
          sourceName: _file.name,
          byteSize: _file.size || 0,
          markdown: md
        };
        await localBookPut(record);

        setProgress(100, 'Import complete', `${createdPages} pages created`);
        doneBtn.style.display = 'inline-block';

        // Refresh book dropdown
        try { if (typeof window.__rcRefreshBookSelect === 'function') await window.__rcRefreshBookSelect(); } catch (_) {}
      } catch (e) {
        console.error('EPUB import error:', e);
        setProgress(100, 'Import failed', 'Try again with a different file.');
        doneBtn.style.display = 'inline-block';
      }
    }

    function setAllSelected(v) {
      _tocItems.forEach((it) => (it.selected = !!v));
      updateSelectionMeta();
      renderToc();
    }

    function selectMain() {
      _tocItems.forEach((it) => {
        it.selected = (it.type === 'chapter' || it.type === 'intro');
      });
      updateSelectionMeta();
      renderToc();
    }

    // Open/close
    openBtn.addEventListener('click', showModal);
    closeBtn?.addEventListener('click', hideModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) hideModal(); });

    // Upload
    browseBtn?.addEventListener('click', () => fileInput?.click());
    dropzone?.addEventListener('click', () => fileInput?.click());
    dropzone?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') fileInput?.click();
    });
    fileInput?.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      onFileSelected(f);
    });

    // Drag/drop
    const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach((ev) => {
      dropzone?.addEventListener(ev, prevent);
    });
    dropzone?.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files && e.dataTransfer.files[0];
      if (f) onFileSelected(f);
    });

    scanBtn?.addEventListener('click', scanContents);
    backBtn?.addEventListener('click', () => showStage('upload'));
    filterInput?.addEventListener('input', renderToc);
    selectAllBtn?.addEventListener('click', () => setAllSelected(true));
    selectNoneBtn?.addEventListener('click', () => setAllSelected(false));
    selectMainBtn?.addEventListener('click', selectMain);
    advancedToggleBtn?.addEventListener('click', () => setAdvancedMode(!_advancedMode));
    doImportBtn?.addEventListener('click', doImportSelected);
    doneBtn?.addEventListener('click', hideModal);
  })();

  // ===================================
  // 🗂️ Manage Library UI
  // ===================================

  (function initManageLibraryModal() {
    const openBtn = document.getElementById('manageLibraryBtn');
    const modal = document.getElementById('manageLibraryModal');
    const closeBtn = document.getElementById('manageLibraryClose');
    const listEl = document.getElementById('manageLibraryList');
    if (!openBtn || !modal || !listEl) return;

    function show() {
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      render();
    }
    function hide() {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }

    async function render() {
      listEl.innerHTML = '';
      let books = [];
      try { books = await localBooksGetAll(); } catch (_) { books = []; }
      if (!books.length) {
        const empty = document.createElement('div');
        empty.className = 'import-status';
        empty.textContent = 'No local books yet. Use “Import EPUB” to add one.';
        listEl.appendChild(empty);
        return;
      }

      books
        .slice()
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .forEach((b) => {
          const row = document.createElement('div');
          row.className = 'library-row';

          const left = document.createElement('div');
          const t = document.createElement('div');
          t.className = 'library-row-title';
          t.textContent = b.title || 'Untitled';
          const m = document.createElement('div');
          m.className = 'library-row-meta';
          const kb = Math.round((b.byteSize || 0) / 1024);
          const pages = (String(b.markdown || '').match(/^\s*##\s+/gm) || []).length;
          m.textContent = `${pages} pages • ~${kb} KB • ${new Date(b.createdAt || Date.now()).toLocaleDateString()}`;
          left.appendChild(t);
          left.appendChild(m);

          const actions = document.createElement('div');
          actions.className = 'library-row-actions';
          const del = document.createElement('button');
          del.className = 'btn-danger';
          del.type = 'button';
          del.textContent = 'Delete';
          del.addEventListener('click', async () => {
            const ok = confirm(`Delete “${b.title || 'this book'}” from this device?`);
            if (!ok) return;
            try {
              await localBookDelete(b.id);
              try { if (typeof window.__rcRefreshBookSelect === 'function') await window.__rcRefreshBookSelect(); } catch (_) {}
              render();
            } catch (e) {
              alert('Delete failed.');
            }
          });
          actions.appendChild(del);

          row.appendChild(left);
          row.appendChild(actions);
          listEl.appendChild(row);
        });
    }

    openBtn.addEventListener('click', show);
    closeBtn?.addEventListener('click', hide);
    modal.addEventListener('click', (e) => { if (e.target === modal) hide(); });
  })();

  // ===================================
  // ☰ Mobile Top Menu
  // ===================================

  (function initTopMenu() {
    const btn = document.getElementById('topMenuBtn');
    const menu = document.getElementById('topMenu');
    const mHow = document.getElementById('topMenuHow');
    const mImport = document.getElementById('topMenuImport');
    const mLib = document.getElementById('topMenuLibrary');

    const howBtn = document.getElementById('howItWorksBtn');
    const importBtn = document.getElementById('importBookBtn');
    const libBtn = document.getElementById('manageLibraryBtn');

    if (!btn || !menu) return;

    function toggle(force) {
      const willOpen = typeof force === 'boolean' ? force : (menu.style.display === 'none' || !menu.style.display);
      menu.style.display = willOpen ? 'block' : 'none';
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });

    document.addEventListener('click', () => toggle(false));
    menu.addEventListener('click', (e) => e.stopPropagation());

    mHow?.addEventListener('click', () => { toggle(false); howBtn?.click(); });
    mImport?.addEventListener('click', () => { toggle(false); importBtn?.click(); });
    mLib?.addEventListener('click', () => { toggle(false); libBtn?.click(); });
  })();

  // ===================================
  // 📘 How This Works (Instructions Modal)
  // ===================================

  (function initHowItWorksModal() {
    const btn = document.getElementById('howItWorksBtn');
    const modal = document.getElementById('howItWorksModal');
    const closeBtn = document.getElementById('howItWorksClose');
    const donateBtn = document.getElementById('donateBtn');

    // Wire donate link from config if present
    try {
      if (donateBtn && typeof BUY_ME_A_COFFEE_URL === 'string' && BUY_ME_A_COFFEE_URL.trim()) {
        donateBtn.href = BUY_ME_A_COFFEE_URL.trim();
      }
    } catch (_) {
      // ignore
    }


    // Support footer is now static at the bottom of the page (no banner logic).

    function openModal() {
      if (!modal) return;
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      // Focus close for accessibility
      if (closeBtn) closeBtn.focus();
    }

    function closeModal() {
      if (!modal) return;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      if (btn) btn.focus();
    }

    if (btn) btn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    // Click outside modal closes
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }

    // ESC closes
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
        closeModal();
      }
    });
  })();

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
    let diagClearCacheBtn = null;
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
      const voiceFemaleBtn = document.getElementById('voiceFemaleBtn');
      const voiceMaleBtn = document.getElementById('voiceMaleBtn');
      const sliders = {
        voice: document.getElementById('vol_voice'),
        music: document.getElementById('vol_music'),
        sand: document.getElementById('vol_sand'),
        stone: document.getElementById('vol_stone'),
        reward: document.getElementById('vol_reward'),
        compass: document.getElementById('vol_compass'),
        pageTurn: document.getElementById('vol_pageTurn'),
        evaluate: document.getElementById('vol_evaluate'),
      };

      function syncSlidersFromState() {
        if (sliders.voice) sliders.voice.value = String(Math.max(0, Math.min(1, Number(TTS_STATE.volume ?? 1))));
        if (sliders.music) sliders.music.value = String(music.volume);
        if (sliders.sand) sliders.sand.value = String(sandSound.volume);
        if (sliders.stone) sliders.stone.value = String(stoneSound.volume);
        if (sliders.reward) sliders.reward.value = String(rewardSound.volume);
        if (sliders.compass) sliders.compass.value = String(compassSound.volume);
        if (sliders.pageTurn) sliders.pageTurn.value = String(pageTurnSound.volume);
        if (sliders.evaluate) sliders.evaluate.value = String(evaluateSound.volume);

        // Sync voice variant toggle
        const vv = String(TTS_STATE.voiceVariant || 'female').toLowerCase();
        if (voiceFemaleBtn && voiceMaleBtn) {
          const isFemale = vv !== 'male';
          voiceFemaleBtn.setAttribute('aria-pressed', String(isFemale));
          voiceMaleBtn.setAttribute('aria-pressed', String(!isFemale));
          voiceFemaleBtn.classList.toggle('is-active', isFemale);
          voiceMaleBtn.classList.toggle('is-active', !isFemale);
        }
      }

      function setVoiceVariant(v) {
        const vv = String(v || '').toLowerCase() === 'male' ? 'male' : 'female';
        TTS_STATE.voiceVariant = vv;
        try { localStorage.setItem('rc_voice_variant', vv); } catch (_) {}
        syncSlidersFromState();
      }

      if (voiceFemaleBtn) voiceFemaleBtn.addEventListener('click', () => setVoiceVariant('female'));
      if (voiceMaleBtn) voiceMaleBtn.addEventListener('click', () => setVoiceVariant('male'));

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
      // Keep fixed buttons above the footer support section at the bottom of the page.
      diagBtn.style.bottom = '96px';

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
          <button type="button" id="diagClearCacheBtn" title="Clears all local cache/state for clean testing">Delete cache</button>
          <button type="button" id="diagCopyBtn">Copy</button>
        </div>
      `;
      document.body.appendChild(diagPanel);

      diagCloseBtn = diagPanel.querySelector('#diagCloseBtn');
      diagText = diagPanel.querySelector('#diagText');
      diagClearCacheBtn = diagPanel.querySelector('#diagClearCacheBtn');
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
      if (diagClearCacheBtn) {
        diagClearCacheBtn.addEventListener('click', async () => {
          const ok = window.confirm(
            'Delete cache?\n\nThis clears ALL local browser storage for this app (including saved work) and reloads the page.'
          );
          if (!ok) return;

          try { localStorage.clear(); } catch (_) {}
          try { sessionStorage.clear(); } catch (_) {}

          // Best-effort: clear Service Worker Cache Storage if present.
          try {
            if (window.caches && caches.keys) {
              const keys = await caches.keys();
              await Promise.all(keys.map((k) => caches.delete(k)));
            }
          } catch (_) {}

          // Reload for a clean boot.
          try {
            window.location.reload();
          } catch (_) {
            window.location.href = window.location.href;
          }
        });
      }
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
    // Ensure we can rehydrate per-page saved work even if the session snapshot lacked hashes.
    ensurePageHashesAndRehydrate();
  }
} catch (_) {}
// ===================================
// Footer-aware music button position
// (updates on scroll AND on content size changes)
// ===================================
(function () {
  const musicBtn = document.getElementById("musicToggle");
  if (!musicBtn) return;

  const SNAP_THRESHOLD = 140; // px

  function updateMusicOffset() {
    const doc = document.documentElement;

    const scrollBottom = window.scrollY + window.innerHeight;
    const docBottom = doc.scrollHeight;

    const nearBottom = (docBottom - scrollBottom) <= SNAP_THRESHOLD;

    musicBtn.style.bottom = nearBottom
      ? `calc(var(--support-footer-height) + 20px)`
      : `20px`;
  }

  // Throttle to one update per frame (prevents observer spam)
  let raf = 0;
  function scheduleUpdate() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      updateMusicOffset();
    });
  }

  // Initial
  scheduleUpdate();

  // Scroll/resize
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("load", scheduleUpdate);

  // Content-size changes (load pages / clear pages / render())
  const pagesEl = document.getElementById("pages");
  const footerEl = document.getElementById("supportFooter");

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(scheduleUpdate);
    if (pagesEl) ro.observe(pagesEl);
    ro.observe(document.body);
    if (footerEl) ro.observe(footerEl);
  }

  // Optional: DOM mutations (covers cases where size changes without a resize)
  if (pagesEl && window.MutationObserver) {
    const mo = new MutationObserver(scheduleUpdate);
    mo.observe(pagesEl, { childList: true, subtree: true, characterData: true });
  }
})();