// api/anchors/index.js
import { buildAnchorsMessages } from "../_lib/prompt.js";
import { json, withCors, readJsonBody } from "../_lib/http.js";
import { normalizeAnchorsWithDebug, sha256Hex, ANCHOR_VERSION } from "../_lib/anchors.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

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
    const maxAnchors = Number(body?.maxAnchors ?? 5);
    const debug = String(body?.debug ?? "").trim() === "1" || body?.debug === true;

    if (!pageText) {
      return json(res, 400, { error: "Missing pageText" });
    }

    if (!process.env.GROQ_API_KEY) {
      return json(res, 500, { error: "Missing GROQ_API_KEY env var" });
    }

    const pageHash = sha256Hex(pageText);
    const messages = buildAnchorsMessages({ pageText, maxAnchors });

    
    async function callGroq(extraSystemNote) {
      const msgs = extraSystemNote
        ? [{ role: "system", content: extraSystemNote }, ...messages]
        : messages;
      const upstream = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: msgs,
          temperature: 0.0,
        }),
      });
      const rawText = await upstream.text();
      return { upstream, rawText };
    }

    const first = await callGroq("");
    if (!first.upstream.ok) {
      return json(res, 502, { error: "Groq API error", detail: first.rawText });
    }
    const data = JSON.parse(first.rawText);
    let modelText = data?.choices?.[0]?.message?.content ?? "";
    let retried = false;
let anchors;
    let pageBetterConsolidation = "";
    let anchorsDebug = null;
    let validation = { ok: true, retried: false };

    const tryNormalize = (mt) => normalizeAnchorsWithDebug({ pageText, modelText: mt, maxAnchors, debug });

    try {
      const out = tryNormalize(modelText);
      anchors = out.anchors;
      pageBetterConsolidation = out.pageBetterConsolidation || "";
      anchorsDebug = out.debug;
    } catch (e1) {
      const reason1 = e1?.details?.reason || null;

      // Retry once for common model formatting failures (missing/invalid JSON).
      if (!retried && (reason1 === "no_json_object" || reason1 === "json_parse_error")) {
        retried = true;
        const second = await callGroq("Return ONLY a single JSON object. No markdown, no prose.");
        if (!second.upstream.ok) {
          return json(res, 502, { error: "Groq API error", detail: second.rawText });
        }
        const data2 = JSON.parse(second.rawText);
        modelText = data2?.choices?.[0]?.message?.content ?? "";

        try {
          const out2 = tryNormalize(modelText);
          anchors = out2.anchors;
          pageBetterConsolidation = out2.pageBetterConsolidation || "";
          anchorsDebug = out2.debug;
          validation = { ok: true, retried: true };
        } catch (e2) {
          validation = { ok: false, retried: true, error: String(e2?.message ?? e2), details: e2?.details ?? null };
          return json(res, 422, {
            error: "Invalid anchor output",
            details: validation,
            meta: { pageHash, anchorVersion: ANCHOR_VERSION },
            ...(debug
              ? {
                  debug: {
                    pageLength: pageText.length,
                    pageHash,
                    rawModelOutput: modelText,
                  },
                }
              : {}),
          });
        }
      } else {
        validation = { ok: false, retried: false, error: String(e1?.message ?? e1), details: e1?.details ?? null };
        return json(res, 422, {
          error: "Invalid anchor output",
          details: validation,
          meta: { pageHash, anchorVersion: ANCHOR_VERSION },
          ...(debug
            ? {
                debug: {
                  pageLength: pageText.length,
                  pageHash,
                  rawModelOutput: modelText,
                },
              }
            : {}),
        });
      }
    }
const payload = {
      anchors,
      pageBetterConsolidation,
      meta: { pageHash, anchorVersion: ANCHOR_VERSION },
    };

    if (debug) {
      payload.debug = {
        pageLength: pageText.length,
        pageHash,
        rawModelOutput: modelText,
        parsedAnchors: anchors,
        pageBetterConsolidation,
        anchorNormalization: anchorsDebug?.normalization ?? null,
        candidates: anchorsDebug?.candidates ?? null,
        validation,
        cache: { cacheHit: false }, // client-side cache; server does not cache yet
      };
    }

    return json(res, 200, payload);
  } catch (e) {
    return json(res, 500, { error: "Server error", detail: String(e?.message ?? e) });
  }
}
