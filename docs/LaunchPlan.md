# Reading Trainer — Launch Plan

This document is the operational reference for launching Reading Trainer to market.

It covers the launch gate, phased roadmap, positioning, monetization, platform rollout, IP protection, and the UX backlog. It is a living document — updated from three sources:

- **Runtime and UX validation** — observations from live sessions that reveal gaps or required changes
- **Planning reviews** — third-party input that improves strategy or routing decisions
- **Spec changes** — when ExperienceSpec.md is updated, this document reflects the downstream launch impact

Cross-reference: **ExperienceSpec.md** owns behavioral and UX contracts. **SystemResponsibilitiesMap.md** owns architecture. This document owns everything between product and market.

---

## Workflow

1. **Execution** — account setup (owner), back-end build work (AI), runtime and UX validation at launch (owner)
2. **Planning reviews** — owner and third-party go deep on strategy adjustments; findings logged here
3. **Revisions** — owner and AI revise this document based on runtime observations and validation results

Entries in the Runtime Observations table (Section 12) trigger revisions.

---

## 1. Positioning

### 1.1 MVP Value Proposition

> "Turn any document into something you can actually get through."

This is the launch positioning. Narrow and honest. It does not promise skill transformation — that is the long-term value of the comprehension training loop. For launch it promises friction removal, which is what the MVP actually delivers.

The comprehension training angle remains the long-term differentiator and will become the primary positioning once early retention validates it. Launch on the smaller, truer promise and earn the right to the bigger claim.

**Target user at launch:** Students — high school and college. They have a reading problem today: assigned readings, dense textbooks, PDFs they avoid starting. This app solves that problem immediately, without requiring a habit change first.

**What the MVP delivers that justifies this promise:**

| Feature | Status |
|---|---|
| Playback continuity — TTS narrates any document | ✅ Done |
| Predictable navigation — page-by-page, clear Next | ✅ Done |
| Reading progress position memory | ❌ Missing — must ship in Phase 0 |
| Minimal friction getting started | ❌ Needs audit — must ship in Phase 0 |

Progress position memory and low-friction start are not nice-to-haves. Without them the core promise has a visible gap. Both ship in Phase 0.

### 1.2 Positioning Copy (for landing page and store listings)

**Headline:** Turn any document into something you can actually get through.

**Sub-line:** Upload a book, article, or PDF. Reading Trainer breaks it into pages, reads it aloud, and keeps your place — so you stop avoiding your reading list.

**Who it's for:** Students, researchers, and anyone with more to read than time to read it.

### 1.3 What This Is Not at Launch

- Not a Duolingo competitor. Habit mechanics, characters, and streaks are deferred to Phase 2.
- Not a Speechify competitor. Parsing into pages, chapters, and anchors is the differentiator — not raw document playback.
- Not yet a comprehension training platform. That is the long-term position. Get users through documents first.

---

## 2. Launch Gate

The launch gate is the minimum that must be true before any public rollout.

A user can: open the app with no friction, upload or select a document, navigate it page by page, listen via TTS, and pick up where they left off on return. They can do all of this for free. They encounter a payment prompt only after they have experienced value.

### 2.1 MVP Feature Gaps (Phase 0)

#### Reading Progress Position Memory

When a user returns to the app, they land on the page they were last reading — not page 1. Table stakes for the "get through your reading" promise.

**Implementation:** `lastReadPageIndex` persisted to `localStorage` keyed by session hash. On load, scroll to that page and restore position. When auth is added, sync to Supabase so it persists across devices.

#### Minimal Friction Getting Started

**Audit required:** Owner runs a cold-start test — clear localStorage, open the app, attempt to start reading within 60 seconds. Every step that requires an unexpected decision gets flagged.

Known candidates:
- "Loading…" default in book and chapter selects is unclear to a first-time user
- No empty state guidance when nothing is loaded
- Tier / mode / source dropdowns all visible on load — potentially overwhelming before any value is shown

Fix approach: clear empty state ("Start here — pick a book or upload one"), hide advanced controls until they are relevant.

### 2.2 Auth

**Method:** Supabase Auth

Provides auth, database, and row-level security in one platform. No account required to use Free tier features. Auth is prompted softly after a first completed reading session.

**Tasks:**
- Create Supabase project
- Add `supabase-js` via CDN — no bundler needed
- Soft auth prompt after first session: "Save your progress — create a free account"
- Add `users` table: `id`, `tier`, `tokens_remaining`, `tokens_reset_at`
- JWT verification on all `/api/*` endpoints before processing

**Owner action:** Create Supabase account and project. Provide project URL and anon key.

### 2.3 Payments

**Method:** Stripe + Stripe Customer Portal

No subscription gate. Free is immediately usable. Payment is prompted contextually when a Free user touches a Paid feature.

**Upgrade prompt framing — capability unlock, not paywall:**
- On TTS: "Cloud narration sounds better — upgrade to Paid for $6/month"
- On Comprehension mode: "Train your reading comprehension — available on Paid"

**Tasks:**
- Create Stripe products: Free, Paid ($6/mo), Premium ($14/mo)
- `POST /api/stripe-webhook` — listens for subscription events, writes tier to Supabase
- Upgrade prompt UI — contextual, inline, non-blocking
- Account / billing link in top controls → Stripe Customer Portal
- Token enforcement on `/api/evaluate`, `/api/anchors`, `/api/tts` — check remaining before processing, decrement on success

**Owner action:** Create Stripe account. Configure products and pricing. Provide webhook secret.

### 2.4 Lightweight Progress Signal

One signal only. No streaks, no gamification at launch.

**Examples:**
- "You listened for 12 minutes today"
- "You completed 8 pages"

**Implementation:** Session stats tracked in state (`sessionMinutesListened`, `sessionPagesCompleted`). Shown as a subtle line below the last page card at end of session. Works from localStorage for anonymous users. Syncs to Supabase when logged in.

Habit mechanics (streaks, notifications, home screen widgets, characters) are deferred to Phase 2.

### 2.5 Launch Gate Checklist

Two columns: **Built** (AI ships it) and **Validated** (owner confirms it works in a real session). Both must be checked before launch. Items are sequenced by dependency — do not start a row until the rows above it in the same block are built.

**Block 1 — Owner prerequisites (no code can proceed without these)**

| Item | Built | Validated | Owner |
|---|---|---|---|
| App name finalized | — | ⬜ | Owner |
| Positioning copy written (headline + sub-line) | — | ⬜ | Owner |
| Icon assets provided (192×192 and 512×512 PNG) | — | ⬜ | Owner |
| Supabase account and project created | — | ⬜ | Owner |
| Stripe account and products created (Free / Paid $6 / Premium $14) | — | ⬜ | Owner |
| Feedback channel set up (email, form, or Discord) | — | ⬜ | Owner |

**Block 2 — Core app gaps (can build in parallel with Block 1)**

| Item | Built | Validated | Owner |
|---|---|---|---|
| Reading progress position memory (`lastReadPageIndex`) | ⬜ | ⬜ | AI / Owner |
| Cold-start friction audit — 60-second new user test | — | ⬜ | Owner |
| Cold-start friction fixes (empty state, hidden advanced controls) | ⬜ | ⬜ | AI / Owner |
| Lightweight progress signal ("You listened for 12 minutes") | ⬜ | ⬜ | AI / Owner |

**Block 3 — Infrastructure (requires Block 1 Supabase + Stripe to be done)**

| Item | Built | Validated | Owner |
|---|---|---|---|
| Supabase `users` table with tier and token columns | ⬜ | ⬜ | AI / Owner |
| `supabase-js` added to frontend via CDN | ⬜ | ⬜ | AI / Owner |
| Soft auth prompt after first completed session | ⬜ | ⬜ | AI / Owner |
| JWT verification wired on all `/api/*` endpoints | ⬜ | ⬜ | AI / Owner |
| Stripe webhook endpoint (`/api/stripe-webhook`) deployed | ⬜ | ⬜ | AI / Owner |
| Tier written to Supabase on Stripe subscription events | ⬜ | ⬜ | AI / Owner |
| Token enforcement active on `/api/tts`, `/api/evaluate`, `/api/anchors` | ⬜ | ⬜ | AI / Owner |

**Block 4 — Frontend (requires Block 3)**

| Item | Built | Validated | Owner |
|---|---|---|---|
| Contextual upgrade prompt on Free → Paid tier gate | ⬜ | ⬜ | AI / Owner |
| Account / billing link in top controls → Stripe Customer Portal | ⬜ | ⬜ | AI / Owner |
| Full upgrade flow tested: prompt → Stripe checkout → tier unlocks | — | ⬜ | Owner |
| TTS S3 caching confirmed working end-to-end | — | ⬜ | Owner |

**Block 5 — Observability (can build in parallel with Block 3)**

| Item | Built | Validated | Owner |
|---|---|---|---|
| PostHog analytics events wired (7 events — see Section 5.2) | ⬜ | ⬜ | AI / Owner |
| Diagnostics "Send diagnostics" button wired | ⬜ | ⬜ | AI / Owner |
| Feedback link visible in footer | ⬜ | ⬜ | AI / Owner |

**Block 6 — Distribution (can build in parallel with Block 3, requires Block 1 assets)**

| Item | Built | Validated | Owner |
|---|---|---|---|
| PWA manifest + service worker | ⬜ | ⬜ | AI / Owner |
| PWA installability tested on iOS, Android, and desktop | — | ⬜ | Owner |
| Minimal landing page live (headline, sub-line, CTA) | ⬜ | ⬜ | AI / Owner |

**Block 7 — IP (owner actions, can run in parallel throughout)**

| Item | Built | Validated | Owner |
|---|---|---|---|
| Code obfuscation build step applied before deployment | ⬜ | ⬜ | AI / Owner |
| Terms of Service and Privacy Policy published | — | ⬜ | Owner |
| Copyright registration filed (copyright.gov) | — | ⬜ | Owner |
| Trademark filing decision made and actioned | — | ⬜ | Owner |

---

**Launch is cleared when every Validated cell in Blocks 1–6 is checked. Block 7 can trail by up to 2 weeks but must not be skipped.**

---

## 3. Phase 0 — Launch (Weeks 1–2)

Work through the blocks in Section 2.5 in order. Blocks 2, 5, and 6 can run in parallel once Block 1 is complete. Block 3 gates Block 4.

**Definition of done:** Every Validated cell in Blocks 1–6 is checked. A student opens the app cold, starts reading within 60 seconds, returns the next day and lands on the right page, has a way to give feedback, and can upgrade to Paid with the tier unlocking immediately.

---

## 4. Phase 1 — Solidify the Experience (Weeks 3–6)

Sequenced after Phase 0 is stable. Prioritize by what runtime testing surfaces.

### 4.1 Comprehension Mode Cleanup

Owner runs a live walkthrough and records specific friction points. AI addresses each one. No speculative redesign — observed gaps only.

Known candidates:
- Evaluation phase transition (compasses unlocking) needs a cleaner visual signal
- Star rating purpose unclear to first-time users — needs label or tooltip
- AI feedback panel positioning relative to anchor counter

### 4.2 Research Mode

User states a research question or thesis. Each page consolidation is evaluated against it (supports / contradicts / adds nuance). Synthesis panel at end aggregates cross-page signal.

**Implementation:** New `/api/research` endpoint, `promptResearch.txt`, synthesis UI. Token cost: 3.

**Status:** Deferred — post-launch unless owner decides it is MVP.

### 4.3 Importer and Parser Improvements

#### TOC Capture Consistency
Fallback when TOC yields fewer than 3 items: segment by `<h1>`/`<h2>` heading density in spine HTML. Preserve heading tags during extraction. Test against: standard commercial EPUB, Project Gutenberg EPUB, academic textbook EPUB, flat single-spine EPUB.

#### Text Source Stress Testing
Three paste tests: (1) raw Wikipedia article, (2) PDF copy-paste with mid-sentence line breaks, (3) markdown chapter with headings. Fix normalization gaps.

#### Live Preview Segmentation
Wire the page size select in the Advanced panel to re-run segmentation and update the preview pane on change. User sees actual output before committing.

### 4.4 Referral Mechanics

"Share with a classmate — you both get 1 month Paid free." Referral codes generated per user, tracked in Supabase. Stripe handles credit application.

### 4.5 UX Backlog

| Item | Notes |
|---|---|
| Page turn sound on autoplay | Silent on auto-advance. Should fire same as manual Next. |
| Autoplay into comprehension mode | Auto-advance should focus the next consolidation box. |
| TOC section capture consistency | Also tracked in 4.3. |
| Text source stress testing | Also tracked in 4.3. |

---

## 5. Feedback and Analytics

### 5.1 Feedback Channel (ship in Phase 0)

Must be live before the first user arrives. Without it 50% of launch value is lost.

**Minimum viable:** one channel, one day to set up.

| Option | Effort | Notes |
|---|---|---|
| Email link in footer | 5 min | Always works, lowest friction |
| Google Form | 30 min | Structured, easy to review |
| Discord server | 1 hour | Community building, ongoing conversation — best for students |
| Tally / Typeform | 30 min | Polished, free tier sufficient |

**Recommendation:** Email link on day one (zero friction). Add a Discord server within the first week if any user engagement materializes. A Discord lets students talk to each other — that compounds.

In-app: a "Send Feedback" link in the footer. One line. Points to whichever channel is live.

**Owner action:** Decide channel and set it up.

### 5.2 Analytics (ship in Phase 0)

**Method:** PostHog — open source, free tier, product analytics purpose-built for this use case.

**Events to capture at launch:**

| Event | Why |
|---|---|
| `document_uploaded` | Are users getting content in? |
| `tts_started` | Are users listening or just looking? |
| `page_advanced` | Are sessions progressing? |
| `session_completed` | Full read-through rate |
| `upgrade_prompt_shown` | Conversion exposure |
| `upgrade_clicked` | Conversion intent |
| `feedback_link_clicked` | Engagement signal |

### 5.3 Diagnostics

The `?debug=1` panel and `lastAIDiagnostics` state are already implemented. Add a "Send diagnostics" button that packages current state and opens a pre-filled email or form submission. Low effort, high value for debugging user-reported issues.

---

## 6. Discoverability

### 6.1 Must Have Before Any Traffic

- **Shareable access point:** web app URL (already live on GitHub Pages). Sufficient for launch — works on every platform.
- **Positioning copy:** headline and sub-line from Section 1.2, visible before the user interacts with anything.
- **Feedback channel:** from Section 5.1.

### 6.2 Minimal Landing Page (Phase 0)

Not a full site. One page. 2 hours to build.

**Structure:**
1. Headline
2. One-sentence sub-line
3. "Try it free" CTA → links to the app
4. Optional: single screenshot or 15-second screen recording

**Build options:** Carrd ($19/year, fastest for non-technical setup), plain HTML page on the same GitHub Pages repo, or Notion published publicly.

**Owner action:** Decide build method. Provide headline copy (from Section 1.2).

### 6.3 App Store Listings (Phase 1)

Required for iOS and Google Play. Not blocking web launch.

**ASO:**
- Category: Education
- Keywords: reading comprehension, active reading, study tool, TTS reader, book reader student
- Screenshots: document loaded → TTS playing → page navigation
- Description: positioning statement first, feature list second

**Owner action:** Apple Developer account ($99/year), Google Play Developer account ($25 one-time).

---

## 7. Initial Traffic — Full Channel List

Do not run paid ads until the feedback channel is live and at least 5 real users have given feedback.

### Tier 1 — Free, Fast, High Signal

| Channel | Approach |
|---|---|
| **Reddit** | r/studytips, r/college, r/productivity, r/slatestarcodex. Lead with the problem. "Built a tool for getting through assigned reading — curious if it's useful." Not a sales post. |
| **Discord / Slack communities** | Study servers, college Discord servers, edtech Slack groups. DM moderators first if the server has self-promotion rules. |
| **University forums / student portals** | School subreddits (r/uofT, r/stanford, etc.), university Facebook groups, campus forums. Students share tools constantly in these spaces. |
| **Direct — friends and peers** | Email or message 20 people personally. Ask them to try it and tell you one thing that confused them. Personal asks convert 10x better than public posts. |
| **Product Hunt** | Submit Tuesday morning (peak traffic). Write a maker post explaining the problem. Rally upvotes on launch day. |
| **Hacker News** | "Show HN: I built a reading trainer for students." HN is skeptical but if it is useful they engage seriously — can drive thousands of visits in a day. |

### Tier 2 — Free, Compound Over Time

| Channel | Approach |
|---|---|
| **Twitter / X** | Post the problem, not the product. Thread on why students avoid assigned reading → app as the answer at the end. Engage with study and productivity accounts. |
| **LinkedIn** | Target teachers and professors. "Built this for my students" framing. Educators share tools with their classes. |
| **Medium / Substack** | One article: "I built a tool to get through your reading list — here's what I learned." SEO compounds slowly but the article is a permanent asset. |
| **YouTube / TikTok** | One short screen recording: upload a textbook chapter, hit play, listen. No editing. Caption: "This is how I'm getting through my reading list." Student content spreads fast on TikTok. |

### Tier 3 — Paid (only after feedback loop is working)

| Channel | Approach |
|---|---|
| **Google UAC** | Universal App Campaigns. Start $10/day. Optimize on activation (TTS started), not installs. |
| **Apple Search Ads** | Target: "reading app student", "pdf reader TTS", "study tool". High intent. |
| **Reddit Ads** | Target r/college, r/studytips. Low CPM, high audience fit. |
| **TikTok Ads** | Promote the organic video if it gains any traction. |

### Referral / Invite Mechanics (Phase 1)

"Share with a classmate — you both get 1 month Paid free." Referral codes per user, tracked in Supabase, Stripe credit applied automatically. Implement as soon as auth layer is stable.

---

## 8. Monetization

### 8.1 Subscription Pricing

| Tier | Price | Monthly Tokens | Daily Cap | Features |
|---|---|---|---|---|
| Free | $0 | 100 | 50 | Reading mode, browser TTS, progress memory |
| Paid | $6/month | 1,000 | 500 | Comprehension mode, cloud TTS |
| Premium | $14/month | 10,000 | 2,000 | All modes, all voices, Research mode |

**Gate logic:** Free is immediately usable. Upgrade prompts appear contextually. No hard walls before value is experienced.

### 8.2 Institutional / Schools (Phase 2)

Offer: $3/student/month billed annually. Minimum cohort: 20 seats.

Requires: teacher dashboard, bulk seat management, Google Workspace SSO, invoice billing.

Outreach: cold email to reading specialists and curriculum directors. Offer a 30-day free cohort pilot. One case study is the primary sales asset.

### 8.3 Advertising

Google AdSense banner below page content, Free tier only. Never inside the reading or consolidation flow. Removed on upgrade.

### 8.4 API Licensing (Phase 2)

Developer API key tier, usage-based billing via Stripe metered pricing. Targets: browser extension developers, LMS plugin builders, writing tools.

---

## 9. IP Protection

### 9.1 Code Obfuscation

Add `terser` + `javascript-obfuscator` as a build step, applied to all frontend JS before deployment.

### 9.2 Copyright Registration

File with US Copyright Office (~$65, form TX). Establishes legal standing, backdates to submission.

**Owner action:** File at copyright.gov.

### 9.3 Trademark

Register app name at USPTO, Class 41 (education and training services). ~$250–350. File early — priority is from filing date.

**Owner action:** File at USPTO.gov or engage trademark attorney (~$500–800 total).

### 9.4 Terms of Service and Privacy Policy

Generate via Termly or Iubenda. Must include: prohibition on reverse engineering, acceptable use, data handling and retention.

**COPPA note:** If under-13 users are in scope (likely for school tier), COPPA compliance is required — no behavioral advertising to minors, explicit parental consent. Flag for legal review before institutional tier launches.

### 9.5 Trade Secrets

Prompt contracts, anchor evaluation logic, and session persistence model are server-side, not in a public repo. Keep them there.

---

## 10. Platform Rollout

### 10.1 PWA (Phase 0)

Add `manifest.json` and service worker. App becomes installable on iOS, Android, and desktop from the browser. Zero app code changes.

**Tasks:** `manifest.json` with name, icons, theme, standalone display mode. Minimal service worker: cache shell, offline fallback. `<link rel="manifest">` in `index.html`.

**Owner action:** Provide 192×192 and 512×512 PNG icon assets.

### 10.2 iOS and Android (Phase 2)

**Method:** Capacitor — wraps existing web app as native iOS/Android shell. No rewrite. CI via GitHub Actions + Fastlane.

**Owner action:** Apple Developer account ($99/year), Google Play Developer account ($25 one-time).

### 10.3 Desktop (Phase 2)

**Method:** Tauri — native desktop wrapper using system webview. Windows, macOS, Linux. Same codebase.

---

## 11. Open Questions

| # | Question | Raised | Resolved |
|---|---|---|---|
| 1 | Is Research mode required for MVP or deferred to Phase 2? | Launch planning | ⬜ |
| 2 | What is the final app name for trademark and store listings? | Launch planning | ⬜ |
| 3 | COPPA compliance required? Confirm whether under-13 users are in scope at launch. | Launch planning | ⬜ |
| 4 | Minimum institutional cohort size for school license. | Launch planning | ⬜ |
| 5 | Icon assets — 192×192 and 512×512 PNG needed for PWA manifest. | Launch planning | ⬜ |
| 6 | Feedback channel decision — email, Google Form, or Discord? | Launch planning | ⬜ |
| 7 | Landing page — GitHub Pages alongside the app, or separate (Carrd)? | Launch planning | ⬜ |

---

## 12. Runtime Observations

Populated from live testing. Each entry triggers a plan revision.

| Date | Platform | Area | Observation | Resolution |
|---|---|---|---|---|
| — | — | — | — | — |

---

## 13. Revision Log

| Date | Change | Reason |
|---|---|---|
| 2026-03-17 | Document created | Initial launch planning session |
| 2026-03-17 | Full revision | Market research incorporated (Duolingo, Speechify). Value prop reframed to friction-removal for MVP. Target audience narrowed to students. Monetization gate changed to soft post-value prompt. Full traffic channel list added. Feedback and analytics sections added. |
| 2026-03-17 | Checklist restructured into 7 sequential blocks with Built / Validated columns | Needed to be executable and validatable in dependency order, not just a reference list |
