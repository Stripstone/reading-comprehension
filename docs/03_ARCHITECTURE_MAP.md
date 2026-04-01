# Reading Trainer — Architecture Map

This document defines ownership.

Use it to decide where code should live and what should not be duplicated.

## Governing rule
The shell layer presents controls and forwards intent.
The runtime layer owns launch-critical reading behavior.

The shell must not own, mirror, infer, or compete with runtime truth in launch-critical areas.

## Ownership split

### Shell owns
- section routing surface
- page structure and presentation
- reading chrome placement
- modal framing
- library/profile presentation
- footer/layout behavior
- theme/tier visual surfaces
- shell-safe bridge calls into runtime

### Runtime owns
- reading entry
- active page truth
- page rendering
- TTS lifecycle
- autoplay and countdown truth
- playback speed truth
- importer lifecycle
- restore and reading continuity
- reading exit cleanup
- mode/tier gating logic

### Backend owns
- anchors
- evaluation
- summary
- import conversion
- cloud TTS
- prompt contracts and server helpers

### Supabase owns
- durable account data
- durable settings
- durable progress records
- durable sessions/history
- future entitlement records

Supabase does not define runtime behavior.
It stores durable records that runtime interprets.

## Current file map

### Shell files
- `docs/index.html`
- `docs/js/shell.js`
- `docs/css/components.css`
- `docs/css/theme.css`

### Runtime files
- `docs/js/app.js`
- `docs/js/state.js`
- `docs/js/tts.js`
- `docs/js/import.js`
- `docs/js/library.js`
- `docs/js/evaluation.js`
- `docs/js/ui.js`
- `docs/js/audio.js`
- `docs/js/anchors.js`
- `docs/js/utils.js`
- `docs/js/config.js`
- `docs/js/embers.js`

### Backend files
- `api/*`

## Hard implementation rules
1. Do not move reading, TTS, importer, restore, or cleanup authority into shell code.
2. Do not remove shell bridge code until the runtime replacement exists.
3. Do not treat DOM polling or mirror variables as real state.
4. Do not silently change backend contracts during frontend cleanup.
5. Do not assume module or bundler semantics.
6. Do not break scaffold load order.

## Current load order
`app.js` loads runtime files in this order:
- `state.js`
- `tts.js`
- `utils.js`
- `anchors.js`
- `import.js`
- `library.js`
- `evaluation.js`
- `ui.js`

This order is part of the runtime contract.

## Decision rules

### Put it in shell only if
- it is purely presentational
- it does not create or infer runtime state
- it does not duplicate lifecycle logic
- it cannot regress a runtime-owned fix

### Put it in runtime if it affects
- reading entry or exit
- current page truth
- playback
- speed
- autoplay or countdown
- importer state
- restore
- progress or completion truth
- mode or tier enforcement

## Theme rule
Themes are a presentation layer over one locked reading layout.

That means:
- structure belongs in `components.css`
- appearance belongs in `theme.css`
- selected theme state belongs in runtime
- shell may surface swatches or settings, but not theme truth

## Redistribution rule
When shell behavior and scaffold behavior overlap, the scaffold wins by default unless the concern is purely presentational.

## Safe migration pattern
1. expose runtime API
2. point shell control at runtime API
3. verify behavior
4. remove duplicate shell logic

## Unsafe migration pattern
1. remove shell bridge first
2. assume runtime replacement already exists
3. rewrite layout and behavior at the same time
4. validate only under `file://`
