# Integration Handoff — Reading Trainer

## Document Source Map
This integration plan draws directly from the project’s governing documents:

### **Referenced Source Documents**
- **SystemResponsibilitiesMap.md (SRM)** – Defines architecture boundaries and the separation of concerns between Shell and Engine.
- **ExperienceSpec.md** – Defines correct user-facing behavior, flow, and required features.
- **backlog.md** – Defines priority tasks, required cleanup, and features needed for production.

### **Mapping of Responsibilities → Integration Requirements**
| Source Document | Responsibility | Integration Requirement |
|-----------------|----------------|--------------------------|
| SystemResponsibilitiesMap.md | Shell = UI Frame | jubly-shell.html must fully replace index.html as the Shell layer. |
| SystemResponsibilitiesMap.md | Engine = Reading Runtime | Engine JS must remain unchanged; shell adapts to engine DOM contract. |
| ExperienceSpec.md | Behavior & UX correctness | Shell’s interface must call engine functions without altering them. |
| ExperienceSpec.md | Guidance, mode behavior, feedback loop | Shell must preserve correct flow (Import → Read → Evaluate → Next). |
| backlog.md | Cleanup required | Remove dev knobs, dead UI, simplify DOM without touching engine logic. |
| backlog.md | Ready-to-ship feature set | Implement cold-start UX, sound controls, PWA shell, diagnostics overlay. |

---

## Explicit Architectural Directive
Per **SystemResponsibilitiesMap.md**, the Shell is responsible for framing, theming, onboarding, and layout. The Engine is responsible for reading logic, evaluation, TTS, anchors, persistence, and runtime behaviors.

### **Therefore:**
➡️ `jubly-shell.html` **must fully replace** the lean `index.html` and assume the Shell responsibilities.

➡️ All reading logic remains in the **existing engine files**, which must not be moved or rewritten.

➡️ Only Shell markup, CSS, and bridge-layer JS may be adjusted.

---

## Cleanup Philosophy (No-Refactor Rules)
To ensure safe integration and respect project architecture, the following rules apply:

### **1. Do NOT refactor engine logic**
- No moving logic between files
- No renaming core functions
- No switching to modules
- No restructuring state storage

### **2. Cleanup must be purely additive or subtractive (never transformative)**
Allowed:
- Remove dead or dev-only UI
- Remove unused variables
- Patch silent errors
- Normalize globals (window.*)

Not allowed:
- Changing function signatures
- Changing internal data structures
- Altering event timing or flow

### **3. Shell must adapt to the Engine, not vice versa**
- Engine IDs must remain identical
- Required DOM structure must be satisfied
- Shell must wrap engine sections

### **4. Shell UI must map to engine behavior through a clean “bridge layer”**
- No duplicating engine logic
- No overriding engine internals
- No alternative TTS or navigation logic

### **5. Reduce complexity (never increase it)**
- Keep integration passive and protective
- Avoid mixing Shell + Engine concerns
- Strictly separate appearance vs behavior layers

---

**Status:** Ready for engineering implementation  
**Purpose:** Provide a comprehensive guide for merging the premium UI shell (`jubly-shell.html`) with the stable reading engine (`reading-comprehension.zip`) without regressions, rewrites, or behavioral drift.

This is the engineering handoff document that explains:
- What must happen
- Why it matters
- How to perform the merge safely
- What DOM structures are required
- How the shell must wire to the engine
- What cleanup is required (and what should NOT be changed)
- How to test
- What must be complete for launch

The goal is a stable, production-ready, premium-feeling Reading Trainer.

---

# 1. Project Reality & Mindset

The two main components of the product are:

### **1. The Stable Reading Engine (from reading-comprehension.zip)**
A fully functional, validated reading/comprehension engine including:
- Page renderer
- Evaluation system
- TTS (browser + cloud)
- Anchor logic
- Timers + UI logic
- Navigation logic
- State + session persistence

The engine is **feature-complete**, **battle-tested**, and **not to be rewritten**.

### **2. The Premium Shell (jubly-shell.html)**
A high-quality UX layer that includes:
- Landing experience
- Layout + theming
- Modals
- Navigation chrome
- Volume panel
- Onboarding
- Structural presentation

The shell is **not the engine** — it is the “frame” or “host” around the engine.

### **Your mission:**
Integrate these without breaking the engine.

### **Correct engineering mindset:**
- **Preserve the engine** — its logic must not be moved, rewritten, or restructured.
- **Adapt the shell** — the shell must host the engine, not re-implement it.
- **Bridge interactions** — shell UI elements call engine functions.
- **Honor DOM contracts** — all IDs/classes expected by the engine must exist.
- **Minimal cleanup** — only enough to safely embed the engine.

---

# 2. Technical Overview

The stable app consists of seven JS files loaded in strict order:

```
state.js → tts.js → utils.js → anchors.js → import.js → library.js → evaluation.js → ui.js
```

They share a single global scope and assume the presence of specific DOM elements.

These **assumed DOM elements** form a *DOM contract* — breaking it will break the app. The shell must therefore recreate these IDs *exactly*, though visual presentation may change.

---

# 3. DOM Contract (Required IDs & Structures)

The following DOM nodes **must** exist in the final integrated shell. They may be visually restyled, wrapped, or repositioned — but their IDs must remain intact.

## **3.1 Core Containers**
- `#pages` — engine injects all page cards here
- `#reading-mode` — mode container (engine references during mode switches)
- `#importBookModal` — import dialog root
- `#libraryModal` — library selector root
- `#modeSelector` — dropdown for Reading/Comprehension modes

## **3.2 Per-Page Structures (injected by engine)**
These do not need to appear in the shell (engine builds them), but shell CSS must not break them:
- `.page`
- `.page-header`
- `.page-text`
- `.anchors-row`
- `.page-actions` (contains TTS button)
- `.anchors-nav` (Next button)
- `.sand-wrapper`
- `.info-row`
- `.ai-feedback`

## **3.3 Buttons / Controls**
Engine will attach listeners to:
- `#submitBtn`
- `#readBtn-page-X` (generated per page)
- `#hintBtn-page-X` (generated)
- `#nextBtn-page-X` (generated)

Shell must provide:
- `#importBtn`
- `#loadPagesBtn`
- `#addPagesBtn`

## **3.4 Shell → Engine Bridge Points**
Shell UI elements that will call engine functions:
- `#shellStartReading`
- `#shellNextPage`
- `#shellTtsToggle`
- `#shellModeSelect`
- `#shellImportTrigger`
- `#shellVolumeControl`

These IDs are arbitrary, but they must exist if used by the bridging layer.

---

# 4. Merge Strategy (High-Level)

This integration is not a rewrite; it is a surgical replacement of the UI wrapper.

The shell must:
1. Provide the DOM contract.
2. Wrap engine-required IDs in the new layout.
3. Remove duplicated UI markup.
4. Host the engine’s render output.
5. Bridge shell controls to engine functions.
6. Preserve behavior defined in ExperienceSpec.

The engine must remain unchanged except for minimal cleanup.

---

# 5. Merge Plan (Step-by-Step)

## **STEP 1 — Extract and Inspect the Engine**

Understand the assumptions the JS makes:
- IDs it queries
- Containers it injects into
- Events it binds
- What is built dynamically
- What DOM must pre-exist

Document these assumptions (see DOM Contract above).

## **STEP 2 — Identify MERGE Points in the Shell**
Search for comments in `jubly-shell.html` of the form:
```
MERGE: …
```
These mark the intended integration hooks.

Common ones:
- MERGE: reading-host
- MERGE: modals
- MERGE: controls

Insert engine DOM roots at these points.

## **STEP 3 — Remove Duplicated Engine UI From Shell**

The shell currently includes markup approximating the engine’s reading UI. Delete it.

Keep only:
- Layout
- Theming
- Structural elements
- Landing screen
- Modals
- Panels

Never duplicate engine UI logic.

## **STEP 4 — Insert Engine DOM Roots**

Add the following to the shell:

```html
<div id="reading-mode">
  <div id="pages"></div>
</div>
<div id="importBookModal"></div>
<div id="libraryModal"></div>
<select id="modeSelector"></select>
```

Engine will populate these.

## **STEP 5 — Bridge Shell UI Events to Engine Functions**

Create a bridge JS file loaded after the engine:

```js
// Example bridges
shellStartReadingBtn.onclick = () => window.render();
shellNextPageBtn.onclick = () => window.goToNext(window.lastFocusedPageIndex);
shellModeSelect.onchange = e => {
  window.appMode = e.target.value;
  window.applyModeVisibility();
};
shellTtsToggle.onclick = () => window.ttsStop(); // or custom toggle logic
```

This is the layer that connects shell UI → engine logic.

## **STEP 6 — Minimal Cleanup in Engine**

Only do what is required for safety:
- Remove dev/test controls
- Ensure globals are exported on `window.*`
- Ensure no references to removed UI remain
- Confirm session restore works in isolation

Do **not** refactor logic.

## **STEP 7 — Fix Integration Breakages**

Common issues:
- Scroll offset due to new shell header
- TTS highlight spans conflicting with shell CSS
- Fixed-position shell elements blocking engine events
- Z-index issues between modals
- Theme variables missing

Fix with:
- CSS resets
- Extra spacing
- Pointer-event forwarding

## **STEP 8 — Add Launch-Ready Features**

Prioritized, must-have:
- Cold-start guidance
- Shell sound controls → engine audio
- Pickup-where-you-left-off (session restore)
- Diagnostics overlay (debug only)
- PWA manifest + service worker

---

# 6. Shell → Engine Bridging Table

| Shell Element | Engine Function | Notes |
|---------------|-----------------|-------|
| Start Reading | `render()` | Initializes reading session |
| Mode Selector | `applyModeVisibility()` | Syncs UI with mode |
| Next Page | `goToNext()` | Uses engine’s navigation logic |
| TTS Button | `ttsSpeakQueue()` / `ttsStop()` | Depending on state |
| Import Button | Opens `#importBookModal` | Engine handles parsing |
| Volume Panel | `audioEngine.setVolume()` | Engine manages SFX/TTS |
| Theme Toggle | Shell-only | Engine unaffected |

All shell controls must route to engine logic, not reimplement it.

---

# 7. Testing Workflow

After integration, test in the following order:

## **1. Engine Boot**
- Does the app render pages?
- Are modals functional?
- Does mode select work?

## **2. TTS**
- Browser TTS (Free tier) works
- Cloud TTS (Paid tier) works
- Autoplay countdown works
- Safari gesture compliance preserved

## **3. Navigation**
- Next page works in all modes
- Consolidation box focusing behaves properly
- Evaluation phase transitions

## **4. Anchors**
- Anchors generate
- Anchors pulse
- Anchor matching updates during typing

## **5. Session Restore**
- lastReadPageIndex restored
- scroll position correct
- consolidation + ratings persist

## **6. Shell Integration**
- No overlapping z-index artifacts
- Modals do not block engine UI
- Layout does not break engine dynamics

---

# 8. Launch Checklist

A production-ready system must meet:

### **Engine Functionality**
- Reading loop fully functional
- Consolidation UI correct
- TTS stable and tested across browsers
- Anchor system functional
- AI evaluation correct

### **Shell Integration**
- All bridges wired
- All DOM IDs satisfied
- Shell aesthetics applied cleanly
- No duplicated UI

### **User Experience**
- Clear landing → reading flow
- Cold-start explained
- Theme + branding consistent
- Sound controls intuitive

### **Platform**
- PWA manifest
- Service worker
- Offline support for static assets
- Diagnostics overlay available (debug only)

---

# 9. Summary

The Reading Trainer is in its integration phase. The reading engine is stable and should not be rewritten. The shell provides a premium user-facing experience and must be adapted to host the engine.

The core engineering responsibilities are:
- Provide the engine’s DOM contract
- Insert engine-required roots
- Remove duplicated UI
- Create a bridging layer (shell UI → engine functions)
- Maintain behavioral correctness
- Fix integration breakages
- Add final launch features

Following this document will lead to a production-ready merged application with a stable core and premium user interface.

---

# End of Document

