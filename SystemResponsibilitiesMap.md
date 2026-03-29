# Reading Trainer — System Responsibilities Map

This document is the technical source of truth for the current architecture, the transitional shell/runtime split, and the intended redistribution target for the Reading Trainer application.

It answers four questions:

1. What currently exists in code
2. What is transitional
3. What is authoritative
4. What is still duplicated in the monolith and must be redistributed

This document owns architecture and responsibility boundaries.

- **ExperienceSpec.md** owns expected user-facing behavior.
- **LaunchPlan.md** owns launch gating, validation, and go-to-market sequencing.
- **backlog.md** owns execution status after implementation and regression.

---

## 1. Audit Summary

The current frontend is **not yet a clean shell + scaffold system**. It is a transitional hybrid:

- A large **shell/monolith layer in `docs/index.html`** owns section routing, theme controls, preview modal behavior, reading-view chrome, shell-only cleanup helpers, and several adapters into the runtime.
- The **runtime scaffold in `docs/js/`** owns page rendering, reading flow, importer logic, TTS, evaluation flow, state, and most deterministic application behavior.
- Several launch-critical behaviors are currently **split across both layers**, which is the main architectural risk.

### Current audit conclusions

#### What currently exists
- A functioning static frontend in `docs/`
- A working serverless backend in `api/`
- A real runtime scaffold split into role-based global scripts loaded by `app.js`
- A shell-heavy `index.html` that still contains important behavior adapters and cleanup logic

#### What is transitional
- Shell-to-runtime bridge functions in `index.html`
- Shell-owned wrappers for TTS speed, pause/play, autoplay UI, importer cleanup, preview handoff, and reading cleanup
- Scaffold login placeholder in `index.html`
- Hook-based coordination such as `__jublyLibraryRefresh`, `__jublyAfterRender`, and shell polling of runtime state

#### What is authoritative
- `docs/js/` is authoritative for runtime behavior, page generation, importer logic, TTS playback, and evaluation flow
- `docs/index.html` is authoritative for shell layout, section routing, shell modals, reading chrome, and theme/tier presentation
- `api/` is authoritative for anchors, evaluation, import conversion, summary, health, and cloud TTS endpoints
- This document is now authoritative for where those boundaries should end up

#### What is duplicated in the monolith
- TTS speed control logic exists in shell code while TTS playback lives in `tts.js`
- Reading cleanup is performed by shell code while runtime audio state lives in `tts.js` and `audio.js`
- Importer transient UI reset is handled in shell code while importer state lives inside `import.js`
- Reading entry / preview handoff is shell-driven while actual book loading and rendering live in `library.js`
- Tier/theme visuals are shell-owned while actual tier gating is applied by `ui.js`
- Progress display exists in the shell, but true reading-position persistence is not currently owned end-to-end by runtime state

---

## 2. System Overview

The application currently has three primary code layers plus one external persistence layer.

| Layer | Location | Purpose |
|---|---|---|
| Shell | `docs/index.html`, `docs/css/`, shell-only inline script | Layout, section routing, shell chrome, theme surface, preview modal, reading top/bottom controls |
| Runtime Scaffold | `docs/js/` | Reading pipeline, rendering, importer, evaluation, TTS, state, deterministic UI behavior |
| Backend | `api/`, `api/_lib/`, `api/prompts/` | AI features, TTS generation, import conversion, prompt contracts |
| External persistence | Supabase Auth + Postgres | Auth-linked user/account records, progress persistence, user settings, entitlement records |

### Hosting
- Frontend: GitHub Pages / static hosting
- Backend: Vercel serverless functions

### Runtime model
- No bundler required
- No ES modules
- Shared global scope
- `docs/js/app.js` dynamically loads runtime files in a fixed order

---

## 3. Current Load Order and Execution Model

### Frontend script order

Static shell assets load first from `index.html`:

1. `js/config.js`
2. `assets/books/embedded_books.js`
3. `js/audio.js`
4. `js/embers.js`
5. `js/app.js`

Then `app.js` loads the scaffold sequentially:

```text
state.js → tts.js → utils.js → anchors.js → import.js → library.js → evaluation.js → ui.js
```

### What this means
- `audio.js` is **outside** the sequential loader and is available before scaffold load completes.
- `index.html` inline shell code runs in the same global environment and can call runtime globals once they exist.
- This is why shell/runtime coupling currently works, but it also explains the current drift risk.

---

## 4. Authoritative Ownership Model

This is the target ownership split that all future redistribution work must follow.

### Shell owns
- Top-level section routing
- Navigation chrome
- Reading-view chrome
- Shell-only modals and presentation wrappers
- Theme swatches and visual theme selection UI
- Tier presentation UI
- Preview modal and shell handoff controls
- Responsive layout and clipping fixes
- App-level focus presentation such as reading-view fade behavior

### Runtime scaffold owns
- Reading session state
- Page data and page rendering
- Book/chapter/page loading
- Reading entry resolution
- Next-page / wrap behavior
- TTS lifecycle
- Autoplay lifecycle
- Progress persistence and restore
- Importer state lifecycle
- Leaving-reading cleanup for reading-owned systems
- Tier enforcement rules
- Evaluation flow and page progression rules

### Backend owns
- Anchors generation
- AI evaluation
- Cloud TTS generation
- Book format conversion
- Summary generation
- Shared server helpers and prompts

### External services own
- Supabase Auth identity and auth-linked cloud persistence
- Durable user/account records
- Durable reading-progress records
- Durable user settings records
- Durable entitlement records
- Stripe payment truth once webhook integration is wired
- Google login identity entry path once enabled

### Documentation ownership
- **This file**: architecture and responsibility boundaries
- **ExperienceSpec.md**: user-facing behavioral expectations
- **LaunchPlan.md**: what must be built and validated before launch
- **backlog.md**: built vs validated status after implementation/testing

---

## 5. Current Reality by Layer

## 5.1 Shell (`docs/index.html`)

The shell is currently larger than a pure layout layer. It contains both proper shell responsibilities and transitional adapters.

### Proper shell responsibilities currently present
- Section routing via `showSection()`
- Sidebar and footer visibility
- Focus-mode fading in reading view
- Theme swatches and explorer gating UI
- Tier pill visuals
- Reading top/bottom bar markup
- Preview modal UI
- Pricing modal UI
- Library and profile page layout
- Reading-view layout and shell CSS variables

### Transitional responsibilities currently present in shell code
- `login()` placeholder for future auth
- `shellSetSpeed()` writing TTS speed into shared runtime state/localStorage
- `handlePausePlay()` delegating into runtime TTS functions
- `handleAutoplayToggle()` toggling runtime autoplay through hidden control wiring
- `cleanupReadingTransientState()` stopping TTS, countdowns, music, and shell badges on exit
- `clearImporterTransientUI()` resetting importer UI after close/done
- `startReading()` / preview-to-reading shell handoff behavior
- Shell polling of `AUTOPLAY_STATE` for countdown badge rendering
- MutationObserver-driven session-complete detection in shell space
- Hook patching via `patchRefreshHook()` and `__jublyLibraryRefresh`

### Shell assessment
The shell is currently **authoritative for layout and routing**, but **transitional for several runtime-facing behaviors** that should eventually move behind runtime-owned entry points.

---

## 5.2 Runtime Scaffold (`docs/js/`)

The scaffold is the real application engine.

### `state.js`

Current responsibility:
- Global application state
- Token counters
- Session persistence snapshot
- Per-page persisted work keyed by page hash
- Goal values
- Shared state primitives used across files

Current reality:
- `pages`, `pageData`, `appMode`, `appTier`, `goalTime`, and `goalCharCount` are real runtime state
- Persistence exists through `rc_session_v2` and per-page `rc_consolidation_<hash>` records
- `schedulePersistSession()`, `persistSessionNow()`, and `ensurePageHashesAndRehydrate()` are real and active

Current problem:
- `loadPersistedSessionIfAny()` still references undeclared `currentPageIndex`
- There is **no current `lastReadPageIndex` implementation** in the audited code
- This means true reading-position restore is **not authoritative or complete in current runtime state**

Target responsibility:
- Own session restore fully, including last reading position and re-entry state
- Remove shell dependence for restore decisions

### `tts.js`

Current responsibility:
- Browser/cloud TTS selection
- Audio unlock path
- Active page narration
- Sentence highlighting
- Autoplay countdown and next-page scheduling
- Read button active state

Current reality:
- `TTS_STATE`, `AUTOPLAY_STATE`, and `TTS_AUDIO_ELEMENT` are real runtime TTS authority
- Free tier routes to browser TTS
- Paid tiers route to `/api/tts` with browser fallback
- Highlighting and autoplay are runtime-owned
- Stop conditions on navigation/unload are runtime-owned

Current problem:
- Speed persistence/application is not owned cleanly end-to-end here
- Shell code patches browser speech rate and writes speed into storage
- Pause/play and autoplay top-bar controls are shell adapters, not native runtime controls

Target responsibility:
- Own playback speed application consistently at every TTS start/resume path
- Expose stable runtime entry points for shell controls without the shell mutating internals

### `library.js`

Current responsibility:
- Book loading and selection
- Embedded/local library access
- Page splitting and rendering
- Reading page card generation
- Page interactions
- Timer setup and sand behavior
- Manage Library modal population

Current reality:
- `render()` is still the authoritative runtime renderer for page cards
- Book population and local library refresh are runtime-owned
- Focus and page activation behavior is runtime-owned
- `window.__rcRefreshBookSelect` exists as a runtime refresh hook for importer flow

Current problem:
- Shell still owns parts of preview-to-reading handoff and post-render affordances
- Session-complete and progress signals are partly shell-derived rather than purely runtime-owned

Target responsibility:
- Own reading entry, active-page state, progress state, and session-complete signaling
- Keep shell responsible only for displaying the resulting UI

### `import.js`

Current responsibility:
- Import modal logic
- File staging
- EPUB parsing
- Conversion flow through `/api/book-import`
- TOC selection and import progress
- Saving imported book to IndexedDB

Current reality:
- `_file`, `_zip`, `_tocItems`, `_bookTitle`, `_needsConversion`, `_inputFormat` live entirely inside importer runtime state
- Modal open/close, file selection, scanning, and import pipeline are runtime-owned

Current problem:
- Shell separately clears importer transient UI after close/done
- True importer reset is not exposed as a single runtime-owned reset function
- This is why staged upload state and visible UI cleanup are not guaranteed to stay aligned

Target responsibility:
- Own modal close/reset behavior entirely through runtime entry points
- Shell should only open/close the modal, not manually reset importer internals/UI

### `evaluation.js`

Current responsibility:
- Navigation between pages
- Compass unlock flow
- Rating and submit behavior
- Evaluation phase transitions

Current reality:
- `goToNext()` remains runtime authority for page progression rules
- Reading/comprehension differences are runtime-owned
- Evaluation persistence calls into shared session persistence

Target responsibility:
- Continue owning page progression logic
- Provide runtime events/signals that the shell can observe without recreating logic

### `ui.js`

Current responsibility:
- Control panel initialization
- Mode selector init
- Tier selector init and tier gating
- Utility panels
- Diagnostics init
- Autoplay toggle init
- Boot restore entry

Current reality:
- `appTier` and tier access enforcement are runtime-owned here
- Mode selection and persistence are runtime-owned here
- Session boot restore is initiated here

Current problem:
- Tier visuals are shell-owned while tier enforcement is runtime-owned
- Current boot path does not complete launch-required reading-position restore
- Research/thesis naming/comments are not fully normalized

Target responsibility:
- Continue owning gating and initialization
- Expose clean runtime status for shell rendering rather than duplicating decision logic in shell code

### `audio.js`

Current responsibility:
- Interface SFX
- Background music
- Mute state
- Volume handling for non-TTS audio

Current reality:
- Audio effects are separate from `tts.js`
- Shell exit cleanup currently reaches into this domain indirectly

Target responsibility:
- Runtime-owned audio stop/cleanup entry points should be exposed cleanly for navigation/section exit

### `anchors.js`, `utils.js`, `config.js`, `embers.js`

Current responsibility:
- `anchors.js`: anchor generation/render/update behavior
- `utils.js`: helpers
- `config.js`: constants
- `embers.js`: purely visual particles

Assessment:
- These files are already close to correct ownership boundaries
- `embers.js` should remain shell/theme-triggered but implementation-local

---

## 5.3 Backend (`api/`)

The backend is structurally sound and already separated from the shell/runtime split.

### `api/anchors`
- Anchor generation endpoint

### `api/evaluate`
- AI evaluation endpoint

### `api/book-import`
- File conversion endpoint for non-EPUB inputs

### `api/tts`
- Cloud TTS endpoint

### `api/summary`
- Summary endpoint

### `api/health`
- Health check endpoint

### `api/_lib/`
- Shared helpers

### `api/prompts/`
- Prompt contracts

Assessment:
- Backend is authoritative for AI and conversion features
- Current architecture cleanup work is primarily frontend shell/runtime redistribution, not backend redesign

---

## 5.4 External Persistence Layer (Supabase)

Supabase now exists as a real project-level dependency rather than a future placeholder.

### Current state
- Supabase project created
- Auth-linked Postgres available
- RLS enabled
- Core tables created for `users`, `user_progress`, `user_sessions`, `user_settings`, and `user_entitlements`
- Current table/policy layer is ready for frontend/backend integration, not just planning

### Current responsibility
Supabase is the durable cloud record for:
- user/account state
- tier/token state
- cross-device progress state
- persistent user settings
- future entitlement state

### Important architectural rule
Supabase persists runtime-owned truths. It does not replace runtime ownership.

That means:
- `state.js` still owns what restore means
- `library.js` still owns what source/book/page opens
- `tts.js` still owns how playback state behaves
- `ui.js` still owns gating/state application in the client
- Supabase stores the durable records that let those truths survive sign-in and device changes

### Current integration status
- Schema foundation exists now
- Frontend `supabase-js` integration is still pending
- Backend JWT verification and Stripe-to-entitlement write paths are still pending

---

## 6. Transitional Architecture Map

The following elements are transitional and should be treated as temporary bridge code, not long-term final ownership.

| Transitional element | Current location | Why transitional | Redistribution target |
|---|---|---|---|
| `login()` scaffold auth | `docs/index.html` | Placeholder only | Replace with real auth integration later |
| TTS speed bridge | `docs/index.html` | Shell mutates runtime/audio behavior directly | Runtime-owned speed API in `tts.js`/`ui.js` |
| Pause/play shell wrapper | `docs/index.html` | Shell control delegates directly into runtime internals | Keep wrapper thin; runtime owns playback state |
| Autoplay shell wrapper | `docs/index.html` | Shell toggles hidden runtime control path | Runtime-owned toggle API |
| Importer transient cleanup | `docs/index.html` | Shell resets importer UI separately from importer state | `import.js` owns reset lifecycle |
| Reading cleanup helper | `docs/index.html` | Shell manually stops reading-owned systems | Runtime-owned exit cleanup function |
| Preview → reading handoff | `docs/index.html` + `library.js` | Split responsibility | Runtime resolves selected source; shell only triggers entry |
| Library refresh patching | `docs/index.html` hooks | Hook-based bridge | Stable runtime event or refresh API |
| Countdown badge polling | `docs/index.html` | Shell polls runtime state | Runtime emits clean status; shell renders |
| Session complete detection | `docs/index.html` observer | Shell infers runtime completion | Runtime should signal completion |

---

## 7. What Is Duplicated in the Monolith

These are the main duplication points that drove the current audit.

### 7.1 Reading entry is split
- Shell chooses when reading mode is shown
- Shell preview modal starts the reading handoff
- Runtime actually loads books/pages and renders cards

**Result:** reading entry, progress restore, and “return later” behavior are not owned in one place.

### 7.2 TTS control is split
- Runtime owns TTS playback and autoplay state
- Shell owns visible top-bar controls and speed bridging
- Shell patches browser TTS rate at the browser API level

**Result:** speed consistency and top-control synchronization are fragile.

### 7.3 Importer lifecycle is split
- Runtime owns staged file/import state
- Shell clears UI pieces after close/done

**Result:** modal close can leave staged state behaviorally ambiguous.

### 7.4 Reading cleanup is split
- Runtime owns TTS/audio systems
- Shell calls cleanup on reading exit

**Result:** leaving-reading behavior depends on shell navigation path rather than a single runtime-owned exit rule.

### 7.5 Tier/theme responsibility is split
- Runtime owns `appTier` and gating rules
- Shell owns tier visuals, theme visuals, and explorer swatch behavior

**Result:** visual sync is possible, but authority is split between enforcement and presentation.

### 7.6 Progress is split and incomplete
- Shell shows page progress text and session-complete UI
- Runtime owns pages and page rendering
- Current documented `lastReadPageIndex` flow is not present in audited code

**Result:** launch-critical return-to-last-page behavior is not complete.

---

## 8. Current Known Mismatches Between Docs and Code

These mismatches were identified during the audit and are now corrected by this document.

### 8.1 Session restore is not in the state described by previous docs
Previous documentation described:
- `lastReadPageIndex`
- session restore fixed
- boot scroll to last read page

Audited code reality:
- no active `lastReadPageIndex` variable found in runtime code
- `loadPersistedSessionIfAny()` still references undeclared `currentPageIndex`
- true reading-position restore is therefore not currently authoritative

### 8.2 Research/thesis terminology drift exists
- Runtime comments still use mixed research/thesis language
- User-facing doc terminology should be normalized deliberately

### 8.3 TTS implementation details in prior docs overstated the current implementation
Previous docs described a more advanced preload/wakelock/generation architecture than what exists in the current audited `tts.js`.

Current code reality:
- autoplay countdown exists
- browser/cloud split exists
- sentence highlighting exists
- audio unlock exists
- but the audited implementation is simpler than previously documented and still relies on shell bridge logic for some behaviors

### 8.4 Reading progress memory was overstated in launch planning
Launch planning previously treated reading position memory as built.

Current code reality:
- persistence exists for pages and per-page work
- true last-page restore is not complete in the audited runtime

---

## 9. Redistribution Target

This is the intended end state the codebase should move toward after documentation is refreshed.

### Shell target
The shell should become a **thin but complete app frame**.

It should own:
- section routing
- shell chrome
- reading layout structure
- theme presentation
- preview modal presentation
- top/bottom reading controls as display surfaces
- responsive layout fixes
- library/profile shell layout

It should **not** own:
- importer reset internals
- TTS speed logic implementation
- session-complete inference
- reading progress authority
- TTS/autoplay state mutation beyond calling public runtime entry points

### Runtime target
The runtime should become the **single owner of reading behavior**.

It should own:
- selected reading source resolution
- reading entry
- session restore
- reading position persistence
- page progression and wrap
- session completion state
- importer reset lifecycle
- TTS speed application
- reading exit cleanup
- tier gating behavior

### Bridge target
Only thin shell-to-runtime adapters should remain, for example:
- `startReadingFromPreview()`
- `setPlaybackRate(rate)`
- `toggleAutoplay()`
- `pauseOrResumeReading()`
- `exitReadingSession()`
- `resetImporterState()`

Those adapters should call runtime-owned functions, not recreate logic.

---

## 10. Launch-Critical Responsibility Clarifications

The following launch-critical behaviors must be treated as runtime-owned, even if shell surfaces them.

### Reading progress restore
- Runtime-owned
- Shell only displays the resulting reading view

### Tier unlock / gating
- Runtime-owned enforcement
- Shell-owned pill/swatch/visual display

### TTS reliability
- Runtime-owned
- Shell only surfaces controls and indicators

### Leaving reading
- Runtime-owned cleanup
- Shell navigation should call one runtime exit path

### Importer modal state clearing
- Runtime-owned reset
- Shell close button may trigger it, but should not manually recreate it

### Theme/tier sync after load
- Runtime owns true state
- Shell reflects it visually

---

## 11. File Responsibilities — Finalized Map

### Frontend shell

| File | Final responsibility |
|---|---|
| `docs/index.html` | Shell layout, section routing, shell modals, reading chrome, theme/tier presentation, preview presentation, thin bridge calls only |
| `docs/css/theme.css` | Theme tokens and variable sets |
| `docs/css/components.css` | Component layout, responsive behavior, layout lock for shared shell/runtime structure |

### Frontend runtime scaffold

| File | Final responsibility |
|---|---|
| `docs/js/app.js` | Ordered global-script boot loader |
| `docs/js/state.js` | Shared app state, session snapshot, page hashes, reading-position persistence, restore authority |
| `docs/js/tts.js` | Narration lifecycle, browser/cloud routing, playback speed application, autoplay state, highlighting, stop/resume |
| `docs/js/import.js` | Importer lifecycle, staged file state, conversion flow, modal reset API |
| `docs/js/library.js` | Book selection, loading, page generation, reading entry resolution, render authority |
| `docs/js/evaluation.js` | Next/wrap progression, evaluation phase rules, submit flow |
| `docs/js/ui.js` | Runtime control init, mode/tier selectors, utility panels, diagnostics, boot restore init |
| `docs/js/audio.js` | SFX/music systems and cleanup hooks |
| `docs/js/anchors.js` | Anchor generation/render/update |
| `docs/js/utils.js` | Shared helpers |
| `docs/js/config.js` | Constants |
| `docs/js/embers.js` | Ambient particle effect implementation |

### Backend

| File area | Final responsibility |
|---|---|
| `api/_lib/` | Shared server helpers |
| `api/anchors/` | Anchor generation endpoint |
| `api/evaluate/` | AI evaluation endpoint |
| `api/book-import/` | Non-EPUB conversion endpoint |
| `api/tts/` | Cloud TTS endpoint |
| `api/summary/` | Summary endpoint |
| `api/health/` | Health check |
| `api/prompts/` | Prompt contracts |

---

## 12. Implementation Guidance for the Next Phase

This document does not execute the redistribution, but it defines how that work should proceed.

### Sequence
1. Keep shell layout intact
2. Move runtime-owned behavior out of shell helpers and into scaffold APIs
3. Remove duplicated monolith logic only after runtime replacement exists
4. Regression test reading entry, importer close/reset, reading exit cleanup, tier/theme sync, TTS speed consistency, and session restore
5. Update `backlog.md` after implementation and validation

### Hard rules
- Do not move layout ownership out of the shell
- Do not move reading/TTS/import/session authority into shell code
- Do not rely on hook patching where a real runtime entry point can exist
- Do not mark launch-critical items built unless the audited code and regression pass both confirm them

---

## 13. Current Platform and Runtime Constraints

These are the constraints that matter for the current codebase.

| Area | Current constraint | Ownership |
|---|---|---|
| Global load order | Shared globals require stable script order | `app.js` + shell |
| Audio start | Browser/platform gesture constraints still apply | `tts.js`, `audio.js` |
| Shell/runtime bridge | Inline shell code can access runtime globals, creating drift risk | transitional |
| Session restore | Incomplete in current audited state | `state.js` target |
| Import modal reset | UI and runtime state are not yet unified | `import.js` target |
| Tier/theme sync | Visual state and enforced state are split | shell + `ui.js` |

---

## 14. Final Architecture Decision

Reading Trainer is currently a **hybrid shell/monolith plus scaffold runtime**.

The correct direction is **not** to push more behavior into `index.html`.
The correct direction is:

- keep `index.html` as the shell and presentation layer
- restore runtime authority for reading, TTS, importer, progress, and cleanup behavior
- use thin shell adapters only where the shell needs to trigger runtime behavior

That is the architecture this project should now treat as authoritative.


## Supabase Environment Variable Naming

The authoritative environment variable names are:

- `SUPABASE_URL` — frontend safe
- `SUPABASE_ANON_KEY` — frontend safe
- `SUPABASE_SECRET_KEY` — backend only

Only `SUPABASE_URL` and `SUPABASE_ANON_KEY` should be used by frontend client initialization.  
`SUPABASE_SECRET_KEY` must remain server-only and must never be exposed to the client.

A raw Postgres connection string is not required for normal frontend/runtime integration.

