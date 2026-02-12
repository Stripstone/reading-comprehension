// api/evaluate/index.js
import { buildPromptMessages } from "../_lib/prompt.js";
import {
  parseMultiCriteriaOutput,
  formatAs4Lines,
  isValid4LineFeedback,
} from "../_lib/grader.js";
import { json, withCors, readJsonBody } from "../_lib/http.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-70b-versatile"; // free + very strong

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

    const parsed = parseMultiCriteriaOutput(modelText);
    let feedback = formatAs4Lines(parsed);

    // retry once if formatting drifted
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
        const retryOutput = retryData?.choices?.[0]?.message?.content ?? "";
        const parsed2 = parseMultiCriteriaOutput(retryOutput);
        const feedback2 = formatAs4Lines(parsed2);
        if (isValid4LineFeedback(feedback2)) feedback = feedback2;
      }
    }

    return json(res, 200, { feedback });
  } catch (err) {
    return json(res, 500, { error: "Server error", detail: String(err) });
  }
}
