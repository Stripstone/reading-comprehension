# Reading Trainer — Launch Plan

This document is the operational reference for launching Reading Trainer.

It is downstream of two other documents:

- **ExperienceSpec.md** owns expected user-facing behavior
- **SystemResponsibilitiesMap.md** owns architecture and file ownership

This document owns launch gating, sequencing, validation, and go-to-market execution.

---

## 1. Launch Planning Adjustment After Architecture Audit

A documentation and code audit was completed before redistribution work.

### What changed
The frontend is currently a **transitional shell + runtime hybrid**, not a fully redistributed scaffold.

That means launch-critical validation must now be read through the correct ownership model:

- **Shell** owns layout, routing chrome, preview surface, theme/tier visuals, and responsive presentation
- **Runtime scaffold** owns reading entry, importer lifecycle, TTS lifecycle, progress persistence, evaluation flow, and cleanup behavior

### Why this matters for launch
Several launch-critical items depend on responsibilities being owned in the correct place:

- reading progress restore
- tier unlock behavior
- TTS reliability
- importer close/reset behavior
- leaving-reading cleanup
- theme/tier sync after load

These cannot be treated as “done” unless the runtime owns the underlying behavior and regression confirms it.

### Current infrastructure state after Supabase setup
- Supabase project exists
- RLS is enabled
- Schema foundation now exists for `users`, `user_progress`, `user_sessions`, `user_settings`, and `user_entitlements`
- This clears the schema-planning phase and moves persistence work into frontend/backend integration
- It does **not** yet clear auth flow, frontend sync, JWT verification, or Stripe webhook integration

---

## 2. Positioning

### 2.1 MVP Value Proposition

> "Turn any document into something you can actually get through."

This remains the launch positioning.

The launch promise is practical and narrow:
- open the app
- choose or import a document
- read page by page
- use TTS reliably
- leave and come back without losing your place

The architecture audit does not change positioning, but it does change what must be proven before this promise is honest.

---

## 3. Revised Launch Gate

Launch is cleared only when a user can:

1. open the app with low friction
2. choose or import a document
3. enter reading cleanly
4. read page by page
5. use TTS reliably
6. leave reading without lingering audio/state
7. return and resume from the correct place
8. encounter upgrade prompts only when touching paid capability

### Architectural clarification
For launch purposes, the following behaviors are **runtime-owned requirements** even if surfaced through shell UI:

- reading entry and handoff
- reading progress persistence and restore
- TTS start/resume/stop reliability
- autoplay continuity
- importer staged-state reset
- tier enforcement and mode gating
- reading exit cleanup

The following are **shell-owned presentation requirements**:

- section routing chrome
- theme/tier visuals
- preview modal presentation
- responsive layout stability
- library/profile centering and clipping fixes

---

## 4. Current Launch-Critical Audit Findings

These findings replace earlier assumptions where they conflict with audited code reality.

### 4.1 Reading progress restore
**Status after audit:** not yet reliable enough to treat as built.

Why:
- current persistence exists for pages and per-page work
- but the audited runtime does not currently implement a trustworthy last-read-page restore path end-to-end
- prior planning language overstated completion here

Launch meaning:
- this remains part of the launch gate
- it must be validated after redistribution/regression, not assumed from older notes

### 4.2 TTS reliability
**Status after audit:** runtime-owned, but currently bridged by shell in a few important places.

Why:
- `tts.js` owns playback, autoplay, browser/cloud routing, and highlighting
- shell still owns speed bridging and top-bar control adapters

Launch meaning:
- validation must confirm speed consistency, start/stop cleanliness, countdown behavior, and top-control sync across entry paths
- this is not just a shell polish item

### 4.3 Tier unlock / theme sync
**Status after audit:** split between shell visuals and runtime gating.

Why:
- shell owns pill/swatch visuals
- `ui.js` owns `appTier` and access rules

Launch meaning:
- validation must confirm that visible current tier/theme state matches actual runtime access after load and after switching

### 4.4 Importer close/reset behavior
**Status after audit:** transitional.

Why:
- importer runtime owns staged file state
- shell currently performs extra UI reset on close/done

Launch meaning:
- “stale staged upload should not linger” remains a real launch requirement
- implementation should consolidate reset authority into runtime before the item is marked complete

### 4.5 Leaving reading
**Status after audit:** transitional.

Why:
- shell currently triggers cleanup on reading exit
- runtime owns the systems being cleaned up

Launch meaning:
- navigation away from reading must stop reading-owned audio/state consistently from one runtime-owned cleanup path

---

## 5. Phase 0 Priorities After Audit

The architecture audit changes sequencing slightly.

### Revised order for Phase 0
1. **Restore runtime authority for launch-critical reading behavior**
   - reading entry
   - importer lifecycle reset
   - reading exit cleanup
   - TTS speed consistency
   - progress restore
2. **Lock shell layout and presentation responsibilities**
   - library/profile centering
   - top control clipping
   - narrow-width stability
   - reading layout structure shared across themes
3. **Run regression and validate launch promise**
4. **Then continue with auth, payments, observability, and distribution**

This replaces any assumption that shell polish or infra wiring alone can clear the launch gate.

---

## 6. Launch Gate Checklist

Two columns remain:
- **Built** = implemented in code
- **Validated** = confirmed in real runtime testing

### Block 1 — Owner prerequisites

| Item | Built | Validated | Owner |
|---|---|---|---|
| App name finalized | — | ⬜ | Owner |
| Positioning copy written | — | ⬜ | Owner |
| Icon assets provided | — | ⬜ | Owner |
| Supabase account and project created | ✅ | ✅ | Owner |
| Stripe account and products created | — | ⬜ | Owner |
| Feedback channel set up | — | ⬜ | Owner |

### Block 2 — Runtime authority restoration

| Item | Built | Validated | Owner |
|---|---|---|---|
| Reading entry resolved through runtime-owned path | ⬜ | ⬜ | AI / Owner |
| Importer staged state clears on close and after import through runtime-owned reset | ⬜ | ⬜ | AI / Owner |
| Reading exit cleanup runs through one runtime-owned path | ⬜ | ⬜ | AI / Owner |
| TTS speed is applied consistently on fresh start, resume, and page transitions | ⬜ | ⬜ | AI / Owner |
| Reading progress restore lands user on correct page after return | ⬜ | ⬜ | AI / Owner |

### Block 3 — Shell layout lock

| Item | Built | Validated | Owner |
|---|---|---|---|
| Library and Profile containers centered/padded correctly | ⬜ | ⬜ | AI / Owner |
| Reading top controls no longer clip at narrow widths | ⬜ | ⬜ | AI / Owner |
| Shared reading layout structure locked across themes | ⬜ | ⬜ | AI / Owner |
| Theme/tier visuals reflect actual runtime state after load | ⬜ | ⬜ | AI / Owner |

### Block 4 — Cold-start and friction

| Item | Built | Validated | Owner |
|---|---|---|---|
| Cold-start friction audit — 60-second new user test | — | ⬜ | Owner |
| Cold-start guidance / empty state improvements | ⬜ | ⬜ | AI / Owner |
| Logged-in routing skips landing page appropriately | ⬜ | ⬜ | AI / Owner |
| Back behavior stays inside app flow where intended | ⬜ | ⬜ | AI / Owner |

### Block 5 — Infrastructure

| Item | Built | Validated | Owner |
|---|---|---|---|
| Supabase `users` table with tier and token fields | ✅ | ⬜ | AI / Owner |
| Supabase progress/settings/session/entitlement tables created with RLS | ✅ | ⬜ | AI / Owner |
| `supabase-js` added to frontend | ⬜ | ⬜ | AI / Owner |
| Soft auth prompt after first completed session | ⬜ | ⬜ | AI / Owner |
| JWT verification wired on `/api/*` endpoints | ⬜ | ⬜ | AI / Owner |
| Stripe webhook endpoint deployed | ⬜ | ⬜ | AI / Owner |
| Tier written to user state on Stripe events | ⬜ | ⬜ | AI / Owner |
| Token enforcement active on cost-bearing endpoints | ⬜ | ⬜ | AI / Owner |

### Block 6 — Frontend monetization flow

| Item | Built | Validated | Owner |
|---|---|---|---|
| Contextual upgrade prompts align with real runtime capability gates | ⬜ | ⬜ | AI / Owner |
| Account / billing entry visible in shell controls | ⬜ | ⬜ | AI / Owner |
| Full upgrade flow tested end-to-end | — | ⬜ | Owner |

### Block 7 — Observability and distribution

| Item | Built | Validated | Owner |
|---|---|---|---|
| PostHog analytics events wired | ⬜ | ⬜ | AI / Owner |
| Diagnostics send flow wired | ⬜ | ⬜ | AI / Owner |
| Feedback link visible | ⬜ | ⬜ | AI / Owner |
| PWA manifest + service worker | ⬜ | ⬜ | AI / Owner |
| PWA installability tested | — | ⬜ | Owner |
| Minimal landing page live | ⬜ | ⬜ | AI / Owner |

---

## 7. Validation Notes

The audit changes how these items should be validated.

### Reading progress restore validation
Confirm with a real session that:
- user opens a document
- advances beyond page 1
- leaves reading
- refreshes or returns later
- lands on the correct page rather than a fresh page-1 state

### TTS validation
Confirm that:
- speed setting persists
- speed applies when playback starts fresh
- speed still applies after next-page transition
- speed still applies after stop/resume
- leaving reading stops audio cleanly
- autoplay countdown is cancelable and visually synced

### Tier/theme validation
Confirm that:
- stored tier loads correctly
- runtime access matches visible pill/swatch state
- explorer theme gating matches real current tier

### Importer validation
Confirm that:
- closing importer clears staged file state
- clicking away from importer does not leave a ghost file waiting to be scanned
- import complete returns to a clean importer state next time

---

## 8. What This Document No Longer Assumes

This plan no longer assumes any of the following without implementation + regression:

- that reading progress restore is already finished
- that shell control sync guarantees TTS reliability
- that importer UI reset equals importer state reset
- that visible tier/theme state automatically matches runtime state after load

Those are now explicit validation targets.

---

## 9. Open Questions

| # | Question | Raised | Resolved |
|---|---|---|---|
| 1 | Is Research mode required for MVP or deferred? | Launch planning | ⬜ |
| 2 | Final app name for trademark/store listings? | Launch planning | ⬜ |
| 3 | Are under-13 users in scope, requiring COPPA review? | Launch planning | ⬜ |
| 4 | What is the final shell-to-runtime auth flow for logged-in routing? | Architecture audit | ⬜ |
| 5 | What is the runtime-owned API for reading entry/exit after redistribution? | Architecture audit | ⬜ |
| 6 | Feedback channel decision — email, form, or Discord? | Launch planning | ⬜ |
| 7 | Landing page hosting choice? | Launch planning | ⬜ |

---

## 10. Revision Note for This Pass

This version updates launch planning to match the audited architecture:
- shell and runtime responsibilities are now distinguished explicitly
- reading progress restore is treated as not yet validated/built enough to trust
- TTS reliability, importer reset, and reading exit cleanup are now framed as runtime authority issues rather than surface polish
- backlog execution status should be updated only after implementation/regression, not here


## Supabase Environment Variable Naming

The authoritative environment variable names are:

- `SUPABASE_URL` — frontend safe
- `SUPABASE_ANON_KEY` — frontend safe
- `SUPABASE_SECRET_KEY` — backend only

Only `SUPABASE_URL` and `SUPABASE_ANON_KEY` should be used by frontend client initialization.  
`SUPABASE_SECRET_KEY` must remain server-only and must never be exposed to the client.

A raw Postgres connection string is not required for normal frontend/runtime integration.

