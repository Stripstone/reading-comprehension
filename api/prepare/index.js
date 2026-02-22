// api/prepare/index.js
// Generates "Core Anchors" for a page: 5 structural snippets (verbatim substrings) + keywords.

import { json, withCors, readJsonBody } from "../_lib/http.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

function normalizeAnchor(a, fallbackId) {
  const snippet = String(a?.snippet ?? "").trim();
  const keywords = Array.isArray(a?.keywords)
    ? a.keywords.map((k) => String(k || "").trim()).filter(Boolean)
    : [];

  return {
    id: String(a?.id || fallbackId),
    snippet,
    keywords: keywords.slice(0, 8),
  };
}

export default async function handler(req, res) {
  const allowed = [
    "https://stripstone.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  if (withCors(req, res, allowed)) return;

  try {
    // Allow GET for quick diagnostics in-browser.
    if (req.method === "GET") {
      return json(res, 200, { ok: true, hint: "POST { pages:[{pageIndex,pageText}] }" });
    }

    if (req.method !== "POST") {
      return json(res, 405, { error: "Method not allowed. Use POST." });
    }

    const body = await readJsonBody(req);
    const pages = Array.isArray(body?.pages) ? body.pages : [];
    const debug = String(body?.debug ?? "").trim() === "1" || body?.debug === true;

    if (!pages.length) {
      return json(res, 400, { error: "Missing pages[]" });
    }

    if (!process.env.GROQ_API_KEY) {
      return json(res, 500, { error: "Missing GROQ_API_KEY env var" });
    }

    // Generate anchors per page, sequentially (keeps it simple + predictable).
    const results = [];

    for (let i = 0; i < pages.length; i++) {
      const pageIndex = Number(pages[i]?.pageIndex ?? i);
      const pageText = String(pages[i]?.pageText ?? "").trim();
      if (!pageText) {
        results.push({ pageIndex, anchors: [] });
        continue;
      }

      const system =
        "You extract EXACTLY 5 core structural ideas (" +
        "Core Anchors) from a passage. Each anchor must be a verbatim substring " +
        "that appears in the passage. Avoid examples, fluff, and minor details. " +
        "Return STRICT JSON only.";

      const user =
        "PASSAGE:\n" +
        pageText +
        "\n\nTASK:\n" +
        "Return a JSON object with this shape:\n" +
        "{\"anchors\":[{\"id\":\"a1\",\"snippet\":\"...\",\"keywords\":[\"...\",\"...\"]}, ...]}\n" +
        "Rules:\n" +
        "- anchors must have length 5\n" +
        "- snippet must appear EXACTLY in the passage (verbatim substring)\n" +
        "- keywords: 3 to 6 lowercase words that help detect coverage; include only meaningful words\n" +
        "- do not include any additional keys\n";

      const upstream = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.2,
        }),
      });

      const rawText = await upstream.text();
      if (!upstream.ok) {
        results.push({
          pageIndex,
          anchors: [],
          ...(debug ? { error: "Groq API error", detail: rawText } : {}),
        });
        continue;
      }

      const data = safeJsonParse(rawText);
      const modelText = data?.choices?.[0]?.message?.content ?? "";
      const parsed = safeJsonParse(modelText);

      let anchors = Array.isArray(parsed?.anchors) ? parsed.anchors : [];
      anchors = anchors.map((a, idx) => normalizeAnchor(a, `a${idx + 1}`));
      anchors = anchors.filter((a) => a.snippet);

      // Enforce EXACTLY 5, but don't crash if the model misbehaves.
      if (anchors.length > 5) anchors = anchors.slice(0, 5);
      while (anchors.length < 5) {
        anchors.push({ id: `a${anchors.length + 1}`, snippet: "", keywords: [] });
      }

      results.push({
        pageIndex,
        anchors,
        ...(debug ? { model: MODEL, raw_model_output: modelText } : {}),
      });
    }

    return json(res, 200, { pages: results });
  } catch (err) {
    return json(res, 500, { error: "Prepare error", detail: String(err?.message || err) });
  }
}
