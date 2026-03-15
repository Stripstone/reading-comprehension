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

Anchor discovery is a micro-reward mechanic. When the reader's consolidation captures a key idea from the passage, an anchor lights up.

- These moments should feel like small wins, not scoring events.
- The Hint button reveals anchors when the reader is stuck. It should feel like asking for a nudge, not admitting defeat.

### Feedback

Feedback should feel like a reading partner responding, not a grade being issued.

- Lead with what the reader got right.
- One main thing to improve, stated plainly.
- Benefit of the doubt on minor errors — close is close enough.
- The "better consolidation" example should feel instructive, not corrective.

AI feedback is secondary to anchor discovery. A reader who captures all anchors but skips AI evaluation has still succeeded.

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

Three tiers exist: **Free**, **Paid**, and **Premium**. Tier controls which features are accessible.

| Tier | Key Access |
|---|---|
| Free | Basic reading, limited AI feedback, limited TTS, 1 library upload |
| Paid | Core AI features, TTS with token cost, more uploads |
| Premium | Full AI feedback, multiple voices, generous TTS, unlimited uploads |

### Prototype Behavior

During testing, tier selection is functional — it changes feature access in the UI — but no payment is enforced and usage is unrestricted. This allows all features to be tested regardless of tier.

The tier selector should be accessible from settings or a visible control. Switching tiers should take effect immediately without a page reload.

Payment processing will be wired in after the prototype is validated.

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
| — | — | — | — |

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
