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

    const candidates = Array.isArray(finalParsed.highlightSnippets)
      ? finalParsed.highlightSnippets
      : [];

    // Clamp to max (we allow fewer than min if the model didn't provide enough candidates).
    // This preserves the "grader is innocent" stance while preventing highlight overload.
    const clamped = candidates.slice(0, Math.min(maxHighlights, candidates.length));

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
