# Reading Comprehension App — System Responsibilities Map

This document describes the architecture, file responsibilities, state model, and behavioral contracts of the Reading Comprehension application.

It is a technical reference for development. It does not define desired user experience — that lives in **ExperienceSpec.md**. Changes to behavior should be traceable to that document.

---

## 1. System Overview

The application has three layers:

| Layer | Location | Purpose |
|---|---|---|
| Frontend Web App | `docs/` | Browser UI, interaction, deterministic logic |
| Serverless API | `api/` | AI features, TTS, book conversion |
| Prompt Contracts | `api/prompts/` | AI behavior definitions |

**Hosting:**
- Frontend → GitHub Pages (static)
- Backend → Vercel (serverless functions)

The frontend and backend communicate exclusively via HTTP POST to versioned API endpoints. The frontend never holds API keys.

---

## 2. Core Learning Model

The application is a reading comprehension training environment.

### Primary Workflow

```
User reads a page
→ User writes a consolidation (summary in their own words)
→ Anchors guide recognition of core ideas (deterministic)
→ AI evaluates the consolidation (optional)
→ Feedback and score returned
→ TTS optionally narrates the passage
```

### Atomic Page Model

All AI features operate **per page**. No cross-page reasoning is used.

This ensures:
- Predictable AI behavior
- Consistent page difficulty
- Faster responses
- Simpler debugging

---

## 3. Application Modes

| Mode | UI Shown | Evaluation Behavior |
|---|---|---|
| `reading` | Passage + Read Page button only | No evaluation UI |
| `comprehension` | Full UI — anchors, consolidation, stars, AI feedback | Normal evaluation against anchors |
| `thesis` | Full UI + Thesis input field | Coming soon — will evaluate against thesis statement |

**Mode persistence:** Saved to `localStorage` as `rc_app_mode`. Restored on page load.

**Body class:** Not used. Mode visibility is controlled entirely by `applyModeVisibility()` in `library.js` via inline `style.display`.

### What `applyModeVisibility()` controls

In `reading` mode, the following are hidden:
- `.goal-time-row` (Time, Characters, Difficulty knobs)
- `#thesisRow`
- Per-page: `.anchors-row`, `.sand-wrapper`, `.info-row`, `.ai-feedback`, `.action-buttons`, consolidation header
- `#submitBtn`, `#verdictSection`

In `comprehension` and `thesis` modes, all of the above are shown.

`#thesisRow` is shown **only** in `thesis` mode.

`.goal-actions` (Load Pages / Add Pages / Clear Pages) is **always visible** — it is a sibling of `bookControls`, not a child, and is never hidden by mode or source changes.

---

## 4. File Load Order

`app.js` loads all scripts sequentially via dynamic `<script>` injection:

```
state.js → tts.js → utils.js → anchors.js → import.js → library.js → evaluation.js → ui.js
```

All files share a single global scope (no ES modules). Variables declared in earlier files are available to all later files.

---

## 5. File Responsibilities

### `state.js`

Global application state. All other modules read from or write to these variables.

**Key variables:**

| Variable | Type | Purpose |
|---|---|---|
| `pages` | `string[]` | Raw text of each loaded page |
| `pageData` | `object[]` | Per-page runtime data (consolidation, rating, anchors, AI feedback, hash) |
| `appMode` | `string` | Current mode: `'reading'`, `'comprehension'`, `'thesis'` |
| `thesisText` | `string` | User's thesis statement (thesis mode) |
| `evaluationPhase` | `bool` | Whether compasses are unlocked (all pages have consolidations) |
| `goalTime` | `number` | Target consolidation time in seconds |
| `goalCharCount` | `number` | Target consolidation character count |
| `lastFocusedPageIndex` | `number` | Tracks which page the user last interacted with |
| `lastReadPageIndex` | `number` | Index of the last page scrolled to — persisted for session resume |
| `timers` | `number[]` | Per-page elapsed timer values |
| `intervals` | `id[]` | Per-page `setInterval` handles |

**Persistence functions:**
- `schedulePersistSession()` — debounced save (250ms)
- `persistSessionNow()` — immediate save to `localStorage`
- `loadPersistedSessionIfAny()` — restores session on boot
- `ensurePageHashesAndRehydrate()` — backfills hashes if missing from older saves
- `clearPersistedSession()` — wipes session storage

**Session storage keys:**
- `rc_session_v2` — page texts + hashes + consolidations + `lastReadPageIndex` + `goalTime` + `goalCharCount` snapshot
- `rc_consolidation_<hash>` — per-page record (consolidation, rating, AI feedback, sandstone flag)
- `rc_app_mode` — last selected mode
- `rc_thesis_text` — thesis input value

**Session restore fix:** `loadPersistedSessionIfAny()` previously threw `ReferenceError: currentPageIndex is not defined` silently (caught by try/catch), causing it to always return `false`. Fixed with a `typeof` guard. Session restore was non-functional prior to this patch.

---

### `tts.js`

Text-to-speech system. Loaded second so all other files can call TTS functions.

**State objects:**

```js
TTS_STATE = {
  activeKey,          // key of currently playing TTS action (e.g. 'page-0')
  audio,              // active Audio element
  abort,              // AbortController for in-flight Polly fetch
  volume,             // 0–1, synced from Voices slider
  voiceVariant,       // 'female' | 'male'
  highlightPageKey,   // key of page being sentence-highlighted
  highlightPageEl,    // .page-text element being highlighted
  highlightOriginalHTML, // original innerHTML before span injection
  highlightRAF,       // requestAnimationFrame handle
  highlightSpans,     // array of .tts-sentence span elements
  highlightMarks,     // sentence timing marks from Polly
  highlightEnds,      // precomputed end times per sentence
}

TTS_GEN = 0           // monotonic session counter — incremented on every ttsStop()
                      // each playback request captures its generation and aborts if stale
                      // prevents cross-book audio bleed and stale async chain interference

_ttsWakeLock = null           // WakeLockSentinel — Screen Wake Lock held during cloud TTS playback
_ttsWakeLockRevokedAt = 0     // timestamp of last OS revocation; 30s cooldown before re-acquiring

TTS_SILENT_SRC        // Blob URL of a minimal valid PCM WAV (1-channel, 8kHz, 8-bit, 2 samples)
                      // generated at startup via ArrayBuffer + DataView + URL.createObjectURL
                      // used for keep-warm; avoids Firefox NS_ERROR_DOM_MEDIA_METADATA_ERR

AUTOPLAY_STATE = {
  enabled,            // bool — from autoplay checkbox
  countdownPageIndex, // page index currently counting down (-1 = none)
  countdownSec,       // seconds remaining in countdown
  countdownTimerId,   // setInterval handle for countdown tick
  launchTimerId,      // setTimeout handle for actual playback launch — cancelable
  preloadedMarks,     // sentence marks pre-fetched during countdown
  preloadedUrl,       // signed S3 URL fetched during countdown
  preloadedBlobUrl,   // blob:// URL of downloaded audio binary (URL.createObjectURL)
                      // if set, play block assigns this to audio.src — instant readyState=4 from memory
  audioReady,         // bool — true when preload is armed and src should not be overwritten
}
```

**Key functions:**

| Function | Purpose |
|---|---|
| `ttsSpeakQueue(key, parts, preloadedAudio?, preloadedUrl?)` | Main TTS entry point. Cloud first, browser fallback. Checks `preloadedBlobUrl` → `preloadedUrl` → fetch. |
| `ttsStop()` | Stops all audio, increments `TTS_GEN`, cancels countdown, revokes blob URL, clears highlights, releases Wake Lock, removes `.tts-active` from all buttons |
| `ttsAutoplayScheduleNext(pageIndex)` | Starts 3-second countdown; fetches signed URL then downloads full audio binary as Blob during countdown |
| `ttsAutoplayCancelCountdown({ clearPreload })` | Cancels countdown and launch timer. `clearPreload: true` (default) revokes blob and clears preload state. `clearPreload: false` used on normal countdown completion to preserve preloaded audio for the play block. |
| `ttsKeepWarmForAutoplay()` | Assigns `TTS_SILENT_SRC` to keep audio element warm for Safari gesture context — skips assignment when `AUTOPLAY_STATE.audioReady` is true to preserve preloaded buffer |
| `ttsSetButtonActive(key, active)` | Adds/removes `.tts-active` class on the Read Page button for the given key |
| `ttsSetHintButton(key, disabled)` | Disables/enables the Hint button while TTS is highlighting that page |
| `ttsMaybePrepareSentenceHighlight(key, text, marks)` | Injects `.tts-sentence` spans and disables Hint button |
| `ttsClearSentenceHighlight()` | Restores original innerHTML, re-enables Hint button |
| `_ttsAcquireWakeLock()` | Acquires Screen Wake Lock; respects 30s cooldown after OS revocation |
| `_ttsReleaseWakeLock()` | Releases Wake Lock; stamps `_ttsWakeLockRevokedAt` if released by OS |

**Stop / resume conditions:**
- `pagehide` → `ttsStop()`
- `beforeunload` → `ttsStop()`
- `visibilitychange` (hidden) → audio continues in background — intentionally NOT wired to `ttsStop()`
- `visibilitychange` (visible, TTS was active) → resumes audio if paused; re-acquires Wake Lock if TTS still playing

**Autoplay flow:**
```
Page finishes reading
→ ttsAutoplayScheduleNext(pageIndex) called
→ Step 1: fetch signed URL from /api/tts (~50ms, tiny JSON)
→ Step 2: fetch full audio binary from S3 as Blob → URL.createObjectURL → preloadedBlobUrl
  (requires S3 CORS policy; without it, step 2 silently fails, system falls back to <audio src>)
→ Button shows "⏸ Next in 3…" countdown (launchTimerId set)
→ At 0: ttsAutoplayCancelCountdown({ clearPreload: false }) — preserves preload
→ Scroll to next page, ttsSpeakQueue consumes preloadedBlobUrl → plays from memory
→ Blob URL revoked on ended / error / ttsStop()
→ Clicking button during countdown cancels autoplay (clearPreload: true)
```

**Safari / iOS / iPadOS — Audio Restrictions:**

Safari requires all `audio.play()` calls to originate from a direct, synchronous user gesture (tap or click). A deferred or async call — even one triggered milliseconds after a gesture — will be blocked.

The autoplay fix works by pre-fetching the next page's Polly URL and calling `audio.load()` during the countdown while the previous gesture's audio context is still active. When the countdown ends, `play()` is treated as a resume, not a cold start, and Safari allows it.

**Rules for any new audio-triggering code:**
- Never call `play()` outside of a synchronous user gesture handler on Safari.
- If audio must be triggered after an async operation (e.g. fetch), pre-load during the gesture and play after.
- Do not assume a gesture context survives a `setTimeout`, `Promise.then`, or `await`.

**Known platform edge cases (TTS):**

| Platform | Condition | Behavior |
|---|---|---|
| Safari / iPadOS | Autoplay after mode switch | May lose gesture context — audio blocked |
| iOS | Returning from background tab | Requires fresh user gesture before audio resumes |
| iPadOS | Volume panel interaction | Tap may not establish gesture context for audio purposes |

*Add new observations to this table as discovered during runtime testing.*

**Stall recovery:** The `waiting` event handler fires backoff retries at 1500ms → 4000ms → 9000ms. Guards: (1) `readyState < 2` — skip if initial buffering, not a stall; (2) `audio.src === TTS_SILENT_SRC` — skip if playing silent audio; (3) `!audio.paused` — skip if browser self-resumed between retries.

**TTS source tracking:** `ttsSource` state is set on every playback path — `'cloud'`, `'browser'`, or `'browser-fallback'`. Surfaced in the debug overlay and diagnostics dump.

**Hint button interaction:** While sentence highlighting is active, the Hint button is disabled to prevent anchor `innerHTML` injection from destroying the TTS sentence spans. It is re-enabled in `ttsClearSentenceHighlight()` when TTS finishes.

**Free tier — browser `speechSynthesis` fallback:**

When `appTier === 'free'`, the frontend must not call `/api/tts`. Instead it uses the browser's built-in `speechSynthesis` API at zero cost.

The voice picker in the volume panel shows two dropdowns (Female / Male). Each is populated from `getVoices()` filtered by a named list of known-gendered voices. "Other English" voices (gender-neutral or unrecognised names) are currently excluded from the picker — they cannot be reliably categorised by gender. A future improvement could add a third "Other" group or allow users to manually assign gender. These voices are still accessible to `browserPickVoice()` as a last-resort fallback even though they don't appear in the UI.

```js
const PREFERRED_VOICES = ['Aria', 'Jenny', 'Guy', 'Samantha', 'Google', 'Siri'];
const voices = speechSynthesis.getVoices();
const best = voices.find(v => PREFERRED_VOICES.some(p => v.name.includes(p)))
             || voices.find(v => v.lang.startsWith('en'))
             || voices[0];
utterance.voice = best;
```

Note: `getVoices()` may return an empty array on first call in some browsers. Wire to the `voiceschanged` event to retry after voices load.

Free users do not see voice selection controls. Voice is chosen automatically.

---

### `anchors.js`

Anchor guidance system. Generates and renders core idea fragments per page.

**Anchor lifecycle:**
```
User focuses textarea or clicks Hint
→ hydrateAnchorsIntoPageEl() called (lazy)
→ POST /api/anchors
→ anchors cached in pageData[i].anchors + localStorage
→ buildAnchorsHtml() wraps quote text in .anchor spans
→ updateAnchorsUIForPage() runs deterministic keyword matching
→ counter updated, alpha CSS var set per span
```

**Key functions:**

| Function | Purpose |
|---|---|
| `hydrateAnchorsIntoPageEl(pageEl, pageIndex)` | Fetches/caches anchors, injects spans into `.page-text` |
| `buildAnchorsHtml(text, anchors)` | Wraps anchor quote substrings in `.anchor` spans |
| `updateAnchorsUIForPage(pageEl, pageIndex, consolidationText)` | Deterministic matching — sets `--anchor-alpha` per span |
| `bindHintButton(pageEl, pageIndex)` | Wires Hint button: generate anchors if needed, then pulse highlight |

**Cache key:** `rc_anchors_<hash>` in localStorage. Versioned — cleared on anchor version bump.

**Hint button behavior:**
- First click: generates anchors if not yet loaded (shows "Generating…")
- Subsequent clicks: pulses all anchor spans to full visibility for 2s then fades out
- Disabled while TTS sentence highlighting is active on that page

---

### `library.js`

Book system and page renderer. The largest file in the frontend.

**Responsibilities:**
- Book selection and loading (embedded + local IndexedDB library)
- Chapter and page range selection
- Page segmentation
- `render()` — builds all `.page` DOM elements
- `applyModeVisibility()` — shows/hides UI sections based on `appMode`
- `resetSession()` / `clearPages()`
- Manage Library modal
- Timer system (per-page countdown timers)
- Sand animation system

**`render()` — page card structure (in DOM order):**
```
.page-header         (Page N)
.page-text           (passage text)
.anchors-row         (anchor counter + Hint button)
.page-actions        (Read Page / TTS button)
.anchors-nav         (Next button)
.page-header         (Consolidation)
.sand-wrapper        (textarea + sand overlay)
.info-row            (timer, char counter, compass stars, AI button)
.ai-feedback         (AI response panel, hidden until evaluated)
```

**Source UI — `setSourceUI()`:**

| Source | `bookControls` | `textControls` | Load Pages | Add Pages |
|---|---|---|---|---|
| Book | `flex` | `none` | visible | hidden |
| Text | `none` | `block` | hidden | visible |

**Goal-time row visibility:** Hidden in `reading` mode, visible in `comprehension` and `thesis` modes. Controlled by `applyModeVisibility()`.

**Local library:** IndexedDB (`rc_local_library_v1`). Books stored as raw content with metadata. `isLocalBookId()` / `stripLocalPrefix()` used throughout to distinguish local vs embedded books.

---

### `import.js`

Book file import system. Handles EPUB native parsing and multi-format conversion via FreeConvert.

**Supported formats:**

| Format | Path |
|---|---|
| `.epub` | Native — JSZip → `epubParseToc()` |
| `.pdf`, `.doc`, `.docx`, `.rtf`, `.odt`, `.txt`, `.html`, `.htm`, `.mobi`, `.fb2` | Conversion — `POST /api/book-import` → EPUB → JSZip |

**Conversion pipeline:**
```
File selected
→ _inputFormat detected from extension
→ _needsConversion = true (non-EPUB)
→ POST /api/book-import?step=upload → get FreeConvert upload URL
→ File uploaded directly to FreeConvert (bypasses Vercel body limit)
→ POST /api/book-import?step=convert (sends inputFormat)
→ Poll POST /api/book-import?step=status every 2s (max 90s)
→ Download converted EPUB
→ JSZip → epubParseToc() → normal chapter picker flow
```

**Error fallback:** If conversion fails (including API rate limit), status area shows a link to `freeconvert.com/epub-converter` so users can convert manually and re-import as EPUB.

**Key internal state:** `_file`, `_zip`, `_needsConversion`, `_inputFormat`, `_tocItems`, `_bookTitle`, `_spineHrefs`

---

### `evaluation.js`

Evaluation system. Handles compass ratings, AI feedback, and page navigation.

**Key functions:**

| Function | Purpose |
|---|---|
| `checkCompassUnlock()` | Unlocks compass stars when all pages have consolidations and no textarea is focused |
| `goToNext(currentIndex)` | Navigates to next page — scrolls page into view first, then focuses textarea if in comprehension mode and field is editable |
| `checkSubmitButton()` | Enables Submit button when all pages are rated or marked sandstone |
| `submitEvaluation()` | Collects all ratings, sends to `/api/evaluate`, renders verdict |

**`goToNext()` behavior by mode:**
- `reading`: scrolls next page into view. No textarea focus (none present).
- `comprehension` / `thesis` (consolidation phase): scrolls next page into view, then focuses its textarea if editable.
- Any mode (evaluation phase): scrolls next page into view. No textarea focus.
- All pages exhausted: scrolls to top.

**Thesis mode intercept:** Both the AI Evaluate button and Submit button show a "coming soon" alert in `thesis` mode. Full thesis evaluation is not yet implemented.

**Evaluation phase:** `evaluationPhase = true` when all pages have text and no textarea is focused. Affects `goToNext()` behavior.

---

### `ui.js`

UI initialization and control panels. Runs last in load order.

**Initializes (as IIFEs):**
- `initTopMenu()` — mobile hamburger menu
- `initHowItWorksModal()` — instructions modal
- `initUtilityPanels()` — volume panel, voice selector, diagnostics panel (debug only)
- `initModeSelector()` — restores mode from localStorage, wires change → `render()`
- `initThesisInput()` — syncs thesis textarea to `thesisText` state + localStorage
- `initAutoplayToggle()` — syncs checkbox to `AUTOPLAY_STATE.enabled`

**Boot sequence (end of `ui.js`):**
```js
if (loadPersistedSessionIfAny()) {
  render();
  updateDiagnostics();
  ensurePageHashesAndRehydrate();
  // scroll to lastReadPageIndex after window.load + 300ms layout settle
}
```

Boot scroll uses `window.load` event + 300ms settle delay (replaced a fixed 1500ms timeout that fired before layout was ready on slow connections). On fast connections where `readyState === 'complete'` is already true, the 300ms fires immediately.

**Volume persistence:** All volume levels saved to `localStorage` as `rc_volumes`. Voice variant saved as `rc_voice_variant`. Autoplay state saved as `rc_autoplay`.

---

### `audio.js`

Interface sound effects. Manages SFX elements and volume control.

**Sounds:**
- `sandSound` — looping sand timer ambient
- `stoneSound` — sandstone (skipped page) feedback
- `rewardSound` — reward on strong consolidation
- `compassSound` — compass unlock
- `pageTurnSound` — page focus
- `evaluateSound` — evaluation unlock
- `bgMusic` — background ambient music

**Global mute:** `allSoundsMuted` flag. `playSfx()` utility handles retry logic for mobile audio restrictions.

**Platform notes:**
- Mobile browsers (iOS and Android) block audio until a user gesture has occurred in the current session. `playSfx()` retry logic handles delayed readiness.
- On iOS, audio elements must be unlocked via a gesture before the first call. This is handled at the app level but any new SFX added must go through `playSfx()`, not direct `.play()` calls.

---

### `embers.js`

Canvas-based ember particle system. Purely visual — ambient fire/ember effect in the background. No interaction with application state.

---

### `config.js`

Configuration constants. Defines defaults used across the application.

**Key constants:**
- `DEFAULT_TIME_GOAL` — default timer target in seconds
- `DEFAULT_CHAR_GOAL` — default consolidation character target
- `TIER_MASTERFUL`, `TIER_PROFICIENT`, `TIER_COMPETENT`, `TIER_DEVELOPING` — scoring thresholds
- `SAND_START_PERCENTAGE` — when the sand animation begins as a fraction of timer
- `BUY_ME_A_COFFEE_URL` — donate link
- `DEFAULT_API_BASE` — Vercel deployment URL (used when not on `.vercel.app`)

---

### `utils.js`

Shared utility functions used across multiple modules.

Includes: `sha256HexBrowser()`, `escapeHtml()`, `stableHashText()`, and other helpers.

---

## 6. Backend API Endpoints

All endpoints are serverless functions deployed on Vercel.

CORS is restricted to `https://stripstone.github.io`, `localhost:3000`, and `127.0.0.1:3000`.

---

### `POST /api/evaluate`

Evaluates a user's page consolidation against the source passage.

**Request:** `{ pageText, consolidation, pageIndex? }`

**Response contract (strict 4-line format):**
```
🧭🧭🧭⚪⚪ (3/5)
Notes sentence.
Better consolidation:
Improved consolidation text.
```

**Scoring rubric:** Core Idea, Accuracy, Compression, Engagement — arithmetic mean.

**Modules:** `api/_lib/grader.js`, `api/_lib/prompt.js`, `api/_lib/http.js`

**Prompt:** `api/prompts/promptGrader.txt`

---

### `POST /api/anchors`

Generates anchor fragments for a page.

**Request:** `{ pageText }`

**Response:**
```json
{
  "anchors": [
    { "id": "a1", "quote": "key phrase from text", "terms": ["word1", "word2"], "weight": 0.8 }
  ]
}
```

The frontend performs all matching deterministically — no AI involvement after anchor generation.

**Prompt:** `api/prompts/promptAnchors.txt`

---

### `POST /api/tts`

Generates narration audio for a page.

**Request:** `{ text, voiceVariant?, speechMarks?, debug? }`

**Response:** `{ url, sentenceMarks? }`

- `url` — S3 pre-signed URL for Polly-generated audio
- `sentenceMarks` — array of `{ time, start, end }` for sentence highlighting

**Provider:** Azure Neural TTS when `AZURE_SPEECH_KEY` is set. Falls back to Amazon Polly if Azure is unavailable. Uses SSML with `rate="0.95"` for narration clarity. Voice controlled by `AZURE_VOICE_FEMALE` / `AZURE_VOICE_MALE` env vars (defaults: `en-US-AriaNeural` / `en-US-RyanNeural`).

**Tier routing:**

| Tier | TTS Source | Token Cost |
|---|---|---|
| Free | Browser `speechSynthesis` — no API call made | 0 |
| Paid | Cloud neural (currently Polly) | 1 per page |
| Premium | Cloud neural, all voices | 1 per page |

Free users never hit this endpoint. The frontend detects `appTier === 'free'` and routes to the browser speech fallback instead. See `tts.js` for browser voice selection logic.

**Caching:**

TTS audio is generated once per unique page hash and the resulting S3 URL is stored. Subsequent requests for the same page — by any user — should serve the cached URL without calling Polly again. This is the primary cost control mechanism. Caching must be confirmed working before any scaling effort.

Cost reference: ~1,500 chars/page × $16/1M chars (Polly Neural) ≈ $0.006/page. A 300-page book costs ~$1.80 to generate once and zero thereafter.

**Potential provider optimisations (not yet actioned):**

| Provider | Cost per 1M chars | Notes |
|---|---|---|
| AWS Polly Neural | ~$16 | Current provider |
| Deepgram Aura | ~$10 | Good quality, cheaper — candidate for Paid tier |
| PlayHT | ~$5–12 | Affordable, many voices |
| ElevenLabs | ~$18–22 | Best quality — candidate for Premium tier voices |
| Self-hosted Piper | ~$0.50 (compute only) | Long-term option, requires infrastructure |

No provider changes should be made until audio caching is confirmed solid end-to-end.

---

### `POST /api/book-import`

Converts non-EPUB book formats to EPUB via FreeConvert, then returns the EPUB for parsing.

**Three-step client-driven flow:**

| Step | Request | Response |
|---|---|---|
| `?step=upload` | `POST` (no body) | `{ importTaskId, uploadUrl, signature }` |
| `?step=convert` | `{ importTaskId, inputFormat }` | `{ exportTaskId }` |
| `?step=status` | `{ exportTaskId }` | `{ status, url? }` |

Client uploads file directly to FreeConvert between steps 1 and 2 (bypasses Vercel body size limit).

**Supported `inputFormat` values:** `pdf`, `doc`, `docx`, `rtf`, `odt`, `txt`, `html`, `mobi`, `fb2`

**Env var required:** `FREECONVERT_API_KEY`

---

### `POST /api/summary`

Generates a compressed summary of a page.

**Prompt:** `api/prompts/promptSummarizer.txt`

---

### `GET /api/health`

Returns `200 OK`. Used for uptime monitoring.

---

## 7. Prompt Contracts

Prompt files in `api/prompts/` define AI behavior. They are atomic system artifacts — changes alter AI output and must be deliberate.

| File | Controls |
|---|---|
| `promptGrader.txt` | Scoring rubric, evaluation rules, strict 4-line output format |
| `promptAnchors.txt` | Anchor generation logic, weighting, phrase extraction rules |
| `promptSummarizer.txt` | Summary generation behavior |

The strict output contract in `promptGrader.txt` is what allows the frontend to parse AI responses deterministically. Breaking the format breaks the UI.

---

## 8. CSS Architecture

Two stylesheets, both in `docs/css/`:

| File | Purpose |
|---|---|
| `theme.css` | CSS variables — colors, fonts, shadows, textures |
| `components.css` | All component styles, layout rules, responsive breakpoints |

**Key layout rules:**
- `.container` — `max-width: 900px; width: 100%; margin: 0 auto` — always fills to max-width
- `.top-controls` — `min-height: 260px; width: 100%` — never shrinks when content is hidden
- `.goal-actions` — `margin-top: 10px` — always visible, sibling of `bookControls`
- `.tts-active` — locked "on" appearance for Read Page button while TTS is active or counting down
- `.tts-sentence` — sentence highlight span, alpha controlled by `--tts-alpha` CSS var

**Breakpoints:**
- `@media (max-width: 768px)` — tablet layout adjustments
- `@media (max-width: 520px)` — mobile layout adjustments
- `@media (max-width: 480px)` — small mobile

---

## 9. Key Design Principles

**Atomic Page Model** — All AI features operate on one page at a time. No state is shared across pages in AI calls.

**Deterministic Frontend** — The frontend never interprets AI output. It only renders responses and performs deterministic matching (anchors, scoring display).

**Strict Output Contracts** — Critical AI outputs use fixed formats enforced by prompts. The 4-line grader format prevents parsing failures.

**Serverless Feature Isolation** — Each feature is its own endpoint. Failures are isolated and independently debuggable.

**No API Keys on Client** — All third-party keys (Anthropic, Polly, FreeConvert) remain server-side. The client calls only the app's own `/api/*` endpoints.

**Background Audio** — TTS continues when the user switches tabs (`visibilitychange` intentionally not wired to `ttsStop`). Stops only on true navigation (`pagehide`, `beforeunload`).

**Lazy Anchor Generation** — Anchors are generated on first meaningful engagement (textarea focus or Hint click), not on page load. Cached in localStorage by page hash.

**Session Persistence** — All learner work (consolidations, ratings, AI feedback) persists across page refreshes via localStorage, keyed by stable SHA-256 page hash.

---

## 10. Known Platform Constraints

A running log of device and browser-specific behavior discovered at runtime. Entries here should be cross-referenced in the relevant file section above.

| Platform | Area | Constraint | Mitigation |
|---|---|---|---|
| Safari / iPadOS | Audio | `play()` blocked without synchronous user gesture | Pre-load during countdown; keep-warm assigns `TTS_SILENT_SRC` (skipped when preload armed) |
| iOS / Android | Audio | Audio elements blocked until first gesture in session | `playSfx()` retry logic in `audio.js` |
| Safari / macOS / iOS | Browser TTS voices | Novelty voices (Albert, Zarvox, Boing etc.) appear in `getVoices()` and can be selected by fallback logic | Filter by name; expanded named lists; gender-aware Microsoft/Google brand fallback |
| Safari / iOS / iPadOS | Audio element events | `loadedmetadata` may not re-fire on reused `Audio` element after first load | Use `timeupdate` instead — fires reliably during playback on all platforms |
| Firefox | Silent audio | Data URI MP3/WAV may be rejected with `NS_ERROR_DOM_MEDIA_METADATA_ERR` | `TTS_SILENT_SRC` generated as Blob WAV via `ArrayBuffer` + `DataView` + `URL.createObjectURL` |
| All browsers | S3 binary preload | `fetch()` to S3 blocked by CORS unless bucket policy allows `stripstone.github.io` | Without CORS policy: preload silently fails, falls back to `<audio src>` — audio plays, preload does not |
| All platforms | Device sleep | OS may revoke Screen Wake Lock under low battery or power saver | 30s cooldown after revocation; `visibilitychange` re-acquires if TTS still active |
| All platforms | Stall recovery false positives | `waiting` event fires on every fresh `audio.src = url; play()` at `readyState=0` | Guard: bail immediately if `readyState < 2` — only retry genuine mid-playback stalls |

*Add new entries as discovered during runtime testing.*
