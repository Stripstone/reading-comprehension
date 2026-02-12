// api/evaluate/index.js
import { buildPromptMessages } from "../_lib/prompt.js";
import { parseMultiCriteriaOutput, formatAs4Lines, isValid4LineFeedback } from "../_lib/grader.js";
import { json, withCors, readJsonBody } from "../_lib/http.js";

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5";
const OPENAI_URL = "https://api.openai.com/v1/responses";

export default async function handler(req, res) {
  // CORS for your GitHub Pages origin (and local dev). Adjust as needed.
  const allowed = [
    "https://stripstone.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  if (withCors(req, res, allowed)) return; // handles OPTIONS early return

  try {
    if (req.method !== "POST") {
      return json(res, 405, { error: "Method not allowed. Use POST." });
    }

    const body = await readJsonBody(req);

    const pageText = String(body?.pageText ?? body?.passageText ?? "").trim();
    const userText = String(body?.userText ?? body?.consolidation ?? "").trim();
    const model = String(body?.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;

    if (!pageText || !userText) {
      return json(res, 400, { error: "Missing pageText/userText (or passageText/consolidation)" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return json(res, 500, { error: "Missing OPENAI_API_KEY env var" });
    }

    const input = buildPromptMessages(pageText, userText);

    // Call OpenAI Responses API
    const upstream = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        input,
        // Keep it deterministic-ish like your local settings
        temperature: 0.3,
        top_p: 0.9,
        // You can add max_output_tokens if you want hard caps:
        // max_output_tokens: 1200,
      }),
    });

    const rawText = await upstream.text();
    if (!upstream.ok) {
      return json(res, 502, { error: "Upstream OpenAI error", detail: rawText });
    }

    const data = JSON.parse(rawText);

    // Responses API: safely extract combined text output
    const modelText =
      (data?.output_text && String(data.output_text)) ||
      extractTextFromResponse(data) ||
      "";

    const parsed = parseMultiCriteriaOutput(modelText);
    let feedback = formatAs4Lines(parsed);

    // Retry once if it didn’t produce valid 4-line output
    if (!isValid4LineFeedback(feedback)) {
      const retry = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          input,
          temperature: 0.3,
          top_p: 0.9,
          // max_output_tokens: 1600,
        }),
      });

      const retryText = await retry.text();
      if (retry.ok) {
        const retryData = JSON.parse(retryText);
        const retryModelText =
          (retryData?.output_text && String(retryData.output_text)) ||
          extractTextFromResponse(retryData) ||
          "";

        const parsed2 = parseMultiCriteriaOutput(retryModelText);
        const feedback2 = formatAs4Lines(parsed2);
        if (isValid4LineFeedback(feedback2)) feedback = feedback2;
      }
    }

    return json(res, 200, { feedback });
  } catch (err) {
    return json(res, 500, { error: "Server error", detail: String(err?.stack || err) });
  }
}

function extractTextFromResponse(resp) {
  // Best-effort fallback if output_text isn’t present for some reason.
  // Walk output items and join any "output_text" content parts.
  try {
    const out = resp?.output;
    if (!Array.isArray(out)) return "";
    const chunks = [];
    for (const item of out) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part?.type === "output_text" && typeof part?.text === "string") {
          chunks.push(part.text);
        }
      }
    }
    return chunks.join("\n").trim();
  } catch {
    return "";
  }
}
