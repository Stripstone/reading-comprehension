# Reading Trainer — Backlog

This document tracks **all planned and executed code changes** across bugs, features, and platform issues.

It exists to:
- Prevent regressions
- Track implementation status
- Separate execution from spec and planning documents
- Define **what must be true before the product is safe to use or launch**

This document is the **working layer** between:
- **ExperienceSpec.md** (UX intent)
- **SystemResponsibilitiesMap.md** (technical implementation)
- **LaunchPlan.md** (go-to-market execution)

---

## Status Definitions

| Status | Meaning |
|---|---|
| Open | Identified, not started |
| In Progress | Actively being worked |
| Built | Implemented, not yet verified in real conditions |
| Validated | Confirmed working in real conditions |

---

## Risk Levels

| Level | Meaning |
|---|---|
| 🔴 Critical (Blocking) | Breaks core experience or user trust — must be fixed before real usage or launch |
| 🟡 High (Pre-Validation) | Significant degradation — should be fixed before extended testing |
| 🟢 Normal | Enhancement or non-blocking improvement |

---

## 1. Bugs

### 🔴 Critical (Blocking)
*(none — all resolved)*

---

### 🟡 High (Pre-Validation)
*(none — all resolved)*

---

### 🟢 Normal
*(none)*

---

### ✅ Resolved

- **TTS book-switch bug** — **Built**
  - Repro: Play TTS on Page 1 → switch book → play Page 1 again
  - Root cause: Playback sessions keyed by page index caused collisions across book switches
  - Fix: Monotonic `TTS_GEN` counter incremented on every `ttsStop()`. Stale async chains bail immediately on generation mismatch.

- **TTS mid-page pause (intermittent)** — **Built**
  - Root cause: No stall recovery logic; retry timing fired before buffer filled
  - Fix: Stall recovery with backoff (1500ms → 4000ms → 9000ms), `readyState < 2` guard to skip initial buffering, early exit if playback self-resumes

- **Music stops under low connectivity** — **Built**
  - Root cause: No handling for `error` or `ended` events on background music
  - Fix: `restartBgMusic` wired to both events; respects mute state on recovery

- **TTS highlight desync** — **Built**
  - Root cause: Static 60-second timing placeholder before real timing applied
  - Fix: Character-based timing estimate (~950 chars/min); Azure highlight refined on `timeupdate`
  - Note: First-sentence timing still imperfect — Azure does not provide speech marks. Estimate only. Accepted as-is.

- **Clicks passing through modals** — **Built**
  - Root cause: Event bubbling to document-level handlers
  - Fix: `e.stopPropagation()` added to all three modal overlays (`ui.js`, `import.js`, `library.js`)

- **TTS playback instability under weak connection** — **Built**
  - Root cause: Audio downloaded at playback time; no retry logic
  - Fix: Binary preload during countdown, stall recovery with backoff, `readyState < 2` guard. See preload system below.

---

## 2. Pre-Launch Features

### 🔴 Critical (Blocking)
*(none — all resolved)*

---

### 🟡 High (Pre-Validation)

- **Cold-start guidance**
  - Add “Start here” flow
  - Reduce initial cognitive load (mode/source/tier)

---

### 🟢 Normal
*(none)*

---

### ✅ Resolved

- **Reading progress persistence** — **Built**
  - `lastReadPageIndex` persisted in `state.js` session snapshot
  - Restored on boot; scroll position restored after `render()`
  - Boot scroll uses `window.load` + 300ms settle (replaced fixed timeout)
  - Also resolved: `currentPageIndex` undeclared variable silently broke all session restore. Fixed with `typeof` guard.
  - Also resolved: `goalTime` and `goalCharCount` now included in session snapshot — knobs survive refresh

- **TTS preloading for next page** — **Built** (⚠️ S3 CORS required for full benefit — see Section 5)
  - Full binary preload during autoplay countdown: fetches audio file as `Blob`, stores as `URL.createObjectURL`
  - Play block consumes `preloadedBlobUrl` — plays from memory, `readyState=4` instantly
  - Preserves preload on normal countdown completion (`clearPreload: false`)
  - Keep-warm skips silent audio injection when preload exists
  - Blob URL revoked on `ended`, `error`, and `ttsStop()`
  - Without S3 CORS policy applied, `fetch()` to S3 is blocked; system falls back to `<audio src>` gracefully

---

## 3. Post-Launch Features

### 🟢 Normal

#### Core Reading Enhancements

- **Adjustable reading speed**
  - User control over TTS playback rate

- **Sleep timer (app-level)**
  - Stop playback after configurable duration

- **Global mute control**
  - True mute state across all audio systems

- **End-of-chapter indicator**
  - Simple marker: “End of Chapter X”

---

#### Content & Input Expansion

- **Text input from photos (OCR)**

- **Tap-to-define terms in context**

- **Multi-language support**

---

#### Library & Content Management

- **Chapter arrangement**
  - User-controlled ordering during import and/or in library

- **Cloud book storage (Paid tier)**
  - Persist user library across devices

---

#### Personalization

- **App customization**
  - Book formatting
  - Page layout
  - Background music
  - Wallpaper / textures
  - Offline + online configuration

---

## 4. Platform & Connectivity Issues

### 🔴 Critical (Blocking)
*(none — all resolved)*

---

### 🟡 High (Pre-Validation)

- **Preload window may be insufficient on GPRS / very slow connections**
  - 3-second countdown may not allow full binary download before playback
  - System falls back gracefully to `<audio src>` assignment, but delays persist
  - Full mitigation requires S3 CORS policy (owner action — see Section 5)

- **Device sleep full session persistence**
  - Wake Lock keeps screen on during cloud TTS playback
  - Wake Lock OS revocation: 30-second cooldown before re-acquiring
  - Full device-sleep session persistence (non-TTS context) is post-launch

---

### 🟢 Normal
*(none)*

---

### ✅ Resolved

- **Audio instability under weak/spotty connection** — **Built**
  - Music: `restartBgMusic` wired to `error` + `ended`
  - TTS stalls: backoff retry (1500ms → 4000ms → 9000ms) + `readyState < 2` guard
  - Highlighting: character-based timing estimate; refined on `timeupdate`

- **TTS dependency on live connection** — **Built** (partial — see S3 CORS in Section 5)
  - Binary preload fetches audio into memory during countdown
  - Stall recovery handles mid-playback drops
  - Full pre-buffering depends on S3 CORS being configured

- **Device sleep interrupts playback** — **Built**
  - `visibilitychange` resume handlers in `tts.js` and `audio.js`
  - Screen Wake Lock acquired during cloud TTS; released on `ttsStop()`
  - Wake Lock revocation cooldown prevents acquire/release storms

---

## 5. Outstanding Infrastructure Actions (Owner)

These are not code tasks — they are AWS console actions that unlock built features.

- **S3 CORS policy** — unlocks binary preload for slow connections
  - Without this, `fetch()` to S3 is CORS-blocked; binary preload silently fails; system falls back to `<audio src>`
  - Audio plays correctly either way — this is a performance unlock, not a bug fix
  - Set `AllowedOrigins` to production domain once confirmed
  - See `LaunchPlan.md §11.3` for the full policy

- **S3 Lifecycle policy** — 90-day expiry on `tts/` prefix
  - S3 keeps objects forever by default; at 100k users storage costs compound
  - Recommended: expire objects older than 90 days (popular content naturally re-caches)
  - See `LaunchPlan.md §11.2` for cost model

- **Remove Polly env vars from Vercel** — billing risk
  - If `POLLY_VOICE_ID` etc. are present, Polly fallback in `index.js` can silently activate
  - Confirm absent to make Azure-only billing airtight
  - See `LaunchPlan.md §11.4`

---

## 6. Post-Launch Cleanup

These items do not affect current behavior but should be addressed post-launch.

- **Dead Polly synthesis path in `index.js`** — strip down to Azure-only with clean error on Azure failure
- **Unused Polly env vars on Vercel** — remove after launch confirmation
- **`speechMarks` path in `index.js`** — currently returns `null` for Azure; clean up post-launch
- **Voice preference UI** — allow user to set and name preferred voices; consider character presentation (backlog idea)
- **Stall recovery is reactive, not predictive** — does not anticipate drops; only reacts. Post-launch improvement.

---

## 7. Notes

- Bugs and platform issues should also be reflected in:
  - **ExperienceSpec.md → Runtime Observations**
  - **SystemResponsibilitiesMap.md → Known Platform Constraints**

- This document tracks **execution state and risk**, not behavior or product intent.

- Items move strictly:
  **Open → In Progress → Built → Validated**

- No item is complete until **Validated under real usage conditions**.

- **All 🔴 Critical items must be resolved before:**
  - External user testing
  - Launch plan execution