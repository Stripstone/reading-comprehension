// api/_lib/anchors.js
import crypto from "node:crypto";

export const ANCHOR_VERSION = 1;

// Conservative caps to keep UI stable.
const MAX_QUOTE_LEN = 220;
const MAX_TERMS = 6;
const MAX_TERM_LEN = 36;

export function sha256Hex(text) {
  const h = crypto.createHash("sha256");
  h.update(String(text ?? ""), "utf8");
  return h.digest("hex");
}

function stripCodeFences(s) {
  let t = String(s ?? "").trim();
  // Remove ```json ... ``` wrappers if present.
  t = t.replace(/^```[a-zA-Z]*\s*/i, "").replace(/```\s*$/i, "");
  return t.trim();
}

function extractFirstJsonObject(text) {
  const t = stripCodeFences(text);
  // Fast path: already looks like JSON.
  if (t.startsWith("{") && t.endsWith("}")) return t;

  // Best-effort: find the first balanced {...} block.
  const start = t.indexOf("{");
  if (start === -1) return "";
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return "";
}

function normalizeTerm(x) {
  const t = String(x ?? "").trim();
  if (!t) return "";
  // Keep terms simple and UI-safe.
  const cleaned = t
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-*•\u2022]\s+/, "")
    .trim();
  if (!cleaned) return "";
  return cleaned.slice(0, MAX_TERM_LEN);
}

function normalizeQuote(x) {
  let q = String(x ?? "").trim();
  if (!q) return "";
  // Strip wrapping quotes and leading bullets.
  q = q.replace(/^[-*•\u2022]\s+/, "");
  q = q.replace(/^[\"'“”‘’]+/, "").replace(/[\"'“”‘’]+$/, "");
  q = q.replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return "";
  return q.slice(0, MAX_QUOTE_LEN);
}

// Find an exact substring in pageText, with mild tolerance:
// - allow case-insensitive matching
// - allow dropping trailing punctuation in the quote
// Returns the exact matched substring from pageText, or "".
function findQuoteInPage(pageText, quote) {
  const page = String(pageText ?? "");
  const q = String(quote ?? "");
  if (!page || !q) return "";

  // 1) Exact match
  let idx = page.indexOf(q);
  if (idx !== -1) return page.slice(idx, idx + q.length);

  // 2) Case-insensitive match, then return the exact substring
  const pl = page.toLowerCase();
  const ql = q.toLowerCase();
  idx = pl.indexOf(ql);
  if (idx !== -1) return page.slice(idx, idx + q.length);

  // 3) Strip trailing punctuation and retry
  const stripped = q.replace(/[!?.:,;]+$/, "").trim();
  if (stripped && stripped !== q) return findQuoteInPage(page, stripped);

  return "";
}

function stableAnchorId(i) {
  // Deterministic IDs based on normalized ordering.
  return `a${i + 1}`;
}

// Core contract: LLM proposes, backend normalizes/dedupes/validates.
// Throws an Error with .details for structured error responses.
export function normalizeAnchors({ pageText, modelText, maxAnchors = 5 } = {}) {
  const page = String(pageText ?? "");
  const cap = Math.max(1, Math.min(12, Number(maxAnchors) || 5));

  const jsonStr = extractFirstJsonObject(modelText);
  if (!jsonStr) {
    const err = new Error("Invalid anchor output");
    err.details = {
      reason: "no_json_object",
      modelTextPreview: String(modelText ?? "").slice(0, 400),
    };
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    const err = new Error("Invalid anchor output");
    err.details = {
      reason: "json_parse_error",
      message: String(e?.message ?? e),
      jsonPreview: jsonStr.slice(0, 400),
    };
    throw err;
  }

  const arr = Array.isArray(parsed?.anchors) ? parsed.anchors : null;
  if (!arr) {
    const err = new Error("Invalid anchor output");
    err.details = { reason: "missing_anchors_array", parsedType: typeof parsed };
    throw err;
  }

  // Normalize items.
  const raw = arr.slice(0, Math.max(0, cap * 3)); // allow extra for dedupe
  const seen = new Set();
  const out = [];

  for (let i = 0; i < raw.length; i++) {
    const it = raw[i] ?? {};
    const quote = normalizeQuote(it.quote ?? it.snippet ?? it.text ?? "");
    if (!quote) continue;

    const matched = findQuoteInPage(page, quote);
    if (!matched) continue;

    // Terms
    const termsIn = Array.isArray(it.terms) ? it.terms : [];
    const terms = [];
    for (const t of termsIn) {
      const nt = normalizeTerm(t);
      if (!nt) continue;
      if (terms.length >= MAX_TERMS) break;
      if (!terms.includes(nt)) terms.push(nt);
    }

    // Weight (optional). Keep it small.
    let weight = Number(it.weight);
    if (!Number.isFinite(weight)) weight = 1;
    weight = Math.max(1, Math.min(3, Math.round(weight)));

    const key = matched.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      // temporary id; finalized after ordering
      id: "",
      quote: matched,
      terms,
      weight,
      _rank: i, // preserve model rank as a tie-breaker
    });
  }

  if (out.length === 0) {
    const err = new Error("Invalid anchor output");
    err.details = {
      reason: "no_valid_anchors",
      note: "All candidates failed substring/normalization constraints.",
    };
    throw err;
  }

  // Deterministic ordering: earlier appearance in pageText, then longer quote, then model rank.
  const indexed = out
    .map((a) => {
      const idx = page.indexOf(a.quote);
      return { ...a, _idx: idx === -1 ? 1e9 : idx };
    })
    .sort((a, b) => {
      if (a._idx !== b._idx) return a._idx - b._idx;
      if (b.quote.length !== a.quote.length) return b.quote.length - a.quote.length;
      return a._rank - b._rank;
    })
    .slice(0, cap);

  // Finalize ids and remove internal fields.
  return indexed.map((a, i) => ({
    id: stableAnchorId(i),
    quote: a.quote,
    terms: a.terms,
    weight: a.weight,
  }));
}
