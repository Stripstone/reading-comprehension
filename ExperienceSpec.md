# Reading Trainer — Experience Spec

This document defines how the application should feel and behave from the user's perspective.

It is the reference for development decisions. Architecture lives in **SystemResponsibilitiesMap.md**. Launch sequencing lives in **LaunchPlan.md**. This file owns the experience contract.

---

## 1. The Core Experience

Reading Trainer should feel like a low-friction reading environment first and a deeper training system second.

At launch, the most important promise is simple:

> The user can open the app, get into a document quickly, read page by page, listen reliably, leave, and return to the right place.

The deeper comprehension loop remains part of the product, but launch behavior must not get in the way of the basic reading promise.

---

## 2. Application Modes

Three modes exist in product language, but only two are relevant to the current live experience.

### Reading Mode

The simplest mode.

**What the user sees:**
- passage text
- Read Page button
- next-page flow
- reading chrome that stays out of the way

**Feel:**
- clean
- distraction-light
- like opening a document and being able to continue immediately

**Navigation expectation:**
- Next moves to the next page
- the last page wraps to the top
- reading controls remain reachable and unclipped

### Comprehension Mode

The training mode.

**What the user sees:**
- passage
- Read Page button
- anchor counter / hint
- consolidation box
- timer / character count
- compass stars
- evaluation controls

**Feel:**
- structured, but still readable
- the user should feel guided, not burdened

### Research Mode *(future / not launch-critical)*

Still future-facing. It should not distort current launch behavior or architecture decisions.

---

## 3. Launch-Critical Reading Expectations

These are the expectations that matter most right now.

### 3.1 Cold open

The user should not hit a dead end or confusing first screen.

Expected behavior:
- library and profile layouts feel centered and intentional
- advanced controls do not dominate the first impression
- authenticated users should not be sent through unnecessary landing friction
- app back behavior should keep the user inside the app flow where appropriate

### 3.2 Import or select a document

The path to content should be obvious.

Expected behavior:
- user can either choose a document or upload one without confusion
- advanced parser controls are available but do not feel required
- if the importer closes, transient staged file state should clear
- closing or dismissing the importer should not leave a previously dragged file silently waiting

### 3.3 Start reading

The transition from selecting content into reading should feel trustworthy.

Expected behavior:
- chosen content opens into reading, not a misleading page-1 reset when a restorable session exists
- top reading controls reflect the actual current reading state
- theme/tier visuals shown in reading should reflect real current state after load

### 3.4 Reading feel

Reading mode should stay focused.

Expected behavior:
- only the reading-relevant controls are visible
- layout stays stable across themes
- top controls and sound/voice controls do not clip at narrow widths
- the reading layout structure is shared across themes, not redefined by each theme

### 3.5 Page navigation

Expected behavior:
- Next advances to the next page
- last page wraps to top
- page progress is understandable but subtle
- transitions feel clean rather than game-like

### 3.6 TTS

TTS must feel assistive, not fragile.

Expected behavior:
- playback starts only on explicit user action
- playback stops cleanly
- speed, voice, and volume settings remain consistent when playback starts again or moves to the next page
- highlighting follows audio closely enough to feel helpful
- countdown between pages is clean and cancelable

Important experience rule:
- speed should not depend on one lucky entry path
- it should remain correct whenever TTS starts, resumes, or advances

### 3.7 Leaving reading

Expected behavior:
- leaving reading stops reading-owned audio cleanly
- no lingering TTS or music should continue on library/profile screens unless intentionally designed to do so later
- leaving reading should clear transient reading-only UI state

### 3.8 Return later

Expected behavior:
- user lands back on the page they were last reading
- session restore feels like continuity, not a partial memory of the session
- progress memory should survive normal return flows and not depend on one specific entry path
- when signed in, the same continuity model should extend across devices through account-backed persistence rather than a second UI-only state model

---

## 4. Themes and Tier Presentation

Themes and tiers should feel like presentation layers over one stable reading experience.

### Theme expectations
- one locked reading layout structure
- themes inherit that structure
- theme changes alter presentation, not core layout rules
- free/basic theme options can stay simple
- higher-tier themes can add richer visual treatment later

### Tier expectations
- visible current tier should match actual current state after load
- upgrade prompts should appear when the user touches paid capability, not as upfront friction
- theme/tier visuals should not claim capabilities the runtime has not actually unlocked

---

## 5. Audio and TTS Platform Expectations

Audio narration is optional support, but reliability is part of the trust contract.

### General expectations
- start only on explicit user action
- stop cleanly on navigation away from reading
- autoplay countdown should be understandable and cancelable
- top controls should stay synchronized with actual playback state

### Platform caution
Safari / iOS / iPadOS still require careful handling of gesture-gated audio behavior. Any new audio-triggering flow must preserve that reliability rather than moving responsibility into shell presentation code.

---

## 6. Feedback and Upgrade Friction

The user should feel value before monetization pressure.

Expected behavior:
- Free path allows reading/listening without immediate payment friction
- upgrade prompts appear contextually when a paid capability is touched
- tier visuals should be accurate, not promotional placeholders that disagree with current access

---

## 7. Runtime Observations

These observations matter because they changed or clarified the current expected experience.

| Date | Platform | Observation | Resolution |
|---|---|---|---|
| 2026-03-15 | All | Tier selector visible but switching tiers had no effect on UI | Bug — `applyTierAccess()` needed to run after DOM/render state was available |
| 2026-03-15 | All | TTS Read on AI feedback did not speak lead-in phrase before better consolidation | Bug — lead-in string was missing from TTS queue |
| 2026-03-15 | All | Per-page loop felt too mechanical | Spec adjustment — anchor discovery treated as primary reward signal |
| 2026-03-28 | All | Library and Profile containers visually hugged left rather than feeling centered | Keep as current expectation: shell layout should feel centered and intentional |
| 2026-03-28 | Mobile / app-like flows | Back action could leave the app flow | Current expectation: back/navigation behavior should keep the user inside the app flow where appropriate |
| 2026-03-28 | All | Importer could retain a staged file after close/dismiss | Current expectation: importer transient state must clear when closed |
| 2026-03-28 | All | TTS speed did not feel consistently applied across start/transition paths | Current expectation: speed must remain consistent whenever playback starts, resumes, or advances |
| 2026-03-28 | All | Leaving reading could leave audio behavior feeling stateful outside reading | Current expectation: leaving reading should stop reading-owned audio cleanly |
| 2026-03-28 | All | Return-later and reading-entry behavior showed event-path dependence | Current expectation: session restore and reading re-entry should work independently of which path the user took into reading |
| 2026-03-28 | Narrow width | Reading top controls showed slight clipping around page/status + Sound & Voice | Current expectation: reading controls must remain reachable and unclipped at narrow widths |
| 2026-03-28 | Infrastructure | Supabase schema foundation was created for account, progress, session, settings, and entitlement persistence | Current expectation: cloud persistence should extend runtime-owned continuity once frontend/backend integration is wired |

---

## 8. Deferred

These are not part of the current documentation refresh target.

- full research mode implementation
- streaks / gamification
- native apps
- major platform expansion
- institutional workflows
- advanced theme tooling beyond stable shared reading layout


## Supabase Environment Variable Naming

The authoritative environment variable names are:

- `SUPABASE_URL` — frontend safe
- `SUPABASE_ANON_KEY` — frontend safe
- `SUPABASE_SECRET_KEY` — backend only

Only `SUPABASE_URL` and `SUPABASE_ANON_KEY` should be used by frontend client initialization.  
`SUPABASE_SECRET_KEY` must remain server-only and must never be exposed to the client.

A raw Postgres connection string is not required for normal frontend/runtime integration.

