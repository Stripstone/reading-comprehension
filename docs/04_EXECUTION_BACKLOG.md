# Reading Trainer — Execution Backlog

This is the current working backlog.

Each item should answer:
- what the user expects
- what can go wrong
- who owns the fix
- what “done” means

## Status
- Open
- In Progress
- Built
- Validated
- Deferred

## Risk
- 🔴 Critical
- 🟡 High
- 🟢 Normal

## 1. Restore returns the user to the correct page
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** `docs/js/state.js` with `docs/js/library.js`

### User expectation
When the user leaves and comes back, they return to the right page.

### Edge cases
- refresh
- leave reading then return later
- open a different book after a prior session existed
- restore path should not depend on one special UI entry route

### Done when
- reading position persists after page advance
- returning lands on the correct page
- starting a new source replaces stale restore truth cleanly

---

## 2. TTS starts on the current active page
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** `docs/js/library.js` + `docs/js/tts.js`

### User expectation
If the user presses `Read page` or `Play`, the app reads the page they are actually on.

### Edge cases
- restored session
- changed active page before pressing play
- page-card read versus bottom-bar play

### Done when
- page-card read and bottom-bar play target the same runtime page truth
- restored session play starts on the restored page

---

## 3. Pause and resume feel real during active TTS
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** `docs/js/tts.js`

### User expectation
When the user presses Pause, reading pauses. When they press Play or Resume, reading resumes in a defined way.

### Edge cases
- mid-sentence pause
- immediate resume
- browser path versus cloud/audio path
- top, bottom, and page-level controls staying in sync

### Done when
- pause changes runtime state intentionally
- resume uses one defined runtime path
- controls do not claim success if runtime state did not change

---

## 4. Speed changes behave live and consistently
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** `docs/js/tts.js`

### User expectation
Changing speed during active TTS should affect the current speech immediately when the active path supports it.

### Edge cases
- mid-sentence speed change
- pause/resume after a speed change
- page transition after a speed change
- paths that cannot mutate speed truly live

### Done when
- speed is correct on fresh start
- speed is correct after pause/resume
- speed is correct after next-page transition
- changing speed during active TTS updates current speech immediately when supported
- if a path cannot do that, runtime uses one defined fallback consistently

---

## 5. Leaving reading runs one cleanup path
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** `docs/js/tts.js` + `docs/js/audio.js` + `docs/js/library.js`

### User expectation
Leaving reading stops reading-owned audio and clears reading-only transient state.

### Edge cases
- exit during countdown
- exit while TTS is active
- exit after pause
- leave via different supported navigation paths

### Done when
- one runtime-owned exit path handles cleanup
- no lingering reading-owned audio or countdown remains active outside reading

---

## 6. Library startup state must not mislead the user
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** `docs/js/library.js`

### User expectation
The app should not briefly imply there are no books before it checks.

### Edge cases
- saved books on slow load
- first-time empty library
- repeated entry into library

### Done when
- saved-books users see loading to populated, or immediate populated
- empty users see loading to true empty state
- no false empty/import flash appears first

---

## 7. Footer sits at the bottom of the page and never covers content
**Risk:** 🟡 High  
**Status:** Open  
**Owner:** shell structural CSS

### User expectation
The footer belongs at the bottom of the page.

### Edge cases
- short content on a tall viewport
- long content requiring scroll
- narrow library/profile screens

### Done when
- short pages place footer at the bottom of the viewport
- long pages place footer below the content
- footer never overlays library/profile containers

---

## 8. Importer close/dismiss clears staged state completely
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** `docs/js/import.js`

### User expectation
Closing importer means the staged file is gone.

### Edge cases
- close button
- click-away dismiss if supported
- close after scan
- reopen after prior staging

### Done when
- closing importer clears staged file and parsed state
- reopening importer shows a clean state
- no ghost file remains waiting to scan

---

## 9. Shell stops deciding runtime truth in critical areas
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** shell/runtime redistribution pass

### User expectation
Controls should reflect what the app is actually doing, not what the shell guessed.

### Edge cases
- restore
- playback
- importer state
- countdown state
- runtime changes happening behind shell UI

### Done when
- shell no longer decides restore, playback, importer, or countdown truth
- runtime APIs are the only decision paths for launch-critical state
- UI stays synchronized by reading runtime state, not inferring it
- no shell bridge is removed until the runtime replacement exists and is tested

---

## 10. Switching book or chapter must replace page state cleanly
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** `docs/js/library.js` + `docs/js/state.js`

### User expectation
Changing book or chapter should show only the pages for that selected source.

### Edge cases
- restored session then switching book
- restored session then switching chapter
- leaving reading and returning before changing chapter
- preview entry versus in-reading chapter change

### Done when
- changing book or chapter never reuses stale page content
- page order stays correct after source/chapter changes
- session restore is replaced or cleared when the selected source no longer matches
- no chapter can inherit pages from a previously loaded chapter

---

## 10. TTS reliability under weak connection
**Risk:** 🟡 High  
**Status:** Open  
**Owner:** `docs/js/tts.js`

### User expectation
Weak connectivity should degrade gracefully, not feel random.

### Done when
- stall recovery is defined and bounded
- buffering does not create false-start behavior as easily
- diagnostics explain retry and route decisions

---

## 11. Background music and reading audio resilience
**Risk:** 🟡 High  
**Status:** Open  
**Owner:** `docs/js/audio.js`

### User expectation
Reading-owned audio should recover intentionally where designed, and stop intentionally on exit.

### Done when
- reading exit cleanup still works
- recovery behavior is explicit rather than accidental

---

## Validation rule
Do not mark a critical item Validated until it passes in the served app.
