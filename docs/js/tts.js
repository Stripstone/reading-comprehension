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
  // sentence highlight state (page read)
  highlightPageKey: null,
  highlightPageEl: null,
  highlightOriginalHTML: null,
  highlightRAF: null,
  highlightSpans: null,
  highlightMarks: null,
  highlightEnds: null,
};

// Safari/iOS requires a user gesture before audio.play() is allowed.
// We unlock audio on the first interaction so autoplay later works.
let TTS_AUDIO_UNLOCKED = false;
// Persistent audio element (Safari requires reuse for autoplay chains)
const TTS_AUDIO_ELEMENT = new Audio();
TTS_AUDIO_ELEMENT.preload = "auto";

// Tiny silent MP3 used to prime TTS_AUDIO_ELEMENT within a user gesture.
const TTS_SILENT_SRC = "data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAA";

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
    if (btn) btn.textContent = `⏸ Next in ${AUTOPLAY_STATE.countdownSec}…`;
  }
  updateBtn();

  AUTOPLAY_STATE.countdownTimerId = setInterval(() => {
    AUTOPLAY_STATE.countdownSec -= 1;
    if (AUTOPLAY_STATE.countdownSec <= 0) {
      ttsAutoplayCancelCountdown();
      // Scroll to next page
      const nextPageEl = pageEls[nextIndex];
      if (nextPageEl) nextPageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  ttsSetButtonActive(key, true);
  ttsSetHintButton(key, true);
  let idx = 0;
  const voice = browserPickVoice();
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
    utter.rate = 1;
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

  // Free tier: route directly to browser speechSynthesis — no API call, no token cost.
  // Voice variant (male/female) is respected via browserPickVoice().
  // Sentence highlighting uses boundary events on browser TTS path.
  if (typeof appTier !== 'undefined' && appTier === 'free') {
    browserSpeakQueue(key, parts);
    return;
  }

  // Edge browser optimisation: Azure Neural voices (Aria, Jenny, Ryan, Guy etc.) are
  // available natively in Edge via speechSynthesis. If the user has selected a cloud
  // voice that matches an available browser voice, route to browserSpeakQueue instead
  // of calling /api/tts — same quality, zero API cost, zero token spend.
  try {
    const savedVoice = localStorage.getItem('rc_browser_voice') || '';
    if (savedVoice.startsWith('cloud:')) {
      const azureShortName = savedVoice.slice('cloud:'.length); // e.g. "en-US-AriaNeural"
      // Extract the plain voice name — Azure browser voices are listed as e.g.
      // "Microsoft Aria Online (Natural) - English (United States)"
      // Match by the first segment before "Neural" in the short name (e.g. "Aria")
      const nameMatch = azureShortName.match(/en-[A-Z]{2}-([A-Za-z]+)Neural/);
      const plainName = nameMatch ? nameMatch[1] : null;
      if (plainName && browserTtsSupported()) {
        const voices = window.speechSynthesis.getVoices() || [];
        const browserMatch = voices.find(v =>
          v.name.includes(plainName) && /Microsoft/i.test(v.name)
        );
        if (browserMatch) {
          // Temporarily override voice picker to use this specific browser voice
          const orig = localStorage.getItem('rc_browser_voice');
          try { localStorage.setItem('rc_browser_voice', browserMatch.name); } catch(_) {}
          browserSpeakQueue(key, parts);
          // Restore cloud selection so the picker still shows the cloud voice
          try { localStorage.setItem('rc_browser_voice', orig); } catch(_) {}
          return;
        }
      }
    }
  } catch(_) {}

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

    // If Polly isn't configured yet (or otherwise fails), don't spam alerts; just fall back.
    console.warn("Polly TTS unavailable, falling back to browser TTS:", err);
    ttsStop();
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


// Best-practice stop conditions:
// - If the user navigates away or the page is unloaded, stop speaking.
// - visibilitychange (tab switching) intentionally NOT included so audio
//   continues playing in the background while the user reads elsewhere.
try {
  window.addEventListener("pagehide", () => ttsStop(), { passive: true });
  window.addEventListener("beforeunload", () => ttsStop(), { passive: true });
} catch (_) {}

