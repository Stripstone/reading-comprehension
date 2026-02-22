// api/evaluate/index.js
import { buildPromptMessages } from "../_lib/prompt.js";
import {
  parseMultiCriteriaOutput,
  formatAs4Lines,
  isValid4LineFeedback,
  scoreToCompassRating,
} from "../_lib/grader.js";
import { json, withCors, readJsonBody } from "../_lib/http.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile"; // replacement model per Groq deprecations

export default async function handler(req, res) {
  const allowed = [
    "https://stripstone.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  if (withCors(req, res, allowed)) return;

  try {
    if (req.method !== "POST") {
      return json(res, 405, { error: "Method not allowed. Use POST." });
    }

    const body = await readJsonBody(req);
    const pageText = String(body?.pageText ?? "").trim();
    const userText = String(body?.userText ?? "").trim();
    const debug = String(body?.debug ?? "").trim() === "1" || body?.debug === true;

    if (!pageText || !userText) {
      return json(res, 400, { error: "Missing pageText/userText" });
    }

    if (!process.env.GROQ_API_KEY) {
      return json(res, 500, { error: "Missing GROQ_API_KEY env var" });
    }

    const messages = buildPromptMessages(pageText, userText);

    const upstream = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.3,
      }),
    });

    const rawText = await upstream.text();
    if (!upstream.ok) {
      return json(res, 502, { error: "Groq API error", detail: rawText });
    }

    const data = JSON.parse(rawText);
    const modelText = data?.choices?.[0]?.message?.content ?? "";

    let usedModelText = modelText;
    let retryOutput = "";

    let finalParsed = parseMultiCriteriaOutput(modelText);
    let feedback = formatAs4Lines(finalParsed);

    if (!isValid4LineFeedback(feedback)) {
      const retry = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: 0.3,
        }),
      });

      const retryText = await retry.text();
      if (retry.ok) {
        const retryData = JSON.parse(retryText);
        retryOutput = retryData?.choices?.[0]?.message?.content ?? "";
        const parsed2 = parseMultiCriteriaOutput(retryOutput);
        const feedback2 = formatAs4Lines(parsed2);
        if (isValid4LineFeedback(feedback2)) {
          feedback = feedback2;
          finalParsed = parsed2;
          usedModelText = retryOutput;
        }
      }
    }

    // Highlights are a first-class feature (not diagnostics): used by the UI to visually
    // mark missed/weak core items directly in the passage text.
    //
    // Policy: keep highlights proportional to the compass rating with a small amount of leeway.
    // rating=5 -> 0-1 highlights
    // rating=4 -> 1-2 highlights
    // rating=3 -> 2-3 highlights
    // rating=2 -> 3-4 highlights
    // rating=1 -> 4-5 highlights
    const rating = scoreToCompassRating(finalParsed.overallScore);
    const missing = Math.max(0, 5 - rating);
    const maxHighlights = Math.min(5, missing + 1);

    const candidates = Array.isArray(finalParsed.highlightCandidates)
      ? finalParsed.highlightCandidates
      : [];

    const userTextLower = String(userText || "").toLowerCase();

    // Normalize a candidate line into a deterministic substring (strip decoration only).
    const normalizeSnippet = (s) => {
      let t = String(s ?? "").trim();
      if (!t) return "";
      if (/^NONE$/i.test(t)) return "";
      // Strip leading bullets
      t = t.replace(/^[-*•\u2022]\s+/, "");
      // Strip leading enumeration: 1. / 1) / (1)
      t = t.replace(/^\(?\d+\)?[.)]\s+/, "");
      // Strip wrapping quotes
      t = t.replace(/^[\"'“”‘’]+/, "").replace(/[\"'“”‘’]+$/, "");
      return t.trim();
    };

    const CATEGORY_PRIORITY = {
      MECHANISM: 1,
      CONSTRAINT: 2,
      GOAL: 3,
      DEFINITION: 4,
      OUTCOME: 5,
      FRAMING: 6,
      EXAMPLE: 7,
      UNKNOWN: 8,
    };

    const isStructural = (cat) =>
      ["MECHANISM", "CONSTRAINT", "GOAL", "DEFINITION", "OUTCOME"].includes(cat);

    // Try to find a match in pageText even if the model varies case or drops trailing punctuation.
    // Returns an object with { idx, len, matched } or null.
    const findInPage = (page, snip) => {
      if (!snip) return null;

      // 1) Exact match
      let idx = page.indexOf(snip);
      if (idx !== -1) return { idx, len: snip.length, matched: snip };

      // 2) Case-insensitive exact-length match
      const pageLower = page.toLowerCase();
      const snipLower = snip.toLowerCase();
      idx = pageLower.indexOf(snipLower);
      if (idx !== -1) {
        let len = snip.length;
        // Optionally include trailing punctuation if present in page
        const tail = page.slice(idx + len, idx + len + 1);
        if (tail && /[!?.:,;)]/.test(tail)) len += 1;
        const matched = page.slice(idx, idx + len);
        return { idx, len, matched };
      }

      // 3) Strip trailing punctuation from snippet and retry
      const stripped = snip.replace(/[!?.:,;]+$/, "").trim();
      if (stripped && stripped !== snip) return findInPage(page, stripped);

      return null;
    };

    // Sanitize, dedupe, and keep only candidates that match the pageText (with mild tolerance).
    const normalized = [];
    const seen = new Set();
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i] || {};
      const rawCategory = String(c.category || "UNKNOWN").toUpperCase().trim() || "UNKNOWN";
      const reason = String(c.reason || "").trim();
      const snip = normalizeSnippet(c.snippet ?? c);

      if (!snip) continue;
      const found = findInPage(pageText, snip);
      if (!found) continue;

      const matched = found.matched;
      const key = matched; // dedupe by matched text
      if (seen.has(key)) continue;

      seen.add(key);

      const category = CATEGORY_PRIORITY[rawCategory] ? rawCategory : "UNKNOWN";
      const redundant = userTextLower.includes(String(matched).toLowerCase());

      normalized.push({
        reason,
        category,
        snippet: matched,
        rank: i, // preserve model rank as a tie-breaker
        redundant,
      });
    }

    // Proportional bounds with small leeway (but we allow fewer highlights if the page truly has
    // fewer high-quality structural anchors).
    const minHighlights = missing; // rating=5 => 0, rating=4 => 1, ...
    const maxAllowed = Math.min(5, missing + 1);

    // Ranking: prefer structural categories, then non-structural; avoid redundancy unless needed.
    const sortKey = (x) => {
      const p = CATEGORY_PRIORITY[x.category] ?? 99;
      return [p, x.rank];
    };

    const preferred = normalized
      .filter((x) => x.category !== "EXAMPLE")
      .sort((a, b) => {
        const [pa, ra] = sortKey(a);
        const [pb, rb] = sortKey(b);
        if (pa !== pb) return pa - pb;
        return ra - rb;
      });

    const examples = normalized
      .filter((x) => x.category === "EXAMPLE")
      .sort((a, b) => a.rank - b.rank);

    // Helper: push candidates up to cap, optionally skipping redundant.
    const chosen = [];
    const already = new Set();
    const pushFrom = (arr, cap, allowRedundant) => {
      for (const it of arr) {
        if (chosen.length >= cap) break;
        if (already.has(it.snippet)) continue;
        if (!allowRedundant && it.redundant) continue;
        chosen.push(it);
        already.add(it.snippet);
      }
    };

    // 1) Fill with non-redundant, structural-preferred up to maxAllowed.
    pushFrom(preferred, maxAllowed, false);

    // 2) If we are below minHighlights, allow non-redundant EXAMPLE to top up.
    if (chosen.length < minHighlights) {
      pushFrom(examples, Math.min(maxAllowed, minHighlights), false);
    }

    // 3) If still below minHighlights, allow redundant items (last resort) from preferred then examples.
    if (chosen.length < minHighlights) {
      pushFrom(preferred, Math.min(maxAllowed, minHighlights), true);
    }
    if (chosen.length < minHighlights) {
      pushFrom(examples, Math.min(maxAllowed, minHighlights), true);
    }

    // 4) For perfect score, prefer 0 highlights; only include 1 if it's non-redundant.
    let final = chosen;
    if (rating === 5) {
      // Keep at most 1, and only if it wasn't redundant.
      final = chosen.filter((x) => !x.redundant).slice(0, 1);
    }

    const clamped = final.map((x) => x.snippet);


    const out = {
      feedback,
      highlights: {
        rating,
        snippets: clamped,
      },
    };
    if (debug) {
      out.debug = {
        model: MODEL,
        raw_model_output: String(usedModelText || ""),
        first_model_output: String(modelText || ""),
        retry_model_output: String(retryOutput || ""),
      };
    }
    return json(res, 200, out);
  } catch (err) {
    return json(res, 500, { error: "Server error", detail: String(err) });
  }
}
