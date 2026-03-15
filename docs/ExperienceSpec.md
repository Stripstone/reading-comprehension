# Reading Trainer — Experience Spec

This document defines how the application should feel and behave from the user's perspective.

It is the reference for development decisions. When a runtime observation suggests something should work differently, this document is updated first — then code follows.

Engineers should implement to this spec. If a user experience suggestion contradicts it, raise it — don't silently ignore it, and don't silently implement it. The spec exists to be updated deliberately.

---

## 1. The Core Experience

Reading Trainer is a reading comprehension training system. The simplest description:

> "Duolingo for reading."

It trains readers to identify and articulate the core idea of a passage in their own words. It is not a summarizer, not a tutor, and not a book analysis tool.

Every session follows a single repeating loop:

```
Read → Consolidate → Discover Anchors → Feedback → Continue
```

Each step should feel purposeful and low-friction. The user should never feel lost about what to do next.

---

## 2. Application Modes

Three modes exist. Mode is selected via a dropdown and persisted across sessions.

### Reading Mode

The simplest mode. The reader reads and listens. No consolidation, no evaluation.

**What the user sees:** passage text and a Read Page button per page. All evaluation UI is hidden.

**Feel:** clean, distraction-free. Like opening a book. Nothing asks anything of the reader except to read.

**Navigation:** the Next button scrolls to the next page. No text field to focus.

### Comprehension Mode

The full training loop. This is the primary mode.

**What the user sees:** passage, Read Page button, anchor counter, Hint button, Consolidation Box, timer, character counter, compass stars, AI Evaluate button.

**Feel:** structured but not clinical. The reader should feel like they are being gently tested, not graded. Each page is a small challenge with a clear resolution.

**Navigation:** the Next button scrolls to the next page and focuses its Consolidation Box.

### Thesis Mode *(future)*

Tracks an argument across multiple pages. Not yet implemented.

---

## 3. The Reading Loop — Behavioral Expectations

### Reading a Page

The reader reads the passage. Audio narration is optional and non-blocking. The reader can begin consolidating at any time — there is no enforced reading gate.

TTS should feel like an assistant, not a distraction. It starts when requested and stops cleanly. Sentence highlighting follows audio in real time.

### Consolidating

The Consolidation Box is the most important element on the page. It should be the natural next place the user looks after reading.

- The box should feel open and inviting, not pressured.
- The timer and character counter provide pacing guidance but should not feel punishing.
- Sandstone (time expiry) is a consequence, not the point. It should be obvious what happened but not demoralizing.

### Discovering Anchors

Anchor discovery is the primary feedback mechanic — not a supplement to AI, but the core signal of whether a reader understood the page.

- Anchors light up as the reader writes. This is the main loop reward.
- These moments should feel like small wins, not scoring events.
- The Hint button reveals anchors when the reader is stuck. It should feel like asking for a nudge, not admitting defeat.
- A reader who captures all anchors without using AI evaluation has fully succeeded.

### Feedback

AI feedback supports anchor discovery — it does not replace it. The anchor count is the lead signal. AI adds texture and a suggested example.

Feedback should feel like a reading partner responding, not a grade being issued.

- Lead with what the reader got right, anchored in what they captured.
- One main thing to improve, stated plainly.
- Benefit of the doubt on minor errors — close is close enough.
- The "better consolidation" example should feel instructive, not corrective.
- The lead-in phrase before the better example should be read aloud by TTS when the reader uses the Read button on feedback.

### Continuing

After feedback, the reader moves to the next page. This transition should feel natural and lightweight — scroll, land, read again.

---

## 4. Navigation

### Next Button

- In **Reading mode**: scrolls to the next page.
- In **Comprehension mode**: scrolls to the next page, then focuses its Consolidation Box.
- In **Evaluation phase** (all pages consolidated): scrolls to the next page without focusing any input.
- At the last page: wraps to the top.

The page should always arrive in view before any input is focused. Focus should never pull the user to an off-screen element.

### Keyboard

- **Enter** (when not in a textarea): advances to the next consolidation box.
- **Escape** (when in a textarea): exits the textarea.

---

## 5. Audio and TTS

Audio narration is an engagement tool. It should be reliable and unintrusive.

- Playback starts only on explicit user action (tap or click).
- A countdown between pages gives the reader a moment before autoplay continues.
- Cancelling autoplay during the countdown should feel immediate and clean.
- Audio continues when the user switches tabs. It stops on navigation away.

### Platform Notes

**Safari / iOS / iPadOS:**
Safari enforces a strict gesture requirement for audio. Any audio play call must originate from a direct user interaction event — a tap or click that has not been deferred beyond the current event handler. This applies to both initial playback and autoplay continuation.

The existing Safari fix pre-fetches and pre-loads the next page's Polly audio during the countdown (while the audio context is still active from the previous user gesture) so that `play()` on the pre-loaded element is treated as a resume rather than a cold start. Any new audio-triggering logic must follow the same pattern — never call `play()` outside of an active user gesture context on Safari.

Known edge cases to watch:
- Autoplay triggering after a mode switch may lose gesture context.
- Background tab returning on iOS may require a fresh gesture before audio resumes.
- Volume panel interactions on iPad may not count as gesture context for audio purposes.

---

## 6. Tier System

Three tiers exist: **Free**, **Paid**, and **Premium**. Tier controls which features are accessible and how many tokens a user receives.

### What Tokens Are

Tokens are consumption units spent on cost-bearing actions:

- **TTS pages** — each page narrated via Polly costs tokens
- **AI interactions** — each evaluate, anchor generation, or summary costs tokens
- **Book uploads** — each book added to the library costs tokens

Tokens are not a score or a reward. They are a sustainability mechanism to keep API costs covered at scale. Each tier comes with a monthly token allowance. Users can purchase refill packs when they run out.

| Tier | Monthly Tokens | Key Access |
|---|---|---|
| Free | Small (e.g. 20–50) | Reading mode, limited TTS (1–3 pages), limited AI feedback, 1 upload |
| Paid | Mid (e.g. 500–1000) | All modes, TTS with token cost per page, core AI features, more uploads |
| Premium | Large (e.g. 10,000+) | Full access, all voices, generous TTS cap, unlimited uploads |

### Prototype Behavior

During testing, tier selection is functional — it changes feature access in the UI — but no payment is enforced and **tokens do not run out**. This allows all features to be tested at any tier without restriction.

The tier selector is visible in the top controls. Switching tiers takes effect immediately without a page reload.

Payment processing and token enforcement will be wired in after the prototype is validated.

### Debug Mode (`?debug=1`)

When the URL contains `?debug=1`, the app enters development environment mode. In addition to existing diagnostics, debug mode exposes:

- A **token counter** visible in the top-right of the viewport, showing tokens consumed this session by category (TTS, AI, uploads)
- The **active tier** displayed alongside the counter
- Any additional diagnostic overlays relevant to the current session

The token counter in debug mode is always live and unrestricted — it shows consumption without enforcing limits, so all features remain testable.

---

## 7. Feedback Quality Standards

These are the behavioral standards AI feedback must meet. Prompt changes should be evaluated against them.

- **Short.** One observation, one suggestion. Not a report.
- **Fair.** Anchor count is the primary signal. If anchors are captured, the consolidation succeeded.
- **Benefit of the doubt.** Minor naming errors, small intent slips, close paraphrases — treat as correct.
- **Encouraging.** The tone is a reading partner, not an examiner.
- **Bounded.** AI only references the passage. No outside knowledge introduced.
- **Character-aware.** The "better consolidation" example should respect the configured character limit.

---

## 8. Platform Targets

The application is a responsive web app serving all platforms through the browser.

- Web (desktop and laptop)
- Tablet (iPad and Android tablets)
- Mobile (iOS and Android phones)

No native app is required at this stage.

Platform-specific behavior discovered at runtime should be documented in **SystemResponsibilitiesMap.md** under the relevant file's section, and referenced here if it affects the expected user experience.

---

## 9. Runtime Observations

*This section is populated from runtime testing. Each entry records what was observed, what the expected behavior is, and whether it resulted in a spec update or a bug fix.*

| Date | Platform | Observation | Resolution |
|---|---|---|---|
| 2026-03-15 | All | Tier selector visible but switching tiers had no effect on UI | Bug — `applyTierAccess()` ran before `render()` built the DOM. Fix: call after `render()` |
| 2026-03-15 | All | TTS Read on AI feedback did not speak lead-in phrase before better consolidation | Bug — lead-in string not included in `ttsSpeakQueue` parts array. Fix: add to parts |
| 2026-03-15 | All | Per-page read/consolidate/evaluate loop felt mechanical rather than rewarding | Spec update — anchors elevated to primary mechanic; AI repositioned as support signal |

---

## 10. Deferred

These are not current development concerns.

- Thesis Mode implementation
- Progress tracking and streaks
- Reader annotations
- Gamification
- Native mobile or desktop app
- Knowledge graphs
- Complex analytics
