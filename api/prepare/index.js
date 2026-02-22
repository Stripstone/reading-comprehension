// api/prepare/index.js
// Generates 5 "Core Anchors" for each page: verbatim snippets + lightweight keyword lists.
// This is used for the calm, mid-writing progress/coach layer (NOT grading).

import { json, withCors, readJsonBody } from "../_lib/http.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const allowed = [
    "https://stripstone.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  if (withCors(req, res, allowed)) return;

  // Allow GET so you can sanity-check the route in a browser.
  if (req.method === "GET") {
    return json(res, 200, { ok: true, route: "/api/prepare", methods: ["POST"] });
  }

  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed. Use POST." });
  }

  try {
    const body = await readJsonBody(req);
    const pages = Array.isArray(body?.pages) ? body.pages : [];
    const debug = String(body?.debug ?? "").trim() === "1" || body?.debug === true;

    if (!pages.length) {
      return json(res, 400, { error: "Missing pages[]" });
    }

    if (!process.env.GROQ_API_KEY) {
      return json(res, 500, { error: "Missing GROQ_API_KEY env var" });
    }

    // One call per request; we send all pages and request 5 anchors each.
    // Output MUST be strict JSON.
    const prompt = `You are extracting "Core Anchors" from reading passages.

For EACH page, return exactly 5 anchors.

Rules:
- Each anchor.snippet MUST be a verbatim substring from the pageText.
- Snippets should be structural (core claim, mechanism, constraint, outcome, definition).
- Avoid decorative/context-only lines.
- Keep snippets short: 4 to 14 words.
- Each anchor.keywords must be 3 to 6 lowercase keywords that help detect coverage in a learner's consolidation.
- keywords do NOT have to be verbatim, but should be close (no long phrases).

Return strict JSON only with this schema:
{
  "pages": [
    {"pageIndex": number, "anchors": [{"id": string, "label": "Core Anchor", "snippet": string, "keywords": string[]}]}
  ]
}

Pages:
${pages
  .map((p) => {
    const pageIndex = Number(p?.pageIndex ?? 0);
    const pageText = String(p?.pageText ?? "").trim();
    return `---\npageIndex: ${pageIndex}\npageText: ${pageText}`;
  })
  .join("\n\n")}
`;

    const upstream = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "Return only strict JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      }),
    });

    const rawText = await upstream.text();
    if (!upstream.ok) {
      return json(res, 502, { error: "Groq API error", detail: rawText });
    }

    const data = safeParseJson(rawText);
    const modelText = data?.choices?.[0]?.message?.content ?? "";
    const parsed = safeParseJson(modelText);

    if (!parsed || !Array.isArray(parsed.pages)) {
      return json(res, 502, {
        error: "Bad model output (expected JSON)",
        ...(debug ? { modelText } : {}),
      });
    }

    return json(res, 200, parsed);
  } catch (e) {
    return json(res, 500, { error: "Unexpected error", detail: String(e?.message ?? e) });
  }
}
