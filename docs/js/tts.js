// Split from original app.js during role-based phase-1 restructure.
// File: tts.js
// Note: This is still global-script architecture (no bundler/modules required).

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
  // Name of the browser voice currently in use (set by browserSpeakQueue, cleared on stop)
  activeBrowserVoiceName: null,
  playbackRate: 1,
  // sentence highlight state (page read)
  highlightPageKey: null,
  highlightPageEl: null,
  highlightOriginalHTML: null,
  highlightRAF: null,
  highlightSpans: null,
  highlightMarks: null,
  highlightEnds: null,
  lastPageKey: null,
  browserSentenceRanges: null,
  browserPageText: '',
  browserCurrentSentenceIndex: 0,
  browserCurrentCharIndex: 0,
  browserVoice: null,
  browserRestarting: false,
  browserBoundaryHandler: null,
  browserPaused: false,
};

const TTS_DEBUG = {
  seq: 0,
  recent: [],
  lastAction: null,
  lastError: null,
  lastCloudRequest: null,
  lastCloudResponse: null,
  lastSkip: null,
  lastPlayRequest: null,
  lastResolvedPath: null,
  lastPauseStrategy: null,
  lastRouteDecision: null,
};

function ttsDiagClone(data) {
  try { return JSON.parse(JSON.stringify(data ?? null)); } catch (_) { return null; }
}

function ttsDiagPush(event, data = {}) {
  try {
    const entry = {
      seq: ++TTS_DEBUG.seq,
      at: new Date().toISOString(),
      event,
      data: ttsDiagClone(data) || {}
    };
    TTS_DEBUG.lastAction = entry;
    TTS_DEBUG.recent.push(entry);
    if (TTS_DEBUG.recent.length > 80) TTS_DEBUG.recent.splice(0, TTS_DEBUG.recent.length - 80);
    return entry;
  } catch (_) { return null; }
}

function getStoredSelectedVoice() {
  try { return localStorage.getItem('rc_browser_voice') || ''; } catch (_) { return ''; }
}


function getSelectedVoicePreference() {
  const stored = getStoredSelectedVoice();
  const type = stored.startsWith('cloud:') ? 'cloud' : (stored ? 'browser' : 'auto');
  return {
    stored,
    type,
    explicitCloud: type === 'cloud',
    requestedCloudVoiceId: type === 'cloud' ? stored.slice('cloud:'.length) : null
  };
}

function getPreferredTtsRouteInfo() {
  const tier = (typeof appTier !== 'undefined' && appTier) ? String(appTier) : 'free';
  const selected = getSelectedVoicePreference();
  const support = getTtsSupportStatus();
  const cloudCapable = tier !== 'free';
  let requestedPath = cloudCapable ? 'cloud-preferred' : 'browser-free';
  let reason = cloudCapable ? 'paid-tier-cloud-path' : 'free-tier-browser-path';
  if (selected.explicitCloud) {
    requestedPath = cloudCapable ? 'cloud-selected' : 'browser-free';
    reason = cloudCapable ? 'explicit-cloud-selection' : 'cloud-selection-blocked-by-tier';
  }
  return {
    tier,
    cloudCapable,
    requestedPath,
    reason,
    selected,
    support,
    browserFallbackAllowed: cloudCapable && !selected.explicitCloud
  };
}

function getTtsDiagnosticsSnapshot() {
  const countdown = typeof getCountdownStatus === 'function' ? getCountdownStatus() : { active: false, pageIndex: -1, seconds: 0 };
  const playback = typeof getPlaybackStatus === 'function' ? getPlaybackStatus() : { active: !!TTS_STATE.activeKey, paused: false, key: TTS_STATE.activeKey || null, playbackRate: getPlaybackRate() };
  let synth = { supported: false, speaking: false, paused: false, pending: false, voices: 0 };
  try {
    synth.supported = !!browserTtsSupported();
    if (synth.supported && window.speechSynthesis) {
      synth.speaking = !!window.speechSynthesis.speaking;
      synth.paused = !!window.speechSynthesis.paused;
      synth.pending = !!window.speechSynthesis.pending;
      synth.voices = (window.speechSynthesis.getVoices() || []).length;
    }
  } catch (_) {}
  const activeAudio = TTS_STATE.audio || TTS_AUDIO_ELEMENT || null;
  let audio = { present: !!activeAudio, paused: null, currentTime: null, playbackRate: null, src: null, loop: null };
  try {
    if (activeAudio) {
      audio.paused = !!activeAudio.paused;
      audio.currentTime = Number(activeAudio.currentTime || 0);
      audio.playbackRate = Number(activeAudio.playbackRate || 0);
      audio.src = activeAudio.currentSrc || activeAudio.src || null;
      audio.loop = !!activeAudio.loop;
    }
  } catch (_) {}
  let inferredPageIndex = -1;
  try { if (typeof inferCurrentPageIndex === 'function') inferredPageIndex = inferCurrentPageIndex(); } catch (_) {}
  let focusedPageIndex = -1;
  try { if (typeof lastFocusedPageIndex !== 'undefined') focusedPageIndex = Number(lastFocusedPageIndex); } catch (_) {}
  return {
    userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '',
    location: (typeof location !== 'undefined') ? { href: location.href, search: location.search } : null,
    support: {
      browserTts: synth.supported,
      speechSynthesis: !!(typeof window !== 'undefined' && window.speechSynthesis),
      audioElement: !!(typeof Audio !== 'undefined')
    },
    playback,
    countdown,
    pages: {
      inferredPageIndex,
      focusedPageIndex,
      activeKey: TTS_STATE.activeKey || null,
      lastPageKey: TTS_STATE.lastPageKey || null
    },
    voice: {
      variant: TTS_STATE.voiceVariant || 'female',
      selected: getStoredSelectedVoice(),
      selection: getSelectedVoicePreference(),
      activeBrowserVoice: TTS_STATE.activeBrowserVoiceName || null,
      effectiveBrowserVoice: TTS_STATE.browserVoice ? (TTS_STATE.browserVoice.name || null) : null
    },
    routing: getPreferredTtsRouteInfo(),
    supportStatus: getTtsSupportStatus(),
    speed: {
      selected: getPlaybackRate(),
      state: Number(TTS_STATE.playbackRate || 0),
      audio: audio.playbackRate
    },
    browserSpeech: {
      speaking: synth.speaking,
      paused: synth.paused,
      pending: synth.pending,
      voices: synth.voices,
      currentSentenceIndex: Number(TTS_STATE.browserCurrentSentenceIndex || 0),
      currentCharIndex: Number(TTS_STATE.browserCurrentCharIndex || 0),
      sentenceCount: Array.isArray(TTS_STATE.browserSentenceRanges) ? TTS_STATE.browserSentenceRanges.length : 0
    },
    audio,
    highlight: {
      pageKey: TTS_STATE.highlightPageKey || null,
      spanCount: Array.isArray(TTS_STATE.highlightSpans) ? TTS_STATE.highlightSpans.length : 0,
      marksCount: Array.isArray(TTS_STATE.highlightMarks) ? TTS_STATE.highlightMarks.length : 0
    },
    unlock: { unlocked: !!TTS_AUDIO_UNLOCKED },
    last: {
      action: TTS_DEBUG.lastAction,
      error: TTS_DEBUG.lastError,
      skip: TTS_DEBUG.lastSkip,
      playRequest: TTS_DEBUG.lastPlayRequest,
      cloudRequest: TTS_DEBUG.lastCloudRequest,
      cloudResponse: TTS_DEBUG.lastCloudResponse,
      pauseStrategy: TTS_DEBUG.lastPauseStrategy,
      routeDecision: TTS_DEBUG.lastRouteDecision,
      resolvedPath: TTS_DEBUG.lastResolvedPath
    },
    recentEvents: TTS_DEBUG.recent.slice(-30)
  };
}


// Safari/iOS requires a user gesture before audio.play() is allowed.
// We unlock audio on the first interaction so autoplay later works.
let TTS_AUDIO_UNLOCKED = false;
// Persistent audio element (Safari requires reuse for autoplay chains)
const TTS_AUDIO_ELEMENT = new Audio();
TTS_AUDIO_ELEMENT.preload = "auto";
setPlaybackRate(ttsLoadPlaybackRate());

// Tiny silent MP3 used to prime TTS_AUDIO_ELEMENT within a user gesture.
const TTS_SILENT_SRC = "data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAA";


function ttsNormalizePlaybackRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.5, Math.min(2, n));
}

function ttsLoadPlaybackRate() {
  try {
    const saved = localStorage.getItem('rc_tts_speed');
    if (saved == null || saved === '') return 1;
    return ttsNormalizePlaybackRate(saved);
  } catch (_) {
    return 1;
  }
}

function setPlaybackRate(value) {
  const rate = ttsNormalizePlaybackRate(value);
  TTS_STATE.playbackRate = rate;
  try { localStorage.setItem('rc_tts_speed', String(rate)); } catch (_) {}
  try {
    TTS_AUDIO_ELEMENT.defaultPlaybackRate = rate;
    TTS_AUDIO_ELEMENT.playbackRate = rate;
  } catch (_) {}
  try {
    if (TTS_STATE.audio) {
      TTS_STATE.audio.defaultPlaybackRate = rate;
      TTS_STATE.audio.playbackRate = rate;
    }
  } catch (_) {}
  ttsDiagPush('set-playback-rate', { rate });
  return rate;
}


function applyCurrentPlaybackRate() {
  return setPlaybackRate(getPlaybackRate());
}

function getPlaybackRate() {
  if (!Number.isFinite(TTS_STATE.playbackRate) || TTS_STATE.playbackRate <= 0) {
    TTS_STATE.playbackRate = ttsLoadPlaybackRate();
  }
  return ttsNormalizePlaybackRate(TTS_STATE.playbackRate);
}

function getPlaybackStatus() {
  let paused = !!TTS_STATE.browserPaused;
  try {
    if (TTS_STATE.audio) {
      paused = !!TTS_STATE.audio.paused;
    } else if (!TTS_STATE.browserPaused && browserTtsSupported()) {
      paused = !!window.speechSynthesis.paused;
    }
  } catch (_) {}
  return {
    active: !!TTS_STATE.activeKey,
    paused,
    key: TTS_STATE.activeKey || null,
    playbackRate: getPlaybackRate()
  };
}

function getAutoplayStatus() {
  return { enabled: !!AUTOPLAY_STATE.enabled };
}

function getCountdownStatus() {
  return {
    pageIndex: Number(AUTOPLAY_STATE.countdownPageIndex ?? -1),
    seconds: Number(AUTOPLAY_STATE.countdownSec ?? 0) || 0,
    active: Number(AUTOPLAY_STATE.countdownPageIndex ?? -1) !== -1 && Number(AUTOPLAY_STATE.countdownSec ?? 0) > 0
  };
}


function getTtsSupportStatus() {
  const tier = (typeof appTier !== 'undefined' && appTier) ? String(appTier) : 'free';
  const browserSupported = !!browserTtsSupported();
  const browserVoice = browserSupported ? browserPickVoice() : null;
  const browserVoices = (() => {
    try {
      return browserSupported ? (window.speechSynthesis.getVoices() || []).filter(v => (v.lang || '').toLowerCase().startsWith('en')).length : 0;
    } catch (_) {
      return 0;
    }
  })();
  const freePlayable = browserSupported && !!browserVoice;
  const playable = tier === 'free' ? freePlayable : true;
  const selected = getSelectedVoicePreference();
  return {
    tier,
    browserSupported,
    browserVoices,
    browserVoiceAvailable: !!browserVoice,
    browserVoiceName: browserVoice ? (browserVoice.name || null) : null,
    freePlayable,
    playable,
    selected,
    reason: freePlayable ? '' : 'No browser English voice is available on this device.'
  };
}

function pauseOrResumeReading() {
  const status = getPlaybackStatus();
  if (!status.active) return status;
  if (status.paused) ttsResume();
  else ttsPause();
  const nextStatus = getPlaybackStatus();
  TTS_DEBUG.lastRouteDecision = getPreferredTtsRouteInfo();
  ttsDiagPush('toggle-pause-resume', { before: status, after: nextStatus, route: TTS_DEBUG.lastRouteDecision });
  return nextStatus;
}

function toggleAutoplay(force) {
  const next = typeof force === 'boolean' ? force : !AUTOPLAY_STATE.enabled;
  AUTOPLAY_STATE.enabled = !!next;
  try {
    const checkbox = document.getElementById('autoplayToggle');
    if (checkbox) checkbox.checked = AUTOPLAY_STATE.enabled;
  } catch (_) {}
  try { localStorage.setItem('rc_autoplay', AUTOPLAY_STATE.enabled ? '1' : '0'); } catch (_) {}
  if (!AUTOPLAY_STATE.enabled) ttsAutoplayCancelCountdown();
  return getAutoplayStatus();
}


function ttsUnlockAudio() {
  // Prime TTS_AUDIO_ELEMENT — the actual playback element — synchronously
  // within the current user gesture. We do this on every gesture, not just
  // once, because Safari (especially iPadOS) revokes permission when the
  // element has been idle between interactions.
  //
  // Key fixes vs. the old implementation:
  //  1. We prime TTS_AUDIO_ELEMENT itself, not a throwaway new Audio().
  //     Safari's unlock is element-specific on iPadOS; priming a different
  //     element does not carry over to TTS_AUDIO_ELEMENT.
  //  2. No early-return guard — re-prime on every user-initiated call so the
  //     element stays warm even if the user taps "Read page" on separate pages.
  //  3. We intentionally do NOT await this play() call. It must fire and return
  //     synchronously so Safari registers it within the gesture window. The
  //     fetch (pollyFetchUrl) happens after this, keeping the element "live"
  //     while the network request is in flight.
  if (TTS_AUDIO_ELEMENT.loop) return; // already warm from autoplay keep-warm
  ttsDiagPush('unlock-audio-attempt');

  try {
    TTS_AUDIO_ELEMENT.pause();
    TTS_AUDIO_ELEMENT.src = TTS_SILENT_SRC;
    TTS_AUDIO_ELEMENT.volume = 0;
    const p = TTS_AUDIO_ELEMENT.play();
    if (p && typeof p.then === "function") {
      p.then(() => { TTS_AUDIO_UNLOCKED = true; }).catch(() => {});
    } else {
      TTS_AUDIO_UNLOCKED = true;
    }
  } catch (_) {}
}

//For autoplay
const AUTOPLAY_STATE = {
  enabled: false,
  countdownPageIndex: -1,
  countdownSec: 0,
  countdownTimerId: null,
};

// Keep TTS_AUDIO_ELEMENT silently "active" between pages during an autoplay
// countdown so Safari (iPadOS) does not revoke playback permission across the
// 3-second gap. Without this, the element goes idle after onended fires and
// Safari rejects the next programmatic .play() call.
// Call this right before ttsAutoplayScheduleNext(); ttsStop() clears the loop.
function ttsKeepWarmForAutoplay() {
  if (!AUTOPLAY_STATE.enabled) return;
  try {
    TTS_AUDIO_ELEMENT.loop = true;
    TTS_AUDIO_ELEMENT.src = TTS_SILENT_SRC;
    TTS_AUDIO_ELEMENT.volume = 0;
    TTS_AUDIO_ELEMENT.play().catch(() => {});
  } catch (_) {}
}

function ttsSetButtonActive(key, active) {
  try {
    if (typeof key !== 'string' || !key.startsWith('page-')) return;
    const pageIndex = parseInt(key.slice(5), 10);
    if (!Number.isFinite(pageIndex)) return;
    const pageEl = document.querySelectorAll('.page')[pageIndex];
    if (!pageEl) return;
    const btn = pageEl.querySelector('.tts-btn[data-tts="page"]');
    if (!btn) return;
    btn.classList.toggle('tts-active', active);
  } catch (_) {}
}

function ttsSetHintButton(key, disabled) {
  try {
    if (typeof key !== 'string' || !key.startsWith('page-')) return;
    const pageIndex = parseInt(key.slice(5), 10);
    if (!Number.isFinite(pageIndex)) return;
    const pageEl = document.querySelectorAll('.page')[pageIndex];
    if (!pageEl) return;
    const btn = pageEl.querySelector('.hint-btn');
    if (!btn) return;
    btn.disabled = disabled;
  } catch (_) {}
}

function ttsAutoplayCancelCountdown() {
  // Capture index BEFORE resetting state so the button reset can find the right page.
  const idx = AUTOPLAY_STATE.countdownPageIndex;

  if (AUTOPLAY_STATE.countdownTimerId) clearInterval(AUTOPLAY_STATE.countdownTimerId);
  AUTOPLAY_STATE.countdownTimerId = null;
  AUTOPLAY_STATE.countdownPageIndex = -1;
  AUTOPLAY_STATE.countdownSec = 0;
  ttsDiagPush('countdown-cancel', { pageIndex: idx });

  // Reset button text on the page that was counting down.
  try {
    const pageEls = document.querySelectorAll('.page');
    if (idx >= 0 && pageEls[idx]) {
      const btn = pageEls[idx].querySelector('.tts-btn[data-tts="page"]');
      if (btn) {
        btn.textContent = '🔊 Read page';
        btn.classList.remove('tts-active');
      }
    }
  } catch (_) {}
}

function ttsAutoplayScheduleNext(pageIndex) {
  if (!AUTOPLAY_STATE.enabled) return;

  ttsDiagPush('countdown-schedule', { pageIndex });
  const pageEls = document.querySelectorAll('.page');
  const nextIndex = pageIndex + 1;
  if (nextIndex >= pageEls.length) return; // no next page

  const currentPageEl = pageEls[pageIndex];
  if (!currentPageEl) return;
  const btn = currentPageEl.querySelector('.tts-btn[data-tts="page"]');
  if (!btn) return;

  AUTOPLAY_STATE.countdownPageIndex = pageIndex;
  AUTOPLAY_STATE.countdownSec = 3;

  // Keep the button visually active during the countdown
  btn.classList.add('tts-active');

  function updateBtn() {
    if (btn) btn.textContent = `▶ Next in ${AUTOPLAY_STATE.countdownSec}…`;
  }
  updateBtn();

  AUTOPLAY_STATE.countdownTimerId = setInterval(() => {
    AUTOPLAY_STATE.countdownSec -= 1;
    if (AUTOPLAY_STATE.countdownSec <= 0) {
      ttsAutoplayCancelCountdown();
      // Scroll to next page
      const nextPageEl = pageEls[nextIndex];
      if (nextPageEl) {
        if (typeof window.scrollReadingPageIntoView === 'function') window.scrollReadingPageIntoView(nextPageEl, { behavior: 'smooth' });
        else nextPageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      // Start reading next page after scroll settles
      setTimeout(() => {
        const text = (typeof pages !== 'undefined' && pages[nextIndex]) ? pages[nextIndex] : '';
        if (text) ttsSpeakQueue(`page-${nextIndex}`, [text]);
      }, 400);
    } else {
      updateBtn();
    }
  }, 1000);
}

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
  TTS_STATE.browserSentenceRanges = null;
  TTS_STATE.browserPageText = '';
  TTS_STATE.browserCurrentSentenceIndex = 0;
  TTS_STATE.browserCurrentCharIndex = 0;
  TTS_STATE.browserBoundaryHandler = null;

  if (TTS_STATE.highlightRAF) {
    cancelAnimationFrame(TTS_STATE.highlightRAF);
    TTS_STATE.highlightRAF = null;
  }
  if (TTS_STATE.highlightPageEl && TTS_STATE.highlightOriginalHTML != null) {
    TTS_STATE.highlightPageEl.innerHTML = TTS_STATE.highlightOriginalHTML;

    // Re-enable the Hint button for this page now that TTS is done.
    try {
      const pageEl = TTS_STATE.highlightPageEl.closest('.page');
      if (pageEl) {
        const hintBtn = pageEl.querySelector('.hint-btn');
        if (hintBtn) hintBtn.disabled = false;
      }
    } catch (_) {}
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

  // Disable Hint button while TTS is highlighting — clicking it would replace
  // innerHTML and destroy the sentence spans. Re-enabled in ttsClearSentenceHighlight.
  try {
    const hintBtn = pageEl.querySelector('.hint-btn');
    if (hintBtn) hintBtn.disabled = true;
  } catch (_) {}
}

// ttsPrepareEstimatedHighlight — used when no speech marks are available (e.g. Azure).
// Splits text into sentences client-side and estimates timing proportionally from
// character count. Actual times are refined once audio duration is known (loadedmetadata).
// The highlight loop (ttsStartHighlightLoop) then advances normally via audio.currentTime.
function ttsPrepareEstimatedHighlight(key, rawText, audio) {
  if (!optsForKeySentenceMarks(key)) return;
  if (!rawText || !audio) return;

  const pageIndex = Number(String(key).slice(5));
  if (!Number.isFinite(pageIndex)) return;

  const pageEl = document.querySelectorAll('.page')[pageIndex];
  if (!pageEl) return;
  const textEl = pageEl.querySelector(".page-text");
  if (!textEl) return;

  ttsClearSentenceHighlight();

  const text = String(rawText || textEl.textContent || "");

  // Split into sentence ranges by punctuation
  const sentenceRegex = /[^.!?]*[.!?]+["']?\s*/g;
  const charRanges = [];
  let match;
  while ((match = sentenceRegex.exec(text)) !== null) {
    charRanges.push({ start: match.index, end: match.index + match[0].length });
  }
  if (!charRanges.length) charRanges.push({ start: 0, end: text.length });

  // Build spans HTML
  const spansHtml = [];
  let cursor = 0;
  for (let i = 0; i < charRanges.length; i++) {
    const r = charRanges[i];
    if (r.start > cursor) spansHtml.push(escapeHTML(text.slice(cursor, r.start)));
    spansHtml.push(`<span class="tts-sentence" data-tts-sent="${i}">${escapeHTML(text.slice(r.start, r.end))}</span>`);
    cursor = r.end;
  }
  if (cursor < text.length) spansHtml.push(escapeHTML(text.slice(cursor)));

  TTS_STATE.highlightPageKey = key;
  TTS_STATE.highlightPageEl = textEl;
  TTS_STATE.highlightOriginalHTML = textEl.innerHTML;

  textEl.innerHTML = spansHtml.join('');
  TTS_STATE.highlightSpans = Array.from(textEl.querySelectorAll('.tts-sentence'));

  try {
    const hintBtn = pageEl.querySelector('.hint-btn');
    if (hintBtn) hintBtn.disabled = true;
  } catch (_) {}

  // Estimate timing: distribute audio duration proportionally by character count.
  // Uses a conservative placeholder first, then refines on first timeupdate
  // (which fires reliably on all platforms including Safari/iOS during playback,
  // unlike loadedmetadata which may not re-fire on a reused audio element).
  function buildTimings(duration) {
    const totalChars = charRanges.reduce((s, r) => s + (r.end - r.start), 0) || 1;
    let elapsed = 0;
    const marks = charRanges.map(r => {
      const frac = (r.end - r.start) / totalChars;
      const sentDuration = frac * duration;
      const timeMs = elapsed * 1000;
      elapsed += sentDuration;
      return { time: timeMs, start: r.start, end: r.end };
    });
    TTS_STATE.highlightMarks = marks;
    TTS_STATE.highlightEnds = marks.map((m, i) =>
      i + 1 < marks.length ? marks[i + 1].time : Infinity
    );
  }

  // Start with placeholder — any reasonable duration works for early highlighting
  buildTimings(60);

  // Refine once on first timeupdate when we know actual duration and position.
  // timeupdate fires during playback on all platforms including Safari/iOS.
  let refined = false;
  function onTimeUpdate() {
    if (refined) return;
    if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
      refined = true;
      buildTimings(audio.duration);
      audio.removeEventListener('timeupdate', onTimeUpdate);
    }
  }
  audio.addEventListener('timeupdate', onTimeUpdate);
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
  // Select the best available system voice for Free tier TTS.
  // Checks for a user-selected voice stored in localStorage first.
  // Falls back to the auto-selection priority list if none is stored or found.
  // Filters out Safari novelty voices before any selection.
  try {
    const voices = window.speechSynthesis.getVoices() || [];
    const isMale = String(TTS_STATE.voiceVariant || '').toLowerCase() === 'male';

    const BAD_VOICES = [
      'Albert', 'Bad News', 'Bells', 'Boing', 'Bubbles', 'Cellos',
      'Deranged', 'Good News', 'Hysterical', 'Jester', 'Organ',
      'Superstar', 'Whisper', 'Zarvox', 'Trinoids'
    ];
    const usable   = voices.filter(v => !BAD_VOICES.some(b => v.name.includes(b)));
    const enVoices = usable.filter(v => (v.lang || '').toLowerCase().startsWith('en'));

    // User-selected voice takes priority if it's still available
    try {
      const saved = localStorage.getItem('rc_browser_voice');
      if (saved) {
        const match = enVoices.find(v => v.name === saved);
        if (match) return match;
      }
    } catch (_) {}

    // Auto-selection: named high-quality voices by gender preference.
    // Daniel ranks first on male — best sounding Safari voice on Apple devices.
    // Alex is macOS high-quality, sometimes exposed by Safari.
    const femaleNames = ['Aria', 'Jenny', 'Samantha', 'Karen', 'Moira', 'Serena', 'Tessa'];
    const maleNames   = ['Daniel', 'Rishi', 'Alex', 'Guy', 'Ryan', 'Fred'];
    const preferred   = isMale ? maleNames : femaleNames;
    const fallback    = isMale ? femaleNames : maleNames;

    const findNamed = (nameList) =>
      enVoices.find(v => nameList.some(n => v.name.includes(n)));

    return (
      findNamed(preferred) ||
      findNamed(fallback)  ||
      enVoices.find(v => /Microsoft/i.test(v.name)) ||
      enVoices.find(v => /Google/i.test(v.name))    ||
      enVoices[0]  ||
      usable[0]    ||
      null
    );
  } catch (_) {
    return null;
  }
}

function ttsStop() {
  // Clear active state and re-enable hint buttons on any TTS read-page button
  try {
    document.querySelectorAll('.tts-btn[data-tts="page"].tts-active')
      .forEach(btn => btn.classList.remove('tts-active'));
  } catch (_) {}
  try {
    if (TTS_STATE.activeKey) ttsSetHintButton(TTS_STATE.activeKey, false);
  } catch (_) {}

  // ensures any countdown stops
  ttsAutoplayCancelCountdown(); 
  if (TTS_STATE.abort) try { TTS_STATE.abort.abort(); } catch (_) {}

  // Stop any in-flight fetch
  if (TTS_STATE.abort) {
    try { TTS_STATE.abort.abort(); } catch (_) {}
    TTS_STATE.abort = null;
  }
  // Stop any audio playback (including the autoplay keep-warm silent loop)
  if (TTS_STATE.audio) {
    try {
      TTS_AUDIO_ELEMENT.loop = false;
      TTS_AUDIO_ELEMENT.pause();
      TTS_AUDIO_ELEMENT.removeAttribute("src");
      TTS_AUDIO_ELEMENT.load();
    } catch (_) {}
    TTS_STATE.audio = null;
  }
  // Stop browser fallback
  browserTtsStop();
  ttsClearSentenceHighlight();
  TTS_STATE.activeKey = null;
  TTS_STATE.activeBrowserVoiceName = null;
  TTS_STATE.browserPaused = false;
  TTS_STATE.browserRestarting = false;
  ttsDiagPush('stop', { activeKey: TTS_STATE.activeKey, lastPageKey: TTS_STATE.lastPageKey });
}

function ttsPause() {
  ttsDiagPush('pause-request', { activeKey: TTS_STATE.activeKey || null });
  if (!TTS_STATE.activeKey) return;
  // Suspend RAF highlight loop without clearing state
  if (TTS_STATE.highlightRAF) {
    cancelAnimationFrame(TTS_STATE.highlightRAF);
    TTS_STATE.highlightRAF = null;
  }
  // Cloud TTS: pause HTML Audio element
  if (TTS_STATE.audio) {
    try { TTS_STATE.audio.pause(); } catch (_) {}
    TTS_DEBUG.lastPauseStrategy = 'cloud-audio-pause';
  }
  // Browser TTS: pause speechSynthesis. Some Edge online voices report speaking
  // but never enter the paused state; fall back to a controlled cancel + resume.
  if (browserTtsSupported()) {
    try {
      window.speechSynthesis.pause();
      const synthPaused = !!window.speechSynthesis.paused;
      const synthSpeaking = !!window.speechSynthesis.speaking;
      if (!synthPaused && synthSpeaking) {
        TTS_STATE.browserPaused = true;
        TTS_STATE.browserRestarting = true;
        try { window.speechSynthesis.cancel(); } catch (_) {}
        TTS_STATE.browserRestarting = false;
        TTS_DEBUG.lastPauseStrategy = 'browser-cancel-restart-fallback';
        ttsDiagPush('browser-pause-fallback', {
          key: TTS_STATE.activeKey || null,
          sentenceIndex: Number(TTS_STATE.browserCurrentSentenceIndex || 0),
          charIndex: Number(TTS_STATE.browserCurrentCharIndex || 0)
        });
      } else {
        TTS_STATE.browserPaused = synthPaused;
        TTS_DEBUG.lastPauseStrategy = synthPaused ? 'browser-speechsynthesis-pause' : 'browser-pause-noop';
      }
    } catch (_) {}
  }
}

function ttsResume() {
  ttsDiagPush('resume-request', { activeKey: TTS_STATE.activeKey || null, rate: getPlaybackRate() });
  if (!TTS_STATE.activeKey) return;
  // Cloud TTS: resume HTML Audio element and restart highlight loop
  if (TTS_STATE.audio && TTS_STATE.audio.paused) {
    try {
      try {
        TTS_STATE.audio.defaultPlaybackRate = getPlaybackRate();
        TTS_STATE.audio.playbackRate = getPlaybackRate();
      } catch (_) {}
      TTS_STATE.audio.play().catch(() => {});
      ttsStartHighlightLoop(TTS_STATE.audio);
    } catch (_) {}
  }
  // Browser TTS: resume speechSynthesis or restart from the last tracked sentence
  if (browserTtsSupported()) {
    try {
      if (TTS_STATE.browserPaused && TTS_STATE.activeKey && /^page-\d+$/.test(String(TTS_STATE.activeKey || ''))) {
        TTS_DEBUG.lastPauseStrategy = 'browser-restart-from-sentence';
        const resumed = browserSpeakPageFromSentence(TTS_STATE.activeKey, Number(TTS_STATE.browserCurrentSentenceIndex || 0));
        TTS_STATE.browserPaused = !resumed;
        return;
      }
      window.speechSynthesis.resume();
      TTS_STATE.browserPaused = !!window.speechSynthesis.paused;
      TTS_DEBUG.lastPauseStrategy = 'browser-speechsynthesis-resume';
    } catch (_) {}
  }
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
  const selectedVoicePref = getSelectedVoicePreference();
  TTS_DEBUG.lastCloudRequest = { chars: String(text || '').length, sentenceMarks: !!(opts && opts.sentenceMarks), selectedVoice: selectedVoicePref.stored, selectedVoiceType: selectedVoicePref.type, requestedVoiceId: selectedVoicePref.requestedCloudVoiceId, variant: TTS_STATE.voiceVariant || 'female' };
  ttsDiagPush('cloud-request-build', TTS_DEBUG.lastCloudRequest);
  if (opts && opts.sentenceMarks) payload.speechMarks = "sentence";

  // Cost control: use premium Polly engine only when the *page* is in debug mode.
  // Server defaults to STANDARD otherwise.
  try {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('debug') === '1') payload.debug = '1';
  } catch (_) {}

  // Optional voice variant (server maps male/female to env vars).
  // Default is female if omitted.
  try {
    if (String(TTS_STATE.voiceVariant || '').toLowerCase() === 'male') {
      payload.voiceVariant = 'male';
    }
  } catch (_) {}

  // If the user selected a specific cloud voice (stored as 'cloud:aura-orion-en'),
  // forward the model id to the backend as voiceId so it overrides the env default.
  try {
    const saved = localStorage.getItem('rc_browser_voice') || '';
    if (saved.startsWith('cloud:')) {
      payload.voiceId = saved.slice('cloud:'.length);
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
    TTS_DEBUG.lastCloudResponse = { ok: false, status: res.status, payload: data || null, rawText: rawText || '' };
    const detail = data?.detail || data?.message || rawText || "";
    const msg = data?.error
      ? `${data.error}${detail ? `: ${detail}` : ""}`
      : `TTS request failed (${res.status})${detail ? `: ${detail}` : ""}`;
    throw new Error(msg);
  }
  TTS_DEBUG.lastCloudResponse = {
    ok: true,
    status: res.status,
    provider: data?.provider || null,
    cacheHit: !!data?.cacheHit,
    debug: data?.debug || null
  };
  ttsDiagPush('cloud-response', TTS_DEBUG.lastCloudResponse);
  return { url: data.url, sentenceMarks: Array.isArray(data.sentenceMarks) ? data.sentenceMarks : null };
}

function ttsRememberLastPageKey(key) {
  if (typeof key === "string" && /^page-\d+$/.test(key)) TTS_STATE.lastPageKey = key;
}

function browserSetHighlightedSentence(idx) {
  if (!TTS_STATE.highlightSpans) return;
  TTS_STATE.highlightSpans.forEach((span, i) => {
    try { span.style.setProperty("--tts-alpha", i === idx ? "1" : "0"); } catch (_) {}
  });
}

function browserFindSentenceIndexForChar(charIndex) {
  const ranges = TTS_STATE.browserSentenceRanges || [];
  if (!ranges.length) return 0;
  for (let i = 0; i < ranges.length; i++) {
    if (charIndex >= ranges[i].start && charIndex < ranges[i].end) return i;
  }
  return Math.max(0, ranges.length - 1);
}

function browserSpeakPageFromSentence(key, sentenceIndex) {
  if (!browserTtsSupported()) return false;
  const text = String(TTS_STATE.browserPageText || '');
  const ranges = TTS_STATE.browserSentenceRanges || [];
  if (!text || !ranges.length) return false;
  const target = Math.max(0, Math.min(ranges.length - 1, Number(sentenceIndex) || 0));
  const startOffset = Math.max(0, Number(ranges[target].start) || 0);
  const voice = TTS_STATE.browserVoice || browserPickVoice();
  TTS_DEBUG.lastResolvedPath = 'browser-restart-from-sentence';
  ttsDiagPush('browser-restart-from-sentence', { key, sentenceIndex: target, startOffset });
  TTS_STATE.browserRestarting = true;
  try { window.speechSynthesis.cancel(); } catch (_) {}
  TTS_STATE.browserRestarting = false;
  TTS_STATE.activeKey = key;
  TTS_STATE.browserPaused = false;
  TTS_DEBUG.lastResolvedPath = 'cloud-preferred';
  ttsRememberLastPageKey(key);
  ttsSetButtonActive(key, true);
  ttsSetHintButton(key, true);
  TTS_STATE.browserCurrentSentenceIndex = target;
  TTS_STATE.browserCurrentCharIndex = startOffset;
  browserSetHighlightedSentence(target);
  const utter = new SpeechSynthesisUtterance(text.slice(startOffset));
  utter.lang = "en-US";
  utter.rate = getPlaybackRate();
  utter.pitch = 1;
  try { utter.volume = Math.max(0, Math.min(1, Number(TTS_STATE.volume ?? 1))); } catch (_) {}
  if (voice) utter.voice = voice;
  utter.onboundary = (e) => {
    try {
      const abs = startOffset + (Number(e.charIndex) || 0);
      TTS_STATE.browserCurrentCharIndex = abs;
      const idx = browserFindSentenceIndexForChar(abs);
      TTS_STATE.browserCurrentSentenceIndex = idx;
      browserSetHighlightedSentence(idx);
    } catch (_) {}
  };
  utter.onend = () => {
    if (TTS_STATE.browserRestarting) return;
    ttsDiagPush('cloud-queue-complete', { key });
    TTS_STATE.activeKey = null;
    ttsSetButtonActive(key, false);
    ttsSetHintButton(key, false);
    ttsClearSentenceHighlight();
    if (optsForKeySentenceMarks(key)) {
      const pageIndex = parseInt(String(key).slice(5), 10);
      if (Number.isFinite(pageIndex)) ttsAutoplayScheduleNext(pageIndex);
    }
  };
  utter.onerror = () => {
    if (TTS_STATE.browserRestarting) return;
    TTS_STATE.activeKey = null;
    ttsSetButtonActive(key, false);
    ttsSetHintButton(key, false);
    ttsClearSentenceHighlight();
  };
  window.speechSynthesis.speak(utter);
  return true;
}

function browserSpeakQueue(key, parts) {
  TTS_DEBUG.lastResolvedPath = 'browser';
  TTS_DEBUG.lastPlayRequest = { key, parts: (parts || []).length, path: 'browser' };
  ttsDiagPush('browser-speak-request', TTS_DEBUG.lastPlayRequest);
  if (!browserTtsSupported()) {
    alert("Text-to-speech is not supported in this browser.");
    return;
  }

  const support = getTtsSupportStatus();
  if (!support.browserVoiceAvailable) {
    TTS_DEBUG.lastError = { at: new Date().toISOString(), path: 'browser', key, message: support.reason || 'No browser voice available' };
    TTS_DEBUG.lastRouteDecision = getPreferredTtsRouteInfo();
    ttsDiagPush('browser-voice-unavailable', { key, reason: support.reason || 'No browser voice available', route: TTS_DEBUG.lastRouteDecision });
    try { if (typeof window.syncPlaybackUiAvailability === 'function') window.syncPlaybackUiAvailability(); } catch (_) {}
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
  ttsRememberLastPageKey(key);
  ttsSetButtonActive(key, true);
  ttsSetHintButton(key, true);
  let idx = 0;
  const voice = browserPickVoice();
  TTS_STATE.browserVoice = voice || null;
  TTS_STATE.activeBrowserVoiceName = voice ? voice.name : '(default)';

  // Build sentence-level highlight spans for the first part (the page text),
  // using the same DOM structure as the Polly path so CSS styling is consistent.
  // Browser speechSynthesis fires 'boundary' events with charIndex/charLength,
  // which we use to determine the active sentence.
  const isPageRead = optsForKeySentenceMarks(key);
  let browserSentenceRanges = null; // [{start, end}] char index ranges into queue[0]

  if (isPageRead && queue.length > 0) {
    // Split the page text into sentence ranges by splitting on sentence-ending punctuation.
    const text = queue[0];
    const sentenceRegex = /[^.!?]*[.!?]+["']?\s*/g;
    const ranges = [];
    let match;
    while ((match = sentenceRegex.exec(text)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
    // If regex found nothing (no punctuation), treat the whole text as one sentence.
    if (!ranges.length) ranges.push({ start: 0, end: text.length });
    browserSentenceRanges = ranges;
    TTS_STATE.browserSentenceRanges = ranges;
    TTS_STATE.browserPageText = text;

    // Inject spans into the page-text element (mirrors Polly highlight structure).
    try {
      const pageIndex = parseInt(String(key).slice(5), 10);
      const pageEl = document.querySelectorAll('.page')[pageIndex];
      const textEl = pageEl?.querySelector('.page-text');
      if (textEl) {
        ttsClearSentenceHighlight();
        const spansHtml = [];
        let cursor = 0;
        for (let i = 0; i < ranges.length; i++) {
          const r = ranges[i];
          if (r.start > cursor) spansHtml.push(escapeHTML(text.slice(cursor, r.start)));
          spansHtml.push(`<span class="tts-sentence" data-tts-sent="${i}">${escapeHTML(text.slice(r.start, r.end))}</span>`);
          cursor = r.end;
        }
        if (cursor < text.length) spansHtml.push(escapeHTML(text.slice(cursor)));

        TTS_STATE.highlightPageKey = key;
        TTS_STATE.highlightPageEl = textEl;
        TTS_STATE.highlightOriginalHTML = textEl.innerHTML;
        TTS_STATE.highlightSpans = null; // set after innerHTML swap
        TTS_STATE.highlightMarks = ranges.map((r, i) => ({ time: i, start: r.start, end: r.end }));
        TTS_STATE.highlightEnds = ranges.map((_, i) => i + 1 < ranges.length ? i + 1 : Infinity);
        textEl.innerHTML = spansHtml.join('');
        TTS_STATE.highlightSpans = Array.from(textEl.querySelectorAll('.tts-sentence'));

        try {
          const hintBtn = pageEl.querySelector('.hint-btn');
          if (hintBtn) hintBtn.disabled = true;
        } catch (_) {}
      }
    } catch (_) {}
  }

  let lastHighlightedIdx = -1;

  function highlightAtChar(charIndex) {
    if (!browserSentenceRanges || !TTS_STATE.highlightSpans) return;
    // Find which sentence range contains this charIndex
    let idx = -1;
    for (let i = 0; i < browserSentenceRanges.length; i++) {
      if (charIndex >= browserSentenceRanges[i].start && charIndex < browserSentenceRanges[i].end) {
        idx = i; break;
      }
    }
    if (idx === lastHighlightedIdx) return;
    TTS_STATE.browserCurrentSentenceIndex = idx >= 0 ? idx : 0;
    TTS_STATE.browserCurrentCharIndex = Math.max(0, Number(charIndex) || 0);
    // Fade out previous
    if (lastHighlightedIdx >= 0 && TTS_STATE.highlightSpans[lastHighlightedIdx]) {
      TTS_STATE.highlightSpans[lastHighlightedIdx].style.setProperty('--tts-alpha', '0');
    }
    // Fade in current
    if (idx >= 0 && TTS_STATE.highlightSpans[idx]) {
      TTS_STATE.highlightSpans[idx].style.setProperty('--tts-alpha', '1');
    }
    lastHighlightedIdx = idx;
  }

  const speakNext = () => {
    if (idx >= queue.length) {
      ttsDiagPush('browser-queue-complete', { key });
      TTS_STATE.activeKey = null;
      ttsSetButtonActive(key, false);
      ttsSetHintButton(key, false);
      ttsClearSentenceHighlight();
      // Trigger autoplay for browser TTS path.
      if (isPageRead) {
        const pageIndex = parseInt(String(key).slice(5), 10);
        if (Number.isFinite(pageIndex)) ttsAutoplayScheduleNext(pageIndex);
      }
      return;
    }
    const utter = new SpeechSynthesisUtterance(queue[idx]);
    utter.lang = "en-US";
    utter.rate = getPlaybackRate();
    utter.pitch = 1;
    try { utter.volume = Math.max(0, Math.min(1, Number(TTS_STATE.volume ?? 1))); } catch (_) {}
    if (voice) utter.voice = voice;

    // Drive sentence highlighting via boundary events (word and sentence boundaries).
    // charIndex points into the utterance text — use it to find the active sentence.
    if (idx === 0 && browserSentenceRanges) {
      utter.onboundary = (e) => {
        try { highlightAtChar(e.charIndex); } catch (_) {}
      };
    }

    utter.onend = () => { idx += 1; speakNext(); };
    utter.onerror = () => {
      TTS_DEBUG.lastError = { at: new Date().toISOString(), path: 'browser', key, message: 'speechSynthesis utterance error' };
      ttsDiagPush('browser-utterance-error', { key });
      TTS_STATE.activeKey = null;
      ttsSetButtonActive(key, false);
      ttsSetHintButton(key, false);
      ttsClearSentenceHighlight();
    };
    window.speechSynthesis.speak(utter);
  };

  speakNext();
}

async function ttsSpeakQueue(key, parts) {
  const routeInfo = getPreferredTtsRouteInfo();
  TTS_DEBUG.lastRouteDecision = routeInfo;
  TTS_DEBUG.lastPlayRequest = { key, parts: (parts || []).length, path: routeInfo.requestedPath, reason: routeInfo.reason, selectedVoice: routeInfo.selected.stored };
  ttsDiagPush('speak-request', TTS_DEBUG.lastPlayRequest);

  // Free tier: route directly to browser speechSynthesis — no API call, no token cost.
  // Voice variant (male/female) is respected via browserPickVoice().
  // Sentence highlighting uses boundary events on browser TTS path.
  if (!routeInfo.cloudCapable) {
    TTS_DEBUG.lastResolvedPath = 'browser-free';
    browserSpeakQueue(key, parts);
    return;
  }


  // Unlock Safari audio during the user gesture
  ttsUnlockAudio();

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
  ttsRememberLastPageKey(key);
  ttsSetButtonActive(key, true);
  ttsSetHintButton(key, true);

  // Preferred path: Polly via /api/tts. If it fails, fall back to browser voices.
  try {
    for (let i = 0; i < queue.length; i++) {
      const wantMarks = (i === 0 && optsForKeySentenceMarks(key));
      // Spend 1 token per page read via cloud TTS (first part only — not lead-ins or feedback)
      if (i === 0 && optsForKeySentenceMarks(key)) {
        try { if (typeof tokenSpend === 'function') tokenSpend('tts'); } catch(_) {}
      }
      const tts = await pollyFetchUrl(queue[i], { sentenceMarks: wantMarks });
      const url = tts.url;
      if (wantMarks) {
        if (tts.sentenceMarks && tts.sentenceMarks.length) {
          // Polly path — precise speech marks available
          ttsMaybePrepareSentenceHighlight(key, queue[i], tts.sentenceMarks);
        } else {
          // Azure path — no speech marks; use estimated timing from audio duration
          ttsPrepareEstimatedHighlight(key, queue[i], TTS_AUDIO_ELEMENT);
        }
      }
      if (TTS_STATE.activeKey !== key) return; // cancelled mid-flight

      // Play URL (sequential)
      await new Promise((resolve, reject) => {
        const audio = TTS_AUDIO_ELEMENT;
        // Stop the silent primer (or autoplay keep-warm loop) before switching
        // to the real audio URL. Resetting loop here is critical — if we landed
        // here from autoplay, loop=true is still set from ttsKeepWarmForAutoplay.
        try { audio.loop = false; audio.pause(); } catch (_) {}
        audio.src = url;
        try {
          audio.defaultPlaybackRate = getPlaybackRate();
          audio.playbackRate = getPlaybackRate();
        } catch (_) {}
        TTS_STATE.audio = audio;
        // Polly audio volume (0..1). Persisted via the Voices slider.
        try { audio.volume = Math.max(0, Math.min(1, Number(TTS_STATE.volume ?? 1))); } catch (_) {}
        // Start sentence highlight loop if prepared for this action.
        ttsStartHighlightLoop(audio);
        audio.onended = () => { ttsDiagPush('cloud-audio-ended', { key, queueIndex: i }); ttsClearSentenceHighlight(); resolve(); };
        audio.onerror = () => { TTS_DEBUG.lastError = { at: new Date().toISOString(), path: 'cloud-audio', key, message: 'Audio playback failed' }; ttsDiagPush('cloud-audio-error', { key, queueIndex: i }); reject(new Error("Audio playback failed")); };
        audio.play().catch(reject);
      });
    }
    TTS_STATE.activeKey = null;
    ttsSetButtonActive(key, false);
    ttsSetHintButton(key, false);
    // Trigger autoplay if this was a page read and autoplay is enabled.
    if (optsForKeySentenceMarks(key)) {
      const pageIndex = parseInt(String(key).slice(5), 10);
      if (Number.isFinite(pageIndex)) {
        // Keep TTS_AUDIO_ELEMENT silently active through the countdown gap so
        // Safari does not revoke autoplay permission before the next page loads.
        ttsKeepWarmForAutoplay();
        ttsAutoplayScheduleNext(pageIndex);
      }
    }
  } catch (err) {
    // IMPORTANT: If the user explicitly stopped (or switched actions) while Polly
    // was fetching/playing, do NOT fall back to browser TTS.
    if (TTS_STATE.activeKey !== key) return;
    if (err && (err.name === 'AbortError' || String(err).includes('aborted'))) return;

    const routeInfo = getPreferredTtsRouteInfo();
    TTS_DEBUG.lastError = { at: new Date().toISOString(), path: 'cloud', key, message: String(err && err.message ? err.message : err) };
    ttsDiagPush('cloud-playback-failed', { key, message: String(err && err.message ? err.message : err), route: routeInfo });
    console.warn('Cloud TTS playback failed:', err);
    ttsStop();
    if (!routeInfo.browserFallbackAllowed) {
      TTS_DEBUG.lastResolvedPath = routeInfo.selected.explicitCloud ? 'cloud-failure-no-browser-fallback' : 'cloud-failure-no-fallback';
      return;
    }
    TTS_DEBUG.lastResolvedPath = 'browser-fallback';
    browserSpeakQueue(key, queue);
  }
}

// Some browsers (Chrome, Edge) load voices asynchronously.
// Trigger getVoices() once on voiceschanged so the list is warm
// by the time a Free tier user first presses Read Page.
if (browserTtsSupported()) {
  window.speechSynthesis.onvoiceschanged = () => {
    try { window.speechSynthesis.getVoices(); } catch (_) {}
  };
}



window.setPlaybackRate = setPlaybackRate;
window.applyCurrentPlaybackRate = applyCurrentPlaybackRate;
window.getPlaybackRate = getPlaybackRate;
window.getPlaybackStatus = getPlaybackStatus;
window.getAutoplayStatus = getAutoplayStatus;

function ttsJumpSentence(delta) {
  const audio = TTS_STATE.audio;
  if (audio && TTS_STATE.highlightMarks && TTS_STATE.highlightMarks.length) {
    const t = (audio.currentTime || 0) * 1000;
    const marks = TTS_STATE.highlightMarks;
    const ends = TTS_STATE.highlightEnds || [];
    let idx = 0;
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].time;
      const end = ends[i] ?? Infinity;
      if (t >= start && t < end) { idx = i; break; }
      if (t >= start) idx = i;
    }
    const target = Math.max(0, Math.min(marks.length - 1, idx + (delta < 0 ? -1 : 1)));
    try {
      audio.currentTime = Math.max(0, (Number(marks[target].time) || 0) / 1000 - 0.02);
      if (TTS_STATE.highlightSpans) {
        TTS_STATE.highlightSpans.forEach((span, i) => span.style.setProperty('--tts-alpha', i === target ? '1' : '0'));
      }
      TTS_DEBUG.lastSkip = { at: new Date().toISOString(), type: 'sentence', delta, resolved: 'audio-marks', activeKey: TTS_STATE.activeKey || null };
      ttsDiagPush('skip-sentence', TTS_DEBUG.lastSkip);
      return true;
    } catch (_) {
      return false;
    }
  }
  if (browserTtsSupported() && TTS_STATE.activeKey && TTS_STATE.browserSentenceRanges && TTS_STATE.browserSentenceRanges.length) {
    const current = Math.max(0, Number(TTS_STATE.browserCurrentSentenceIndex) || 0);
    const target = Math.max(0, Math.min(TTS_STATE.browserSentenceRanges.length - 1, current + (delta < 0 ? -1 : 1)));
    const ok = browserSpeakPageFromSentence(TTS_STATE.activeKey, target);
    TTS_DEBUG.lastSkip = { at: new Date().toISOString(), type: 'sentence', delta, resolved: ok ? 'browser-restart-from-sentence' : 'browser-restart-failed', activeKey: TTS_STATE.activeKey || null };
    ttsDiagPush('skip-sentence', TTS_DEBUG.lastSkip);
    return ok;
  }
  TTS_DEBUG.lastSkip = { at: new Date().toISOString(), type: 'sentence', delta, resolved: 'unavailable', activeKey: TTS_STATE.activeKey || null };
  ttsDiagPush('skip-sentence', TTS_DEBUG.lastSkip);
  return false;
}
function ttsJumpPage(delta) {
  const key = String(TTS_STATE.activeKey || '');
  const match = key.match(/^page-(\d+)$/);
  if (!match) return false;
  const currentIndex = Number(match[1]);
  const nextIndex = currentIndex + (delta < 0 ? -1 : 1);
  if (!Number.isFinite(nextIndex) || nextIndex < 0) return false;
  if (typeof pages === 'undefined' || !pages[nextIndex]) return false;
  try { if (typeof window.setFocusedPageIndex === 'function') window.setFocusedPageIndex(nextIndex, { scroll: true, behavior: 'smooth' }); } catch (_) {}
  ttsSpeakQueue(`page-${nextIndex}`, [pages[nextIndex]]);
  TTS_DEBUG.lastSkip = { at: new Date().toISOString(), type: 'page', delta, resolved: 'page-jump', targetPageIndex: nextIndex, activeKey: TTS_STATE.activeKey || null };
  ttsDiagPush('skip-page', TTS_DEBUG.lastSkip);
  return true;
}
function ttsRestartPage(pageIndex) {
  const idx = Number(pageIndex);
  if (!Number.isFinite(idx) || idx < 0) return false;
  if (typeof pages === 'undefined' || !pages[idx]) return false;
  try { if (typeof window.setFocusedPageIndex === 'function') window.setFocusedPageIndex(idx, { scroll: true, behavior: 'smooth' }); } catch (_) {}
  ttsSpeakQueue(`page-${idx}`, [pages[idx]]);
  ttsDiagPush('restart-page', { pageIndex: idx });
  return true;
}
function restartLastSpokenPageTts() {
  const countdown = getCountdownStatus();
  if (countdown.active && Number.isFinite(countdown.pageIndex) && countdown.pageIndex >= 0) {
    ttsAutoplayCancelCountdown();
    return ttsRestartPage(countdown.pageIndex);
  }
  const key = String(TTS_STATE.lastPageKey || TTS_STATE.activeKey || '');
  const match = key.match(/^page-(\d+)$/);
  if (!match) return false;
  return ttsRestartPage(Number(match[1]));
}

window.getCountdownStatus = getCountdownStatus;
window.getTtsSupportStatus = getTtsSupportStatus;
window.pauseOrResumeReading = pauseOrResumeReading;
window.toggleAutoplay = toggleAutoplay;
window.ttsJumpSentence = ttsJumpSentence;
window.ttsJumpPage = ttsJumpPage;
window.restartLastSpokenPageTts = restartLastSpokenPageTts;
window.getTtsDiagnosticsSnapshot = getTtsDiagnosticsSnapshot;

// Best-practice stop conditions:
// - If the user navigates away or the page is unloaded, stop speaking.
// - visibilitychange (tab switching) intentionally NOT included so audio
//   continues playing in the background while the user reads elsewhere.
try {
  window.addEventListener("pagehide", () => ttsStop(), { passive: true });
  window.addEventListener("beforeunload", () => ttsStop(), { passive: true });
} catch (_) {}

