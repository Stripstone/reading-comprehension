# Reading Trainer — Supabase Schema Map

This document defines the current cloud persistence schema for Reading Trainer and explains how it supports the authoritative runtime architecture.

It is downstream of:
- `SystemResponsibilitiesMap.md`
- `LaunchPlan.md`
- `ExperienceSpec.md`
- `RedistributionExecutionMap.md`

Its purpose is to answer one question:

**What does Supabase store, and how does that persistence layer support runtime-owned behavior without becoming a second frontend state model?**

---

## 1. Governing Rule

**Supabase persists runtime-owned truths. It does not replace runtime ownership.**

That means:
- runtime files still decide what state means
- runtime files still decide how reading, restore, TTS, and settings behave
- Supabase stores the durable records that allow those truths to survive sign-in, refresh, and device changes

### Practical meaning

- `state.js` decides what a restore payload means
- `library.js` decides what source/book/page actually opens
- `tts.js` decides how playback state behaves
- `ui.js` decides client-side gating and visible state application
- Supabase stores durable user/account/progress/settings/session/entitlement records

---

## 2. Current Scope

Supabase is currently planned as the authoritative external persistence layer for:

- auth-linked user/account records
- durable reading progress
- durable user settings
- session history/statistics
- future entitlement/billing records

It is **not** intended to:
- replace the local runtime state model
- create shell-only persistence
- define reading behavior from the database side
- become a generic blob store for all app state

---

## 3. Environment Variable Naming

The authoritative environment variable names are:

- `SUPABASE_URL` — frontend safe
- `SUPABASE_ANON_KEY` — frontend safe
- `SUPABASE_SECRET_KEY` — backend only

### Rules
- Only `SUPABASE_URL` and `SUPABASE_ANON_KEY` should be used by frontend client initialization.
- `SUPABASE_SECRET_KEY` must remain server-only and must never be exposed to the client.
- A raw Postgres connection string is not required for normal frontend/runtime integration.

---

## 4. Table Overview

| Table | Purpose | Runtime relationship |
|---|---|---|
| `users` | Root auth-linked account record | Supports tier/token/account truth used by runtime |
| `user_progress` | Authoritative cross-device reading continuity | Supports restore/return-later behavior |
| `user_sessions` | Session history and aggregate statistics | Supports analytics/history, not restore truth |
| `user_settings` | Durable user preferences | Supports theme/TTS/audio/reading environment persistence |
| `user_entitlements` | Future billing/entitlement truth | Supports Stripe-backed access state later |

---

## 5. Table-by-Table Map

## 5.1 `users`

### Purpose
The root account/profile table tied to Supabase Auth.

### Stores
- auth-linked user identity
- current tier
- token/account state
- simple account metadata

### Typical columns
- `id`
- `tier`
- `tokens_remaining`
- `tokens_reset_at`
- `display_name`
- `email`
- `auth_provider`
- `status`
- `created_at`
- `updated_at`

### Why it exists
This is the durable account truth that runtime can load after sign-in without inventing a second local account model.

### Runtime relationship
- `ui.js` may read tier/account state for gating/application
- `state.js` may cache current account-related values in runtime state
- backend token enforcement and future Stripe sync will also depend on this table

### RLS intent
Authenticated users can:
- select their own row
- insert their own row
- update their own row

Users should **not** directly delete their own `users` row from normal client flows.

---

## 5.2 `user_progress`

### Purpose
The authoritative reading continuity table.

This is the table that should support:
- return later
- last-read page restore
- cross-device continuity
- correct resume by source identity, not only by visible UI state

### Stores
- which reading source the progress belongs to
- current book/source identity
- optional chapter identity
- last page index
- last-read time
- optional page count
- session version / continuity versioning

### Typical columns
- `id`
- `user_id`
- `source_type`
- `source_id`
- `book_id`
- `chapter_id`
- `last_page_index`
- `page_count`
- `last_read_at`
- `is_active`
- `session_version`
- `updated_at`

### Why it exists
A page number alone is not enough for trustworthy restore.
The restore model also needs durable source identity.

### Runtime relationship
- `state.js` defines what restore means
- `library.js` resolves what source/book/page opens
- Supabase stores the durable continuity record for authenticated users

### Important rule
This is the cloud persistence companion to runtime restore.
It is **not** where restore logic itself should live.

### RLS intent
Authenticated users can:
- select their own progress rows
- insert their own progress rows
- update their own progress rows
- delete their own progress rows

---

## 5.3 `user_sessions`

### Purpose
A session-history and aggregate-statistics table.

### Stores
- reading session identity
- optional source/book/chapter identity
- mode (`reading` / `comprehension`)
- pages completed
- minutes listened
- TTS seconds
- started/ended timing
- completed flag

### Typical columns
- `id`
- `user_id`
- `source_type`
- `source_id`
- `book_id`
- `chapter_id`
- `mode`
- `pages_completed`
- `minutes_listened`
- `tts_seconds`
- `completed`
- `started_at`
- `ended_at`
- `created_at`
- `updated_at`

### Why it exists
This table records what happened in a session.
It should support:
- session history
- simple usage stats
- future analytics
- soft-auth or upgrade timing later if desired

### Important rule
`user_sessions` is **not** the restore source of truth.
Restore truth belongs to `user_progress`.

### Runtime relationship
- runtime may open/start/close sessions
- runtime may increment page/listen counters
- backend or analytics features may later consume aggregates

### RLS intent
Authenticated users can:
- select their own session rows
- insert their own session rows
- update their own session rows
- delete their own session rows

---

## 5.4 `user_settings`

### Purpose
The durable user-preference table.

This is the highest-value addition for theme/TTS/settings continuity.

### Stores
- selected theme
- selected font
- page-turn sound choice
- TTS speed/voice/volume settings
- autoplay preference
- music/particle preferences
- source-page-number preference

### Typical columns
- `user_id`
- `theme_id`
- `font_id`
- `text_size`
- `line_spacing`
- `page_turn_sound_id`
- `tts_speed`
- `tts_voice_id`
- `tts_volume`
- `autoplay_enabled`
- `music_enabled`
- `music_profile_id`
- `particles_enabled`
- `particle_preset_id`
- `use_source_page_numbers`
- `created_at`
- `updated_at`

### Why it exists
These settings should survive:
- refresh
- sign-in
- device changes

They should not remain trapped in shell-only UI state or browser-local-only assumptions once authenticated persistence is enabled.

### Runtime relationship
- `state.js` holds current settings in runtime state
- `ui.js` applies and reflects current theme/tier/settings surfaces
- `tts.js` consumes TTS settings
- `audio.js` consumes page-turn/music settings
- `embers.js` consumes particle settings
- Supabase stores the durable authenticated version of those preferences

### RLS intent
Authenticated users can:
- select their own settings row
- insert their own settings row
- update their own settings row
- delete their own settings row

---

## 5.5 `user_entitlements`

### Purpose
A future entitlement/billing truth table.

### Stores
- provider
- plan
- tier
- status
- Stripe customer/subscription IDs
- period start/end timing

### Typical columns
- `id`
- `user_id`
- `provider`
- `plan_id`
- `tier`
- `status`
- `stripe_customer_id`
- `stripe_subscription_id`
- `period_start`
- `period_end`
- `created_at`
- `updated_at`

### Why it exists
This allows billing truth to live in a dedicated durable model rather than overloading `users.tier` as the only long-term source.

### Runtime relationship
- runtime will usually consume simplified access/tier results
- Stripe webhooks/backend integration should eventually be the main write path
- visible tier/theme state should still be applied by runtime, not by direct shell assumptions

### RLS intent
Authenticated users should typically have:
- select access to their own entitlements

Client-side insert/update/delete is generally **not** the intended path here.
Backend/service-role writes are the expected model for billing updates.

---

## 6. Recommended Data Flow

## 6.1 On signup
1. Supabase Auth creates the auth user
2. `users` row is created
3. `user_settings` row is created with defaults
4. client can safely load account/settings state

## 6.2 On signed-in app boot
1. frontend initializes Supabase client
2. authenticated user is resolved
3. runtime loads:
   - `users`
   - `user_settings`
   - relevant `user_progress`
4. runtime applies those records to the current app state
5. shell reflects the resulting state

## 6.3 On reading progress update
1. runtime advances reading state locally
2. runtime persists local truth first
3. authenticated cloud sync writes updated progress row to `user_progress`

## 6.4 On settings change
1. user changes theme/TTS/audio/settings
2. runtime applies the new value immediately
3. authenticated cloud sync writes durable preference state to `user_settings`

## 6.5 On session lifecycle
1. runtime creates or updates a `user_sessions` row
2. counters/timing are updated as needed
3. session close/completion writes final values

## 6.6 On future billing update
1. Stripe webhook hits backend
2. backend uses elevated key access
3. `user_entitlements` and/or `users.tier` are updated
4. runtime later reads the resulting access truth

---

## 7. RLS Philosophy

The general policy model is:

### `users`
- SELECT
- INSERT
- UPDATE

### `user_progress`
- SELECT
- INSERT
- UPDATE
- DELETE

### `user_sessions`
- SELECT
- INSERT
- UPDATE
- DELETE

### `user_settings`
- SELECT
- INSERT
- UPDATE
- DELETE

### `user_entitlements`
- SELECT only from authenticated client context

### Rule
Users should only be able to act on rows tied to their own `auth.uid()`.

Server-only elevated writes should use `SUPABASE_SECRET_KEY` where truly needed, especially for:
- entitlement writes
- webhook processing
- privileged backend operations

---

## 8. What This Schema Should Not Do

Do not turn Supabase into:
- a second shell state model
- a replacement for runtime restore logic
- a generic blob store for arbitrary UI state
- a place where theme layout logic lives
- a substitute for backend-owned AI/TTS/import logic

### Important boundary
- Supabase stores durable records
- runtime still interprets those records
- shell still only presents the resulting state

---

## 9. Current vs Future Scope

## Current schema foundation
The table and RLS layer is now established.

That means the project is past:
- schema planning
- basic persistence-layer setup

And now in:
- frontend/client integration
- runtime sync integration
- backend verification/integration
- future billing integration

## Still pending
- frontend `supabase-js` integration
- signed-in restore sync
- signed-in settings sync
- session sync
- backend JWT verification on `/api/*`
- Stripe webhook write path
- Google login integration if enabled

---

## 10. Validation Expectations

Once integration begins, validate all of the following:

### Account
- user can read only their own rows
- account row loads correctly after sign-in

### Progress
- progress saves to the right source/book identity
- user returns to the right page across devices
- restore does not land on page 1 incorrectly

### Settings
- theme/TTS/audio preferences persist after refresh
- settings restore correctly on another device after sign-in

### Sessions
- session stats write correctly
- sessions do not overwrite restore truth

### Entitlements
- client can read entitlement result
- billing writes remain backend-only

---

## 11. Final Decision

The correct role of Supabase in Reading Trainer is:

- durable identity
- durable account state
- durable reading continuity
- durable user preferences
- durable future entitlement state

It should support the runtime architecture, not compete with it.

### Final sentence

**Supabase is the cloud persistence layer for Reading Trainer’s runtime-owned truths, not a replacement for the runtime model itself.**
