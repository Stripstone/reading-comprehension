# Reading Trainer — Theme Architecture Map

This document defines the **target** folder, file, and ownership structure needed to support theme functionality **after runtime authority cleanup restores file continuity in the scaffold**.

It is downstream of:
- `SystemResponsibilitiesMap.md`
- `RedistributionExecutionMap.md`
- `ExperienceSpec.md`
- `LaunchPlan.md`
- `SupabaseSchemaMap.md`

Its purpose is to answer one question:

**How should theme functionality be structured so that themes improve the reading experience, preserve scaffold continuity, and do not create a second architecture?**

---

## 1. Governing Rule

**Themes are a thin presentation layer over one locked reading layout, not alternate reading layouts and not a parallel shell system.**

That means:
- the reading structure stays locked
- themes inherit the structure
- shell surfaces theme controls
- runtime owns real theme state, tier gating, persistence, and behavior-linked settings
- decorative features must not reintroduce shell/runtime ownership drift
- theme work must not expand `index.html` into a second authority layer

---

## 2. Position in the Documentation Hierarchy

This document is **not** a co-equal architecture source with the System Responsibilities Map, and it is **not** allowed to override the redistribution sequence.

### Authority order
1. `SystemResponsibilitiesMap.md` — architecture and ownership boundaries
2. `RedistributionExecutionMap.md` — implementation sequence and anti-drift rules
3. `ExperienceSpec.md` — user-facing expectations
4. `LaunchPlan.md` — launch gating and validation
5. `SupabaseSchemaMap.md` — cloud persistence support for runtime-owned truths
6. `ThemeArchitectureMap.md` — theme-specific target structure within those rules

### Consequence
If this document conflicts with:
- runtime ownership rules,
- redistribution sequencing,
- or thin-shell convergence,

then this document must yield.

---

## 3. Redistribution First, Theme Architecture Second

Theme work is **not** a first-step architecture track.

Before theme architecture expands, the redistribution pass must first restore runtime authority in the launch-critical continuity areas:

- reading entry
- reading-position restore
- TTS speed/control continuity
- importer reset semantics
- reading exit cleanup

### Why this matters
Those areas determine whether the scaffold is actually authoritative.

If theme work begins before those authority repairs are made, theme code can accidentally:
- recreate shell-owned state,
- duplicate runtime settings logic,
- or make `index.html` more powerful instead of thinner.

### Rule
Theme implementation should support the redistribution target:
- a thinner shell
- clearer file boundaries
- restored continuity across scaffold files
- less inline shell ownership over time

---

## 4. Product Intent

The theme system should make Reading Trainer feel like **one reading app with selectable reading environments**.

It should not feel like:
- multiple mini-apps
- separate layouts per theme
- a shell-driven customization lab
- theme logic competing with runtime truth
- a new reason to keep behavior inside `index.html`

### Product-aligned interpretation

At launch or near-launch, theme functionality should support two layers of value:

### Basic
Comfort controls.

Examples:
- color palette
- font choice
- page-turn sound choice

### Pro
Atmosphere controls.

Examples:
- richer theme presets
- wallpaper
- particles
- ambient music

This keeps theme functionality aligned with the product promise:
- get into a document quickly
- read comfortably
- stay with the text
- add atmosphere only when it improves immersion rather than distraction

---

## 5. Thin-Shell Destination

The target shell should remain **minimal, structural, and presentational**.

Theme planning must support ending up with an `index.html` that:
- links shared CSS authorities
- hosts shell surfaces
- loads scaffold JS
- presents controls
- forwards user intent
- does not become the real owner of theme state or theme behavior

### Practical translation
The goal is **not** “build a richer shell theme system.”

The goal is:
- keep shell markup simple
- let scaffold/runtime own state and logic
- let CSS own structure and appearance
- let theme-linked media live in dedicated assets
- reduce inline shell behavior over time

### Continuity test
Every theme decision should pass this question:

**Does this make continuity easier to restore across `components.css`, `theme.css`, `state.js`, `ui.js`, `audio.js`, `embers.js`, and related scaffold files?**

If not, it is the wrong kind of theme work for this phase.

---

## 6. Core Architecture Rule

Theme functionality must respect the shell/runtime split.

### Shell owns
- theme swatch presentation
- theme settings entry points
- settings panel/modal framing
- reading chrome placement for controls
- profile page visual selection surface

### Runtime owns
- selected theme ID
- selected font ID
- selected page-turn sound ID
- particle enabled/settings state
- ambient music enabled/settings state
- tier gating for theme capabilities
- persisted user theme/environment preferences
- applying authoritative current state to shell surfaces

### CSS owns
- reading layout structure
- responsive structure
- theme tokens
- decorative presentation

### Important rule
Shell may surface controls, but shell must not:
- own theme truth
- infer theme truth
- mirror theme truth
- store theme-only state that competes with runtime
- implement per-theme behavior logic in `index.html`

---

## 7. Current Scaffold Reality

The scaffold already contains the **landing zones** for clean theme architecture, but theme authority is not yet fully redistributed there.

### Existing continuity-supporting destinations
- `docs/css/components.css`
- `docs/css/theme.css`
- `docs/js/config.js`
- `docs/js/ui.js`
- `docs/js/audio.js`
- `docs/js/embers.js`
- `docs/js/state.js`

### Current interpretation
This means the scaffold supports a clean theme architecture **as a target**, but not all live theme behavior should be assumed to already live in the correct place.

### Consequence
This document should be read as:
- a continuity-supporting target map
- not proof that theme redistribution is already complete

---

## 8. CSS Authority Split

## 8.1 `docs/css/components.css`

This file is the **structure authority**.

It must own:
- shared reading layout structure
- top controls layout
- bottom controls layout
- page/card layout
- modal/panel structure
- reading settings panel structure
- responsive behavior
- clipping fixes
- library/profile structural layout rules that should remain reusable

### Rule
`components.css` defines **how the reading screen is built**.

No theme should redefine these structural rules.

### Continuity purpose
This helps restore file continuity by moving reusable structure toward scaffold-owned CSS instead of leaving it trapped in shell-specific styling.

---

## 8.2 `docs/css/theme.css`

This file is the **theme presentation authority**.

It must own:
- root theme tokens
- color systems
- font pairing tokens
- border/shadow/surface tokens
- wallpaper hooks
- decorative theme selectors
- background and texture treatment
- particle palette hooks

### Rule
`theme.css` defines **how the reading screen looks**, not how it is structured.

### Recommended selector model

```css
:root { /* defaults */ }
[data-theme="paper"] { /* basic theme */ }
[data-theme="sepia"] { /* basic theme */ }
[data-theme="night"] { /* basic theme */ }
[data-theme="pro-scholar"] { /* pro theme */ }
[data-theme="pro-rain-study"] { /* pro theme */ }
```

### Preferred interpretation
A theme preset should mean:
- a theme ID,
- a token set in `theme.css`,
- and optionally an asset/runtime mapping.

It should **not** mean:
- a separate structural CSS rewrite,
- a per-theme layout system,
- or shell-owned theme logic.

### Continuity purpose
This keeps theme behavior compatible with the redistribution goal of restoring clean file authority rather than scattering visual logic back into `index.html`.

---

## 9. Theme Asset Structure

Theme-linked media should have a dedicated destination branch so atmosphere assets do not get scattered across unrelated folders.

### Recommended future structure

```text
docs/
  assets/
    themes/
      wallpapers/
      sounds/
      music/
```

### Important clarification
This is a **target structure**, not a claim that the current scaffold already uses this exact asset organization everywhere.

### Why this matters
It separates:
- general app assets
from
- theme-linked media

And it supports cleaner long-term continuity in:
- audio behavior
- theme preset mapping
- asset discoverability
- future maintenance

---

## 10. JS Ownership for Theme Functionality

Theme functionality is not CSS-only.

Some theme selections affect runtime behavior and must remain scaffold-owned.

## 10.1 `docs/js/state.js`

Must own persisted theme/environment preferences such as:
- selected theme ID
- selected font ID
- selected page-turn sound ID
- particle enabled/settings values
- ambient music enabled/settings values
- future reading-comfort settings if adopted

### Rule
Theme preference truth belongs in runtime state, not shell variables.

---

## 10.2 `docs/js/ui.js`

Must own:
- applying authoritative theme/tier state to visible UI
- deciding which options are enabled/disabled by tier
- initializing shell surfaces from authoritative state
- exposing shell-safe read models for theme state where needed

### Rule
The shell may show swatches and controls, but `ui.js` should remain the authority for what is active and what is truly available.

---

## 10.3 `docs/js/audio.js`

Must own:
- page-turn sound playback
- ambient music playback
- mute behavior
- cleanup for theme-linked audio when reading exits if that audio is reading-owned

### Rule
Theme-linked sound behavior must not be stored or controlled as shell-only state.

---

## 10.4 `docs/js/embers.js`

Must own:
- particle implementation
- interpretation of particle presets/settings
- decorative particle behavior triggered by runtime state

### Rule
Particles may be theme-triggered, but their implementation remains local to `embers.js`, not shell scripts.

---

## 10.5 `docs/js/config.js`

Must own:
- default theme IDs
- default font IDs
- available page-turn sound IDs
- lightweight capability metadata
- default atmosphere toggles if needed

### Rule
Do not silently move configurable theme defaults into `index.html`.

---

## 10.6 Optional future file: `docs/js/themes.js`

This file is **optional**, not required now.

Create it only if theme metadata becomes too large for `config.js`.

### If added, it should own:
- theme preset registry
- Basic vs Pro grouping
- metadata mapping
- wallpaper/particle/music preset associations

### It should not own:
- layout logic
- routing logic
- direct shell DOM ownership
- duplicated tier enforcement
- behavior already owned by `audio.js`, `embers.js`, `ui.js`, or `state.js`

### Recommendation
For continuity-safe work:
- start with `config.js` + `theme.css`
- add `themes.js` only if the metadata truly becomes too large or messy

---

## 11. Basic vs Pro Capability Model

## 11.1 Basic

Basic should remain simple and comfort-focused.

### Recommended Basic capabilities
- color theme / swatch selection
- font choice
- page-turn sound choice

### Product meaning
Basic helps the user make reading more comfortable.

It should not become a large customization surface.

---

## 11.2 Pro

Pro should add atmosphere, not a second layout system.

### Recommended Pro capabilities
- richer theme presets
- wallpaper
- particles
- ambient music

### Product meaning
Pro adds immersion while preserving the same reading structure.

### Important rule
Even Pro themes must not redefine layout ownership.

---

## 12. Reading Settings Surface

Theme controls should not be scattered randomly.

### Recommended end-state surface
A single **Reading Settings** entry point in reading controls may expose:
- Theme
- Font
- Page-turn sound
- Sound & Voice
- Pro-only atmosphere options if unlocked

### Important ownership clarification
Sound & Voice may live in the same settings surface, but it is **not** theme-owned logic.

It remains runtime-backed behavior owned by the relevant scaffold files:
- `tts.js`
- `audio.js`
- `ui.js`
- `state.js`

### Shell role
The shell owns:
- where the settings button appears
- modal/sheet framing
- visual presentation

### Runtime role
The scaffold owns:
- selected values
- unlocked capability state
- persistent preference state
- behavior linked to those settings

---

## 13. Anti-Patterns to Avoid

Do not introduce any of the following:

### Avoid
- theme-specific layout rewrites
- per-theme control placement changes
- shell-owned theme state that competes with runtime state
- shell-owned atmosphere state
- per-theme JS behavior in `index.html`
- separate theme files that quietly redefine card/control structure
- audio/particle behavior stored only in shell variables
- theme work that makes `index.html` larger and more authoritative
- theme implementation that bypasses scaffold ownership to “move faster”

### Why
These patterns would recreate the exact shell/runtime drift the redistribution pass is trying to remove.

---

## 14. Minimal Safe Implementation Order

This theme architecture should be built in this order:

### Step 1
Finish runtime authority cleanup for:
- reading entry
- restore
- TTS continuity
- importer reset
- reading exit cleanup

### Step 2
Lock reading structure in `components.css`:
- top/bottom controls
- reading card structure
- responsive behavior
- settings panel structure
- clipping fixes

### Step 3
Move visual theme logic into `theme.css`:
- tokens
- theme selectors
- font pairings
- wallpaper hooks

### Step 4
Add runtime-backed theme/environment settings:
- selected theme
- selected font
- selected sound profile
- allowed tier
- optional atmosphere flags

### Step 5
Expose shell theme surfaces:
- profile swatches
- reading settings selector
- Pro-locked visuals

### Step 6
Only after that, add richer Pro customization.

---

## 15. Recommended File/Folder Structure to Establish Over Time

```text
reading-comprehension/
  docs/
    index.html

    css/
      components.css
      theme.css

    js/
      app.js
      state.js
      ui.js
      audio.js
      embers.js
      config.js
      # themes.js (optional later)

    assets/
      books/
      themes/
        wallpapers/
        sounds/
        music/
```

### Clarification
This is the **target continuity-supporting structure**.

It should be established through redistribution and cleanup, not assumed to already be fully authoritative today.

---

## 16. Final Decision

The correct architecture for themes is:

- `components.css` = structure
- `theme.css` = appearance
- `assets/themes/` = theme-linked media target
- runtime JS = authoritative theme settings, gating, persistence, and behavior-linked state
- shell = swatches/settings surface only

### Final sentence

**Reading Trainer themes should be implemented as a thin presentation layer over one locked reading structure, in a way that helps restore file continuity to the scaffold and keeps `index.html` converging toward a thinner shell rather than a second authority layer.**
