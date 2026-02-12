// api/_lib/prompt.js
import fs from "node:fs";
import path from "node:path";

let cachedPrompt = null;

function readPromptTemplate() {
  if (cachedPrompt) return cachedPrompt;

  const p = path.join(process.cwd(), "api", "prompts", "promptGrader.txt");
  cachedPrompt = fs.readFileSync(p, "utf8");
  return cachedPrompt;
}

export function buildPromptMessages(pageText, userText) {
  const promptTemplate = readPromptTemplate();

  // Match your local “template + appended content” behavior
  const userBlock = [
    "---PAGE CONTENT---",
    pageText,
    "",
    "---USER CONSOLIDATION---",
    userText,
    "",
    "---",
    "",
    "Provide your grading now:",
  ].join("\n");

  return [
    { role: "system", content: promptTemplate },
    { role: "user", content: userBlock },
  ];
}
