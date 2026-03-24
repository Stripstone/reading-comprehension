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

- **TTS book-switch bug**
  - Repro: Play TTS on Page 1 → switch book → play Page 1 again
  - Result: Plays previous book’s Page 1
  - Risk: Breaks core trust and correctness

- **TTS mid-page pause (intermittent)**
  - Audio pauses during playback
  - Risk: Core function unreliable

- **Music stops under low connectivity**
  - Fails to loop, cannot recover without reload
  - Risk: System appears broken

- **TTS highlight desync**
  - Highlighting lags or freezes while audio continues
  - Risk: Breaks comprehension loop

- **Clicks passing through modals**
  - UI interaction occurs behind modal
  - Risk: UI integrity broken

---

### 🟡 High (Pre-Validation)

- **TTS playback instability under weak connection**
  - Voice becomes inconsistent or stops
  - Likely buffering / streaming issue

---

### 🟢 Normal
*(none)*

---

## 2. Pre-Launch Features

### 🔴 Critical (Blocking)

- **Reading progress persistence (continuous)**
  - Persist `lastReadPageIndex` on page load / navigation
  - Required for core “resume reading” experience

- **TTS preloading for next page**
  - Reduce latency between pages
  - Investigate relation to mid-page pauses

---

### 🟡 High (Pre-Validation)

- **Cold-start guidance**
  - Add “Start here” flow
  - Reduce initial cognitive load (mode/source/tier)

---

### 🟢 Normal
*(none)*

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

- **Audio instability under weak/spotty connection**
  - Music stops looping
  - TTS becomes inconsistent
  - Highlighting desynchronizes
  - Risk: System fails under realistic network conditions

---

### 🟡 High (Pre-Validation)

- **TTS dependency on live connection**
  - Playback degrades after initial load
  - Needs stronger caching strategy

- **Device sleep interaction**
  - Device-level sleep interrupts playback/session
  - Requires mitigation or guidance

---

### 🟢 Normal
*(none)*

---

## 5. Planned Mitigations

- **TTS caching improvements**
  - Ensure full-page audio is available before playback
  - Reduce reliance on active connection

- **Audio recovery handling**
  - Detect failure and allow restart without reload

- **Highlight synchronization robustness**
  - Reduce dependence on fragile timing events

---

## 6. Notes

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