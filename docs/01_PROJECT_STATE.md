# Reading Trainer — Current Project State

## Summary
Reading Trainer is a static frontend plus serverless backend with a global-script runtime.

The current build is a transitional shell/runtime hybrid.
Treat the current codebase as the patch target.
Do not treat older builds or older notes as implementation truth.

## Current code shape

### Shell layer
Located in:
- `docs/index.html`
- `docs/js/shell.js`
- `docs/css/components.css`
- `docs/css/theme.css`

Current role:
- section layout and navigation
- modal shells
- reading chrome
- library/profile presentation
- footer/layout behavior
- visual theme/tier surface
- shell-side bridge behavior into runtime

### Runtime scaffold
Loaded by `docs/js/app.js` in this order:
- `state.js`
- `tts.js`
- `utils.js`
- `anchors.js`
- `import.js`
- `library.js`
- `evaluation.js`
- `ui.js`

Current role:
- reading state
- TTS
- importer
- library loading and rendering
- evaluation flow
- runtime UI rules
- restore and reading continuity logic

### Supporting JS outside the loader
Loaded before the scaffold:
- `docs/js/config.js`
- `docs/js/audio.js`
- `docs/js/embers.js`
- `docs/assets/books/embedded_books.js`

### Backend
Located in:
- `api/anchors`
- `api/evaluate`
- `api/book-import`
- `api/health`
- `api/summary`
- `api/tts`
- `api/_lib`
- `api/prompts`

Current role:
- anchors
- grading/evaluation
- import conversion
- summary generation
- cloud TTS
- shared helpers and prompt contracts

## Current architectural reality

### True today
- This is a global-script app, not a module/bundler app.
- Boot order matters.
- Runtime owns actual reading behavior.
- Shell still contains presentation plus transitional bridge logic.
- Current code should be treated as the patch target.

### Still transitional
- reading entry is not fully consolidated behind one clean runtime path
- restore continuity still needs careful validation
- some shell behavior still competes with runtime authority
- some older documents describe target state more strongly than current code supports

## What a new engineer should assume
- Preserve the current UI direction unless the bug is caused by it.
- Prefer runtime-owned fixes over new shell logic.
- Do not infer truth from the DOM if runtime can own it.
- Do not remove shell bridge code until the runtime replacement exists.
- Validate important behavior in a served environment.

## Current priority areas
1. reading continuity
2. TTS continuity
3. importer lifecycle
4. exit cleanup
5. shell layout stability
6. auth/persistence integration after runtime behavior is stable

## What this project is not yet
It is not yet:
- a thin shell over a fully cleaned scaffold
- a fully integrated Supabase client app
- a finalized monetization/billing system
- a completed theme architecture implementation

The present target is stable reading behavior first.
