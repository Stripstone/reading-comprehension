# Reading Trainer — Redistribution Execution Map

This document is the actionable implementation map for restoring file continuity in `reading-comprehension_architecture.zip`.

It is downstream of:
- `SystemResponsibilitiesMap.md` for architecture authority
- `LaunchPlan.md` for launch-critical validation
- `ExperienceSpec.md` for user-facing behavior

This file exists to answer one question:

**What should be kept, moved, deleted, and regression-tested to restore clean authority to the scaffold and reduce the shell to a thin presentation layer?**

---

## 1. Governing Rule

**`docs/index.html` is the shell surface. `docs/js/*.js` is the authoritative application. The shell may present and forward intent, but it must not own, mirror, infer, or compete with runtime state or lifecycle.**

### Translation of that rule

### Shell may keep
- layout
- routing surface
- modal presentation
- preview presentation
- responsive reading chrome
- theme/tier visual surface
- shell-only visual affordances

### Scaffold must remain authoritative for
- reading pipeline
- reading entry resolution
- importer lifecycle
- TTS lifecycle
- autoplay lifecycle
- progress/session restore
- deterministic UI behavior
- tier enforcement rules
- reading exit cleanup
- session completion state

### Shell logic must be removed or thinned if it
- duplicates runtime state
- mirrors real controls as if shell owns them
- polls runtime state to fake ownership
- infers runtime truth from DOM conditions
- implements lifecycle already owned by JS
- clears visible UI without clearing real runtime state

---

## 2. Redistribution Goal

Restore continuity in five launch-critical areas first:

1. reading entry
2. reading-position restore
3. TTS speed/control continuity
4. importer reset semantics
5. reading exit cleanup

These are the current authority breaks most likely to cause regressions, stale state, and user distrust.

---

## 3. Hard Implementation Rules

1. Do not move layout ownership out of `docs/index.html`.
2. Do not move reading/TTS/import/session authority into shell code.
3. Do not replace existing scaffold logic with new shell-side logic.
4. Do not remove shell bridge code until runtime replacement exists.
5. Do not treat DOM polling or mirror variables as authoritative state.
6. Do not mark an item complete until both code and regression pass confirm it.
7. Prefer restoring original scaffold authority over inventing new systems.
8. Do not silently change backend endpoint request/response assumptions during frontend redistribution.
9. Do not treat file:// behavior as authoritative evidence for runtime regressions when the intended app runs under a served environment.
10. Do not block current scaffold cleanup on future Supabase / Stripe / Google-login integration.

---

## 3A. Precedence Rule — When Existing Scaffold Code Wins

This redistribution pass must use an explicit conflict rule whenever shell behavior and pre-existing scaffold behavior overlap.

### Default decision
**If a behavior already exists in `docs/js/*.js` and is close to the desired outcome, the scaffold wins by default.**

The shell should only:
- call that behavior through a thin bridge
- read resulting state through runtime getters or a shell-safe read model
- render the resulting UI

### Shell only wins when all of the following are true
1. The concern is purely presentational.
2. It does not create, mutate, or infer runtime state.
3. It does not duplicate lifecycle logic already present in scaffold code.
4. It cannot regress a previously fixed runtime behavior by competing with it.

### Scaffold wins immediately when any of the following are true
- the behavior affects reading entry or reading exit
- the behavior affects TTS playback, autoplay, speed, highlighting, or countdown state
- the behavior affects importer staged state or reset semantics
- the behavior affects progress memory, session restore, or session completion state
- the behavior affects tier enforcement or mode gating
- the behavior affects source identity, book identity, or preview-to-reading resolution
- the shell is polling, mirroring, or inferring truth rather than reading it directly

### Decision hierarchy for redistribution
1. **Existing scaffold behavior** — restore, preserve, or extend first
2. **Thin shell bridge** — only to trigger or display scaffold-owned behavior
3. **New scaffold API** — only if scaffold behavior exists but is not exposed cleanly enough
4. **Shell-only implementation** — allowed only for layout/presentation with no runtime authority

### Practical negotiation rule
When choosing between shell functionality and pre-existing scaffold behavior, ask:

**"Does this change make `index.html` more authoritative than the file that already owns the system?"**

- If yes, do not put it in the shell.
- If no, and it is only presentation, shell is allowed to keep it.

### Backlog protection rule
If `backlog.md` treats a runtime behavior as fixed or built, redistribution must assume that reintroducing shell ownership in that area is a regression risk until proven otherwise.

That applies especially to:
- TTS stability/retry/highlighting/preload behavior
- reading progress persistence/restore
- audio cleanup and connectivity handling
- modal behavior that was previously stabilized in JS

**Important:** backlog status influences **risk weighting**, not ownership. It does not decide architectural authority.

---

## 3B. Integration Risk Map

The highest-risk integration areas are the places where shell behavior can quietly override or duplicate a runtime path that was already repaired.

| Risk area | Why it is risky | File authority that should win | Typical bad shell move | Required protection |
|---|---|---|---|---|
| Reading entry | Split entry paths cause wrong page/book/session start | `state.js` + `library.js` | Shell forces page 1 or directly sets selects before runtime restore resolves | Runtime-owned `startReadingFromSource(...)` and restore-first decision |
| Reading restore | Prior restore logic was already fragile/incomplete | `state.js` | Shell assumes progress from visible UI or modal state | Persisted restore payload and runtime-only restore decision |
| TTS speed | Speed can seem fixed on one path and fail on another | `tts.js` | Shell writes/patches speed only at control-change time | Re-read authoritative speed on every start/resume/advance |
| TTS playback/autoplay | Latency/countdown/playback state can desync easily | `tts.js` | Shell mirrors pause/play state or owns countdown badge logic | Runtime status getters and runtime-only countdown truth |
| Importer reset | Visible reset can diverge from staged importer state | `import.js` | Shell clears UI fields without clearing `_file` / parsed state | Single `resetImporterState()` path |
| Leaving reading cleanup | Audio or transient state can linger on other screens | `tts.js` + `audio.js` + `library.js` | Shell manually stops some systems but not all | One runtime `exitReadingSession()` path |
| Progress / session complete | DOM-based inference can drift from real page state | `library.js` + `state.js` | Shell computes completion/progress from card count or observers | Runtime signals current progress and completion |
| Tier/theme sync | Visual state can disagree with enforced access | `ui.js` | Shell claims unlock state from swatches alone | Runtime-owned access truth, shell display only |
| Boot/init timing | Shell can read state before runtime is ready | `app.js` + `ui.js` | Shell initializes controls before scaffold load/restore completes | App-ready/runtime-ready coordination |
| API contract drift | Frontend cleanup can silently break endpoint assumptions | `api/*` + `api/_lib/*` + `api/prompts/*` | Frontend changes payload shape or expected response shape casually | Preserve endpoint contracts unless deliberately versioned |
| Served-environment false negatives | file:// can misrepresent loading, CORS, or asset behavior | served app environment | Declaring runtime broken based only on local file-open behavior | Validate under HTTP-equivalent conditions |

### Risk levels for implementation

#### Red — do not let shell win
- reading entry
- session restore
- TTS playback/speed/autoplay/countdown
- importer reset semantics
- reading exit cleanup
- source identity / book identity normalization
- backend contract assumptions

#### Yellow — shell may render, but runtime must decide
- top-control sync
- progress display
- session-complete display
- tier/theme visible state
- auth-aware entry decisions
- environment-dependent validation conclusions

#### Green — shell can own safely
- centering/padding
- modal framing
- responsive chrome layout
- visual affordances
- theme swatch presentation

### Regression trigger rule
Any change that does one of the following should be treated as a regression-risk change and retested against the launch-critical path immediately:
- adds new shell state for a runtime-owned behavior
- restores a mirror variable or DOM observer as decision logic
- bypasses a runtime function and writes directly to controls or globals
- resets visible UI without resetting the owning runtime subsystem
- replaces an existing scaffold path that previously fixed a bug listed in `backlog.md`
- changes endpoint payload/response assumptions
- is only tested under `file://` and not under a served runtime

---

## 4. Boot and Execution Constraints

These are hard architectural constraints, not optional preferences.

### 4.1 Global script model
The current frontend is a shared-global, non-module system.

Redistribution must not:
- assume ES module semantics
- assume bundler-managed dependency resolution
- move code as if imports/exports already exist
- introduce hidden ordering requirements without deliberately updating the boot system

### 4.2 Protected scaffold load order
`docs/js/app.js` currently loads scaffold files sequentially in this order:

```text
state.js → tts.js → utils.js → anchors.js → import.js → library.js → evaluation.js → ui.js
```

That order is a real runtime contract.

### Hard rule
**No redistribution step may reorder, bypass, or partially duplicate `app.js` sequential loading unless `app.js` is deliberately replaced with a new authoritative boot system.**

### 4.3 Shell initialization constraint
Shell controls must not read authoritative runtime state until scaffold load and boot restoration have completed.

### Implementation implication
If shell needs authoritative state on boot:
- wait for runtime-ready / app-ready coordination
- do not infer readiness from DOM existence alone
- do not bind initial shell truth from stale default values

### Regression tests
- scaffold files still load in the intended order
- no shell control initializes against missing runtime globals
- boot restore completes before shell claims current tier/theme/progress/playback truth

---

## 5. Supporting File Ownership Beyond `index.html`

Redistribution is not only about `index.html` versus `docs/js/main runtime files`. Several supporting scaffold files already exist and should absorb logic rather than letting it drift into shell code.

### 5.1 `docs/css/components.css`
Must own:
- reusable shell component layout
- shared reading-layout structure
- responsive component behavior
- long-term shell/runtime structural styling that should not stay inline forever

Rule:
- `index.html` may temporarily host shell layout styling
- reusable structure should migrate into `components.css`

### 5.2 `docs/css/theme.css`
Must own:
- theme tokens
- theme variables
- swatch-driven presentation sets
- future theme variants that inherit the locked reading layout

Rule:
- theme architecture should land here, not remain trapped in inline shell CSS

### 5.3 `docs/js/config.js`
Must own:
- configurable runtime constants
- default thresholds
- default timing values
- audio level defaults
- page-turn sound defaults
- runtime tuning values

Rule:
- do not silently re-home configurable constants into shell scripts

### 5.4 `docs/js/utils.js`
Must own:
- shared non-UI helper behavior used by multiple scaffold files
- shared runtime helpers created during redistribution

Rule:
- do not create ad hoc shared helpers in `index.html` when they belong in runtime

### 5.5 `docs/js/anchors.js`
Must own:
- frontend anchor-generation/render/update logic
- runtime anchor state behavior
- coordination with backend anchor endpoints where applicable

Rule:
- shell must not own anchor-generation or anchor-state logic through shortcuts later

### 5.6 `docs/assets/books/embedded_books.js` and source identity handling
Source identity is a runtime concern.

Runtime must own:
- embedded vs local book normalization
- source identity truth
- book ID normalization
- preview-to-reading source resolution

This responsibility belongs primarily to:
- `library.js`
- `import.js`
- `state.js` where persisted identity is concerned

Rule:
- shell preview code may choose a candidate source, but runtime decides what that source actually resolves to

---

## 6. File-by-File Execution Map

## 6.1 `docs/index.html`

### Keep
- section structure
- modal shells
- shell navigation
- preview modal UI
- reading top/bottom chrome
- theme swatches
- tier pill display
- responsive layout CSS
- shell-only visual affordances

### Thin into bridge only
- `startReading()`
- shell pause/play button behavior
- shell autoplay button behavior
- shell speed selector behavior
- shell theme selector behavior
- section entry/exit hooks that need runtime coordination

### Remove or migrate out
- `_mirrorSelect`
- `syncShellDisplays`
- shell-owned reading state duplication
- shell-owned importer lifecycle logic
- shell-owned TTS lifecycle logic
- shell-owned countdown ownership
- shell-owned session-complete ownership
- shell-owned restore logic
- shell polling that pretends to own runtime behavior
- shell inference based on DOM state, timers, or observers where runtime should signal directly
- shell-owned shared helpers that belong in `utils.js`
- shell-owned runtime constants that belong in `config.js`

### End-state rule
`index.html` should become a thin shell that:
- renders controls
- forwards intent
- reads authoritative state from runtime
- never re-implements runtime logic

### Required bridge calls after redistribution
- `startReadingFromSource(...)`
- `pauseOrResumeReading()`
- `toggleAutoplay()`
- `setPlaybackRate(rate)`
- `exitReadingSession()`
- `resetImporterState()`
- `getRuntimeUiState()` or equivalent shell-safe read model

### Regression tests
- Start Reading button opens the correct reading session
- shell controls stay visually synchronized with runtime playback state
- shell no longer continues functioning if runtime state changes behind its back without using runtime getters
- no duplicate progress/session state appears in shell variables

---

## 6.2 `docs/js/state.js`

### Must own
- persistent user settings
- reading session state
- progress memory
- restore state
- last-read location
- session replacement rules
- authoritative persisted reading context
- persisted source/book/chapter identity

### Needs expansion/restoration
- explicit `lastReadPageIndex` ownership
- restore-on-entry logic
- session replacement when a new reading session/book begins
- complete persisted payload for reading continuity
- removal of undeclared-variable fragility in restore flow
- persisted source identity suitable for embedded/local continuity

### Must supersede
- shell progress-memory assumptions
- shell-only session state
- shell-only restore assumptions

### Implementation target
`state.js` becomes the only place that decides:
- whether a previous session exists
- whether it should be restored
- what book/source/page is restorable
- when a fresh session replaces stale persisted state

### Regression tests
- reading position persists after page advance
- refresh returns user to correct page
- switching to a new book replaces prior session correctly
- restore logic does not depend on shell path or modal state

---

## 6.3 `docs/js/library.js`

### Must own
- book loading
- chapter loading
- page-range preparation
- page rendering
- next-page / wrap rules
- preview-to-reading target path
- reading entry resolution
- active page index truth
- current page / total page progress truth
- session-complete condition signaling for reading flow
- source identity normalization at read-entry time

### Needs expansion/restoration
- authoritative Start Reading handoff target
- restore-to-last-page entry support
- clean top-control synchronization
- runtime-readable progress/status surface for shell rendering
- explicit completion signaling rather than shell inference
- authoritative embedded/local ID normalization
- preview-to-reading source resolution

### Must supersede
- shell reading-entry orchestration
- shell top-control mirroring
- shell page-load workarounds
- shell progress/session-complete ownership
- shell source-ID assumptions

### Implementation target
`library.js` should be the runtime owner of:
- what opens when the user starts reading
- what page is currently active
- what page count/progress is true
- whether the session is complete
- what source/book identity is actually in play

### Regression tests
- starting from preview opens correct book/chapter/source
- restorable session enters at last-read page rather than forced page 1
- Next advances normally
- last page wraps to top
- visible page/progress text matches runtime truth
- session-complete display is driven by runtime state
- embedded/local source identities resolve consistently across preview, reading, and restore

---

## 6.4 `docs/js/import.js`

### Must own
- importer file lifecycle
- staged upload state
- scan/select flow
- advanced parsing options
- page-break handling
- source-page-number handling if adopted
- importer modal reset semantics
- imported book identity creation

### Needs expansion/restoration
- reset staged file/state on modal close
- reset staged file/state after import completes
- one authoritative importer reset API
- optionally support `use source page numbers` default in advanced settings if adopted
- clarify imported/local source identity handoff into runtime reading path

### Must supersede
- shell-only importer reset helpers
- shell clearing that only touches visible UI but not importer-internal state

### Implementation target
Closing the importer should always mean the same thing:
- staged file cleared
- parsed state cleared
- progress state cleared
- visible UI cleared

That should happen from `import.js`, not from shell cleanup helpers.

### Regression tests
- closing modal clears staged file
- clicking outside importer clears staged file if that is the intended close path
- reopening importer shows a clean state
- import completion returns importer to a clean state next time
- no ghost file remains waiting to scan

---

## 6.5 `docs/js/tts.js`

### Must own
- playback lifecycle
- rate/voice/volume application
- latency handling
- start/resume/restart consistency
- highlight sync
- autoplay advance coupling where intended
- playback state truth
- countdown state truth

### Needs expansion/restoration
- re-read authoritative speed whenever TTS starts/resumes
- preserve the original latency-safe method
- ensure playback state remains consistent across page transitions
- expose stable control APIs for shell controls
- remove shell dependency for speed enforcement

### Must supersede
- shell speed enforcement
- shell playback-state assumptions
- shell attempts to patch TTS consistency
- shell countdown ownership
- shell pause/play inference

### Implementation target
`tts.js` should become the single source of truth for:
- whether playback is active
- what rate is applied
- whether autoplay is active
- whether countdown is active
- how controls should behave

### Required public runtime APIs
- `setPlaybackRate(rate)`
- `pauseOrResumeReading()`
- `toggleAutoplay()`
- `getPlaybackStatus()`
- `getAutoplayStatus()`
- `getCountdownStatus()`

### Regression tests
- speed persists across fresh start
- speed persists across resume
- speed persists across page transition
- pause/play state stays synchronized with top controls
- countdown is cancelable and clean
- highlighting follows audio acceptably
- latency-safe path remains intact after redistribution

---

## 6.6 `docs/js/audio.js`

### Must own
- music/background audio behavior
- mute/unmute state
- reading-owned audio cleanup
- interaction with volume controls

### Needs expansion/restoration
- explicit reading-exit cleanup hooks if not already centralized
- clarified boundary for whether reading music is session-owned or global
- stable stop/cleanup path callable from runtime exit flow

### Must supersede
- shell stopping or pausing music directly except through one runtime bridge call

### Implementation target
If audio is owned by the reading session, runtime exit cleanup must stop it.
If audio is global later, that should be a deliberate design decision, not a shell workaround.

### Regression tests
- leaving reading stops reading-owned audio
- mute/unmute state survives expected flows
- audio behavior does not linger unexpectedly on library/profile screens

---

## 6.7 `docs/js/ui.js`

### Must own
- real UI gating rules
- tier enforcement
- mode visibility rules where runtime state matters
- authoritative theme/tier state application
- runtime-aware boot state application
- shell-facing read model for current runtime state where needed

### Needs expansion/restoration
- restore visible shell surfaces from authoritative state
- auth-aware entry decisions
- app-state application after boot
- safe shell-facing getters so shell can render without inferring state

### Clarified boundary
`ui.js` should not become a second router.

It should:
- apply authoritative runtime state at boot
- initialize controls from true state
- expose current tier/theme/mode access truth

It should not:
- take over shell layout/routing ownership from `index.html`

### Must supersede
- shell assumptions about tier unlock state
- shell-only routing decisions that mutate runtime state implicitly
- shell claiming access that runtime has not enforced

### Regression tests
- current tier/theme visuals match real runtime state after load
- gating behavior matches visible UI
- app boot restores authoritative state before shell surfaces it
- logged-in entry decisions do not desynchronize visible shell from runtime truth

---

## 6.8 `docs/js/evaluation.js`

### Must own
- evaluation flow only
- progression rules that belong to evaluation/comprehension mode
- submit/evaluate transitions

### Keep out of shell
- no evaluation state in reading shell
- no evaluation leakage into reading mode
- no shell-side evaluation ownership

### Regression tests
- reading mode stays clean and does not surface evaluation controls unintentionally
- evaluation flow still works after reading redistribution

---

## 6.9 `docs/js/app.js`

### Keep
- ordered loading of scaffold files
- authoritative global boot sequencing

### Likely expansion
- boot-time restore orchestration
- authenticated entry routing handoff
- app-ready hook for shell initialization
- runtime-ready coordination before shell reads authoritative state

### Clarified boundary
`app.js` may become the boot coordinator, but should not become the owner of reading, TTS, importer, or tier business logic.

### Regression tests
- runtime files still load in correct order
- boot does not race shell initialization
- restore/init logic runs only after required runtime files are available

---

## 7. Backend / Platform Compatibility Map

## `api/`
### Keep authoritative
- anchors
- evaluation
- summary
- import conversion
- cloud TTS
- prompt contracts
- shared helpers in `api/_lib/`

### Compatibility protection rule
Redistribution must not silently change:
- request payload assumptions
- response shape assumptions
- endpoint routing assumptions
- prompt/helper expectations used by backend endpoints

### Implementation implication
If frontend behavior changes how TTS/import/evaluation/anchors are triggered:
- preserve current API contract compatibility, or
- make the change explicitly and document the contract update deliberately

No frontend shell logic should compete with backend ownership for these features.

---

## 8. Runtime Risk Inputs and Validation Environment

### 8.1 `docs/js/architecturalRisk.txt`
Treat `docs/js/architecturalRisk.txt` as an active risk input.

Use it:
- before each migration phase
- after each migration phase
- when deciding whether a “temporary shell shortcut” is actually safe

### 8.2 Validation environment rule
Redistribution and regression must be tested under the intended served environment, not only under `file://`.

This especially matters for:
- `index.json` or local asset loading behavior
- CORS-dependent behavior
- embedded/local book loading
- preview-to-reading handoff
- importer and library behavior that assumes HTTP-equivalent serving

### Regression implication
A behavior is not safely validated if it was only checked under:
- direct file-open conditions
- partially loaded shell conditions
- environments that do not match expected hosting/runtime assumptions

---

## 9. Current vs Future External Service Authority

These services are valid ownership targets, but most are future-state relative to the current scaffold cleanup pass.

### 9.1 Current authority
Current redistribution work should focus on:
- shell/scaffold ownership cleanup
- runtime continuity restoration
- launch-critical regression avoidance

### 9.2 Future service authority targets

#### Supabase should eventually own
- auth
- user settings
- reading progress records
- tier/user state records

#### Stripe should eventually own
- payment state
- entitlement source of truth

#### Google login should eventually own
- identity entry path only

### Rule
External services should supply identity, persistence, and entitlement truth.

They should **not**:
- create a second frontend state model
- block current scaffold redistribution
- become excuses to leave shell/runtime authority unresolved first

---

## 10. Concrete Migration Buckets

## A. Keep in shell as-is
- reading layout structure
- modal shells
- profile/library visual containers
- theme swatches
- tier pill
- responsive control-bar CSS
- preview modal presentation

## B. Keep in shell but thin into bridge
- Start Reading button
- shell pause/play button
- shell autoplay button
- shell speed selector
- shell theme selector
- section entry/exit UI hooks

## C. Move back into scaffold
- reading restore
- reading progress memory
- TTS speed consistency
- TTS latency behavior
- importer reset semantics
- autoplay countdown ownership
- session-complete conditions
- audio cleanup on reading exit
- top-control authoritative sync
- embedded/local source normalization
- runtime boot/readiness coordination

## D. Remove entirely
- mirror-control layer
- duplicate shell state for reading session
- duplicate shell state for importer lifecycle
- shell polling that pretends to own runtime behavior
- any shell fallback that competes with real JS ownership
- shell-owned shared helpers that belong in scaffold utility files
- shell-owned constants that belong in `config.js`

---

## 11. Priority Order

## Phase 1 — authority cleanup
- protect boot order and runtime-ready sequencing
- remove mirror layer
- restore JS ownership of reading entry
- restore JS ownership of importer lifecycle
- restore JS ownership of TTS consistency
- restore JS ownership of progress restore
- preserve API compatibility while redirecting shell bridges

## Phase 2 — shell stabilization
- keep responsive shell
- keep preview shell
- keep theme/tier shell
- move reusable style rules toward `docs/css/`
- ensure shell reads from authoritative state only

## Phase 3 — persistence / services
- Supabase user state
- progress save/restore
- Google login
- Stripe entitlements

## Phase 4 — themes architecture
- lock reading layout
- move theme behavior to CSS/token architecture
- keep runtime behavior separate from theme presentation

---

## 12. Definition of Done for Redistribution

Redistribution is complete when all of the following are true:

1. `index.html` no longer owns real reading/import/TTS lifecycle logic.
2. Shell controls forward intent only.
3. Runtime files own actual playback, restore, importer, and cleanup truth.
4. Progress/session-complete is runtime-signaled, not shell-inferred.
5. Importer close/reset is runtime-owned end-to-end.
6. Leaving reading goes through one runtime-owned cleanup path.
7. TTS speed remains correct across start, resume, and page transitions.
8. Visible tier/theme state reflects runtime authority after load.
9. Boot order and runtime-ready coordination remain intact.
10. Endpoint contract assumptions remain compatible unless deliberately changed.
11. Regression confirms the launch-critical reading promise still holds under served-environment conditions.

---

## 13. Immediate Next Step

Use this document as the implementation checklist for the redistribution pass.

Recommended execution order in code:
1. protect boot/load assumptions first
2. add runtime APIs first
3. redirect shell to those APIs
4. remove duplicated shell logic
5. run regression on launch-critical flows in the served environment
6. cross-check with `architecturalRisk.txt`
7. update `backlog.md` only after implementation/testing
