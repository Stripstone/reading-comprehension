# Anchors Enhancement Design Document (v1)

## Overview

This document describes the design and implementation plan for the **Anchors Enhancement System** in the Reading Comprehension application.

Anchors are AI-generated **page-only core idea targets**. They are used to:

- Visually guide users toward the page’s core ideas
- Provide real-time feedback during consolidation writing
- Power the "Anchors Found: X/Y" progression indicator
- Support a Hint mechanism (2s fade in / 2s fade out)

This design assumes:

- Front-end hosted via **GitHub Pages** (static)
- Back-end APIs hosted via **Vercel** serverless functions
- Existing endpoints: `/api/evaluate`, `/api/summary`
- Existing debug convention: `?debug=1`

---

## Architectural Intent

The Anchors system must:

1. Be independent from grading (`/api/evaluate`)
2. Not interfere with the 4-line grading contract
3. Use deterministic UI matching (no UI inference)
4. Avoid duplicate AI processing via caching
5. Be fully debuggable using `?debug=1`

Anchors are **page-dependent only** (not user-dependent), which allows aggressive caching.

---

## Anchor lifecycle ownership (Hybrid)

**Decision:** Hybrid.

- The LLM proposes candidates.
- The backend enforces determinism and safety via `normalizeAnchors()`:
  - enforce JSON schema
  - ensure `quote` exists in `pageText` (exact substring; backend may case-match then rebind to the exact page substring)
  - dedupe by normalized quote
  - enforce max count, ordering, and length caps
  - reject malformed output with **structured error** (no silent fallback)

**Determinism nuance:** anchors are not guaranteed identical across time/providers when regenerated.

Determinism in UX comes from **caching + versioning**, not from expecting the LLM to reproduce identical output.

---

## Persistence model (Required)

**Decision:** Anchors must persist across refresh.

Primary storage:

- `localStorage` cache keyed by `pageHash`
- Value includes: `{ anchors, anchorVersion, createdAt }`

Flow:

1. Compute stable `pageHash` from `pageText`.
2. Check cache.
3. Cache hit → use anchors.
4. Cache miss → call `/api/anchors`, then cache.

---

## UI contract strictness

Anchors follow the same "hard contract" philosophy as evaluation, but as **strict JSON**, not a 4-line string.

Backend returns fully normalized anchor objects; UI only renders and deterministically matches.

---

## Data contract: `POST /api/anchors`

### Request

```json
{
  "pageText": "string (required)",
  "maxAnchors": 5,
  "debug": 1
}
```

### Success response

```json
{
  "anchors": [
    { "id": "a1", "quote": "exact substring", "terms": ["term"], "weight": 1 }
  ],
  "meta": { "pageHash": "...", "anchorVersion": 1 },
  "debug": { "...": "..." }
}
```

### Failure response

```json
{
  "error": "Invalid anchor output",
  "details": { "ok": false, "details": { "reason": "..." } },
  "meta": { "pageHash": "...", "anchorVersion": 1 },
  "debug": { "rawModelOutput": "..." }
}
```

No silent fallback.

---

## High-Level Flow

User clicks "Load Pages" or "Add Pages":

1. Front-end loads page text from static assets.
2. Front-end computes stable `pageHash`.
3. Front-end checks local cache for anchors.
4. If cache miss → call `/api/anchors`.
5. Server validates and returns anchor set.
6. UI renders anchors invisibly (opacity 0).
7. As user types consolidation:
   - Anchors are matched deterministically.
   - Matching anchors fade in.
   - Counter updates.

---

## Definition of Done

System is complete when:

- Anchors load automatically with page
- Counter updates live as user types
- Hint pulses correctly (2s in / 2s out)
- Reloading page uses cache
- No evaluation contract regression
- Debug mode traces anchor lifecycle
