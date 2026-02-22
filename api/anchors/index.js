// api/anchors/index.js
// Generate a small set of "core anchors" per page for UI guidance (coverage bar + 2s hint).
// Anchors are NOT used for scoring; they are just stable, verbatim substrings from the passage.

import { json, withCors, readJsonBody } from "../_lib/http.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

function buildAnchorMessages(pageText, anchorsPerPage) {
  const n = Math.max(3, Math.min(10, Number(anchorsPerPage) || 5));
  return [
    {
      role: "system",
      content:
        "You extract a minimal set of core anchors from a passage for a reading trainer UI. " +
        "Anchors must be short, meaningful, and VERBATIM substrings from the passage (exact characters). " +
        "Return only JSON.",
    },
    {
      role: "user",
      content:
        `PASSAGE:\n${pageText}\n\nTASK:\n` +
        `Return a JSON array of exactly ${n} strings.\n` +
        `Each string MUST appear verbatim in the passage (exact substring).\n` +
        `Pick the most important core ideas/mechanisms/outcomes/constraints.\n` +
        `Keep each string as short as possible while still meaningful (prefer 6–14 words).\n` +
        `No numbering, no extra keys, no commentary.\n\n` +
        `Example output:\n["time is short, and time is money","selecting the right path can be a course in itself", ...]`,
    },
  ];
}

function safeParseJsonArray(text) {
  try {
    const t = String(text || "").trim();
    const parsed = JSON.parse(t);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    // Try to salvage the first [...] block.
    const m = String(text || "").match(/\[[\s\S]*\]/);
    if (!m) return null;
    try {
      const parsed = JSON.parse(m[0]);
      return Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }
}

function dedupeKeepOrder(list) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const t = String(s || "").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

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
    const pages = Array.isArray(body?.pages) ? body.pages : [];
    const anchorsPerPage = Number(body?.anchorsPerPage) || 5;

    if (!pages.length) {
      return json(res, 400, { error: "Missing pages[]" });
    }

    if (!process.env.GROQ_API_KEY) {
      return json(res, 500, { error: "Missing GROQ_API_KEY env var" });
    }

    const results = [];
    for (const p of pages) {
      const pageIndex = Number(p?.pageIndex);
      const pageText = String(p?.pageText ?? "").trim();
      if (!pageText || Number.isNaN(pageIndex)) {
        results.push({ pageIndex, anchors: [] });
        continue;
      }

      const messages = buildAnchorMessages(pageText, anchorsPerPage);
      const upstream = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.2 }),
      });

      const rawText = await upstream.text();
      if (!upstream.ok) {
        results.push({ pageIndex, anchors: [] });
        continue;
      }

      const data = JSON.parse(rawText);
      const modelText = data?.choices?.[0]?.message?.content ?? "";
      const arr = safeParseJsonArray(modelText) || [];

      // Validate: keep only verbatim substrings.
      const cleaned = dedupeKeepOrder(arr)
        .map((s) => String(s || "").trim())
        .filter((s) => s && pageText.includes(s));

      // If model failed to provide enough valid anchors, fall back to fewer.
      results.push({ pageIndex, anchors: cleaned.slice(0, Math.max(1, anchorsPerPage)) });
    }

    return json(res, 200, { pages: results });
  } catch (e) {
    return json(res, 500, { error: "Anchors generation failed", detail: String(e?.message || e) });
  }
}
