// api/prepare/index.js
// Generates "Core Anchors" for each page (5 per page) used by the coaching layer.
// Returns verbatim snippets + small keyword lists. No scoring, no feedback.

import { buildPrepareMessages } from "../_lib/prompt.js";
import { json, withCors, readJsonBody } from "../_lib/http.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

function normalizeKeyword(w) {
  return String(w || "")
    .trim()
    .toLowerCase()
    .replace(/^[-*•\u2022]+\s+/, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[^a-z0-9\- ]+/g, "")
    .trim();
}

function ensureKeywords(snippet, keywords) {
  const out = [];
  const seen = new Set();

  const add = (k) => {
    const n = normalizeKeyword(k);
    if (!n) return;
    if (n.length < 3) return;
    if (seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };

  if (Array.isArray(keywords)) {
    for (const k of keywords) add(k);
  }

  // Fallback: derive keywords from snippet if the model forgot.
  if (out.length < 2) {
    const words = String(snippet || "")
      .toLowerCase()
      .replace(/[^a-z0-9\- ]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter((w) => w.length >= 4);
    for (const w of words.slice(0, 6)) add(w);
  }

  // Cap keywords to keep matching conservative and cheap.
  return out.slice(0, 6);
}

function cleanSnippet(s) {
  let t = String(s || "").trim();
  if (!t) return "";
  t = t.replace(/^[-*•\u2022]+\s+/, "");
  t = t.replace(/^\(?\d+\)?[.)]\s+/, "");
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  return t.trim();
}

function isVerbatimSubstring(pageText, snippet) {
  if (!pageText || !snippet) return false;
  return pageText.includes(snippet);
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
    const debug = String(body?.debug ?? "").trim() === "1" || body?.debug === true;

    const pagesIn = Array.isArray(body?.pages) ? body.pages : [];
    if (!pagesIn.length) {
      return json(res, 400, { error: "Missing pages[]" });
    }

    if (!process.env.GROQ_API_KEY) {
      return json(res, 500, { error: "Missing GROQ_API_KEY env var" });
    }

    // Process pages sequentially (5 anchors each). This keeps output stable and avoids giant prompts.
    const outPages = [];
    const debugPages = [];

    for (const p of pagesIn) {
      const pageIndex = Number(p?.pageIndex ?? -1);
      const pageText = String(p?.pageText ?? "").trim();

      if (!Number.isFinite(pageIndex) || pageIndex < 0) continue;
      if (!pageText) {
        outPages.push({ pageIndex, anchors: [] });
        continue;
      }

      const messages = buildPrepareMessages(pageText);

      const upstream = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: 0.2,
        }),
      });

      const rawText = await upstream.text();
      if (!upstream.ok) {
        return json(res, 502, { error: "Groq API error", detail: rawText });
      }

      const data = safeJsonParse(rawText);
      const modelText = data?.choices?.[0]?.message?.content ?? "";

      const parsed = safeJsonParse(modelText);
      const anchorsIn = Array.isArray(parsed?.anchors) ? parsed.anchors : [];

      // Sanitize anchors and enforce verbatim substrings.
      const anchorsOut = [];
      const seen = new Set();
      for (let i = 0; i < anchorsIn.length; i++) {
        const a = anchorsIn[i] || {};
        const snippet = cleanSnippet(a?.snippet ?? a);
        if (!snippet) continue;
        if (!isVerbatimSubstring(pageText, snippet)) continue;
        const key = snippet;
        if (seen.has(key)) continue;
        seen.add(key);
        const keywords = ensureKeywords(snippet, a?.keywords);
        anchorsOut.push({
          id: `a${i + 1}`,
          label: "Core Anchor",
          snippet,
          keywords,
        });
        if (anchorsOut.length >= 5) break;
      }

      // If the model returned fewer than 5 usable anchors, pad with safe fallbacks by sampling
      // a few strong clauses from the page (still verbatim). This keeps the UI consistent.
      if (anchorsOut.length < 5) {
        const clauses = pageText
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.trim())
          .filter((s) => s.length >= 18)
          .slice(0, 20);

        for (const c of clauses) {
          if (anchorsOut.length >= 5) break;
          const sn = cleanSnippet(c);
          if (!sn || sn.length > 140) continue;
          if (seen.has(sn)) continue;
          seen.add(sn);
          anchorsOut.push({
            id: `a${anchorsOut.length + 1}`,
            label: "Core Anchor",
            snippet: sn,
            keywords: ensureKeywords(sn, []),
          });
        }
      }

      outPages.push({ pageIndex, anchors: anchorsOut.slice(0, 5) });
      if (debug) {
        debugPages.push({
          pageIndex,
          raw_model_output: modelText,
          parsed,
          anchors_out: anchorsOut.slice(0, 5),
        });
      }
    }

    const resp = { pages: outPages };
    if (debug) resp.debug = { model: MODEL, pages: debugPages };

    return json(res, 200, resp);
  } catch (e) {
    return json(res, 500, { error: "Server error", detail: String(e?.message || e) });
  }
}
