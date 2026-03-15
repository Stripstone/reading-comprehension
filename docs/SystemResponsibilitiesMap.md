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
| `timers` | `number[]` | Per-page elapsed timer values |
| `intervals` | `id[]` | Per-page `setInterval` handles |

**Persistence functions:**
- `schedulePersistSession()` — debounced save (250ms)
- `persistSessionNow()` — immediate save to `localStorage`
- `loadPersistedSessionIfAny()` — restores session on boot
- `ensurePageHashesAndRehydrate()` — backfills hashes if missing from older saves
- `clearPersistedSession()` — wipes session storage

**Session storage keys:**
- `rc_session_v2` — page texts + hashes + consolidations snapshot
- `rc_consolidation_<hash>` — per-page record (consolidation, rating, AI feedback, sandstone flag)
- `rc_app_mode` — last selected mode
- `rc_thesis_text` — thesis input value

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

AUTOPLAY_STATE = {
  enabled,            // bool — from autoplay checkbox
  countdownPageIndex, // page index currently counting down (-1 = none)
  countdownSec,       // seconds remaining in countdown
  countdownTimerId,   // setInterval handle
  preloadedMarks,     // Polly sentence marks pre-fetched during countdown
}
```

**Key functions:**

| Function | Purpose |
|---|---|
| `ttsSpeakQueue(key, parts, preloadedAudio?, preloadedUrl?)` | Main TTS entry point. Polly first, browser fallback. |
| `ttsStop()` | Stops all audio, cancels countdown, clears highlights, removes `.tts-active` from all buttons |
| `ttsAutoplayScheduleNext(pageIndex)` | Starts 3-second countdown after page finishes, pre-fetches next page audio (Safari fix) |
| `ttsAutoplayCancelCountdown()` | Cancels countdown, resets button text and `.tts-active` class |
| `ttsSetButtonActive(key, active)` | Adds/removes `.tts-active` class on the Read Page button for the given key |
| `ttsSetHintButton(key, disabled)` | Disables/enables the Hint button while TTS is highlighting that page |
| `ttsMaybePrepareSentenceHighlight(key, text, marks)` | Injects `.tts-sentence` spans and disables Hint button |
| `ttsClearSentenceHighlight()` | Restores original innerHTML, re-enables Hint button |

**Stop conditions:**
- `pagehide` → `ttsStop()`
- `beforeunload` → `ttsStop()`
- Tab switching (`visibilitychange`) → **intentionally NOT wired** — audio continues in background

**Autoplay flow:**
```
Page finishes reading
→ ttsAutoplayScheduleNext(pageIndex) called
→ Polly URL pre-fetched for next page during countdown
→ Button shows "⏸ Next in 3…" countdown
→ At 0: scroll to next page, start ttsSpeakQueue with pre-loaded audio
→ Clicking button during countdown cancels autoplay
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

**Hint button interaction:** While sentence highlighting is active, the Hint button is disabled to prevent anchor `innerHTML` injection from destroying the TTS sentence spans. It is re-enabled in `ttsClearSentenceHighlight()` when TTS finishes.

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
}
```

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

**Provider:** Amazon Polly (neural voices). Voice controlled by `POLLY_VOICE_ID` / `POLLY_ENGINE` env vars. `voiceVariant: 'male'` routes to a separate env var.

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
| Safari / iPadOS | Audio | `play()` blocked without synchronous user gesture | Pre-load during countdown; see `tts.js` Safari fix |
| iOS / Android | Audio | Audio elements blocked until first gesture in session | `playSfx()` retry logic in `audio.js` |

*Add new entries as discovered during runtime testing.*
