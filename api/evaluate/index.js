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

    // Normalize a candidate line into a deterministic, matchable substring.
    const normalizeSnippet = (s) => {
      let t = String(s ?? "").trim();
      if (!t) return "";
      if (/^NONE$/i.test(t)) return "";
      // Strip leading bullets
      t = t.replace(/^[-*•\u2022]\s+/, "");
      // Strip leading enumeration: 1. / 1) / (1)
      t = t.replace(/^\(?\d+\)?[.)]\s+/, "");
      // Strip wrapping quotes
      t = t.replace(/^["'“”‘’]+/, "").replace(/["'“”‘’]+$/, "");
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

    // Sanitize, dedupe, and keep only candidates that match the exact pageText.
    const normalized = [];
    const seen = new Set();
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i] || {};
      const category = String(c.category || "UNKNOWN").toUpperCase().trim() || "UNKNOWN";
      const reason = String(c.reason || "").trim();
      const snip = normalizeSnippet(c.snippet ?? c);

      if (!snip) continue;
      if (seen.has(snip)) continue;
      if (!pageText.includes(snip)) continue;

      seen.add(snip);
      normalized.push({
        reason,
        category: CATEGORY_PRIORITY[category] ? category : "UNKNOWN",
        snippet: snip,
        rank: i, // preserve model rank as a tie-breaker
      });
    }

    // Enforce proportional bounds with a small amount of leeway:
    // rating=5 -> 0-1 highlights
    // rating=4 -> 1-2 highlights
    // rating=3 -> 2-3 highlights
    // rating=2 -> 3-4 highlights
    // rating=1 -> 4-5 highlights
    const minHighlights = missing; // rating=5 => 0, rating=4 => 1, ...
    const maxAllowed = Math.min(5, missing + 1);

    // Prefer mechanism/constraint/goal/etc over example; only use EXAMPLE to meet minimum if needed.
    const sortedPreferred = normalized
      .filter((x) => x.category !== "EXAMPLE")
      .sort((a, b) => {
        const pa = CATEGORY_PRIORITY[a.category] ?? 99;
        const pb = CATEGORY_PRIORITY[b.category] ?? 99;
        if (pa !== pb) return pa - pb;
        return a.rank - b.rank;
      });

    const sortedExamples = normalized
      .filter((x) => x.category === "EXAMPLE")
      .sort((a, b) => a.rank - b.rank);

    const chosen = [];
    const pushUpTo = (arr, cap) => {
      for (const it of arr) {
        if (chosen.length >= cap) break;
        chosen.push(it);
      }
    };

    // First fill from preferred up to maxAllowed.
    pushUpTo(sortedPreferred, maxAllowed);

    // If we still haven't met the minimum, top up from EXAMPLE candidates.
    if (chosen.length < minHighlights) {
      pushUpTo(sortedExamples, Math.min(maxAllowed, minHighlights));
    }

    // If we still have room (and the model provided extra preferred), allow leeway up to maxAllowed.
    if (chosen.length < maxAllowed) {
      // Add remaining preferred not already included (by rank order).
      const already = new Set(chosen.map((x) => x.snippet));
      for (const it of sortedPreferred) {
        if (chosen.length >= maxAllowed) break;
        if (already.has(it.snippet)) continue;
        chosen.push(it);
      }
    }

    const clamped = chosen.map((x) => x.snippet);


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
