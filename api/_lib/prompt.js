// api/_lib/prompt.js
import fs from "node:fs";
import path from "node:path";

// Cache prompts by filename to support multiple prompt templates.
const cachedPrompts = new Map();

function readPromptTemplate(filename) {
  const key = String(filename || "").trim() || "promptGrader.txt";
  if (cachedPrompts.has(key)) return cachedPrompts.get(key);

  const p = path.join(process.cwd(), "api", "prompts", key);
  const txt = fs.readFileSync(p, "utf8");
  cachedPrompts.set(key, txt);
  return txt;
}

// Backwards compatible: page-level grader prompt.
export function buildPromptMessages(pageText, userText) {
  const promptTemplate = readPromptTemplate("promptGrader.txt");

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

// Final Summary / Full Chapter Consolidation prompt.
// Accepts an array of pages with text + user consolidation + optional aiFeedback.
export function buildFinalSummaryMessages({ title = "", pages = [] } = {}) {
  const promptTemplate = readPromptTemplate("promptFinalSummary.txt");

  const safeTitle = String(title || "").trim();
  const pageArr = Array.isArray(pages) ? pages : [];

  const chunks = [];
  if (safeTitle) {
    chunks.push(`---CHAPTER TITLE---\n${safeTitle}\n`);
  }

  for (let i = 0; i < pageArr.length; i++) {
    const p = pageArr[i] || {};
    const pageText = String(p.pageText ?? "").trim();
    const userText = String(p.userText ?? "").trim();
    const aiFeedback = String(p.aiFeedback ?? "").trim();

    if (!pageText && !userText && !aiFeedback) continue;

    chunks.push(`---PAGE ${i + 1}---`);
    if (pageText) chunks.push(`PAGE CONTENT:\n${pageText}`);
    if (userText) chunks.push(`USER CONSOLIDATION:\n${userText}`);
    if (aiFeedback) chunks.push(`AI FEEDBACK (optional):\n${aiFeedback}`);
    chunks.push("");
  }

  const userBlock = [
    chunks.join("\n"),
    "---",
    "Create the final chapter summary now.",
  ].join("\n");

  return [
    { role: "system", content: promptTemplate },
    { role: "user", content: userBlock },
  ];
}
