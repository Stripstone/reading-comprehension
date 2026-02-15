// api/_lib/grader.js

export function scoreToCompassRating(overallScore) {
  const score = Number.parseFloat(overallScore);
  const s = Number.isFinite(score) ? score : 0;
  if (s >= 88) return 5;
  if (s >= 80) return 4;
  if (s >= 70) return 3;
  if (s >= 50) return 2;
  return 1;
}

export function compassEmojis(rating) {
  const filled = "🧭".repeat(rating);
  const empty = "⚪".repeat(5 - rating);
  return `${filled}${empty} (${rating}/5)`;
}

export function parseMultiCriteriaOutput(rawText) {
  const cleaned = String(rawText || "")
    .replace(/\*\*/g, "")
    .replace(/^###\s+/gm, "")
    .replace(/^##\s+/gm, "")
    .replace(/^#\s+/gm, "");

  const lines = cleaned.split("\n");

  let overallScore = null;
  let notesText = "";
  let consolidationText = "";

  let inNotes = false;
  let inConsolidation = false;

  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || "").trim();

    // Overall Score (accept decimals)
    if (line.match(/Overall Score:\s*\[?([\d.]+)%?\]?/i)) {
      const match = line.match(/Overall Score:\s*\[?([\d.]+)%?\]?/i);
      if (match) overallScore = Math.round(parseFloat(match[1]));
      continue;
    }

    if (line === "Notes" || line === "Notes:") {
      inNotes = true;
      inConsolidation = false;
      continue;
    }

    if (
      line.match(/Example of Strong Consolidation/i) ||
      line.match(/Strong Consolidation/i) ||
      line.match(/Better [Cc]onsolidation/i) ||
      line.match(/Improved [Cc]onsolidation/i) ||
      line.match(/A more accurate consolidation would be/i)
    ) {
      inConsolidation = true;
      inNotes = false;
      continue;
    }

    if (
      line === "Success" ||
      line === "Success:" ||
      line === "Failed" ||
      line === "Failed:" ||
      line.startsWith("Page ") ||
      line.match(/^Core Idea:/i) ||
      line.match(/^Accuracy:/i) ||
      line.startsWith("---")
    ) {
      inNotes = false;
      inConsolidation = false;
      continue;
    }

    if (inNotes && line) {
      const c = line.replace(/^[-•]\s*/, "").replace(/^\d+\.\s*/, "");
      if (!notesText && c.length > 20) notesText = c;
    }

    if (inConsolidation && line) {
      if (/^This\s+(?:consolidation|version|feedback|output|approach|sentence)/i.test(line)) {
        inConsolidation = false;
        continue;
      }
      if (line.length > 10) consolidationText += (consolidationText ? " " : "") + line;
    }
  }

  if (overallScore === null) overallScore = 60;
  if (!notesText) notesText = "Review the passage for key details and mechanisms.";
  if (!consolidationText) consolidationText = "Unable to generate improved consolidation.";

  return {
    overallScore,
    notesText: notesText.replace(/\s+/g, " ").trim(),
    consolidationText: consolidationText.replace(/\s+/g, " ").trim(),
  };
}

export function formatAs4Lines(parsed) {
  const rating = scoreToCompassRating(parsed.overallScore);
  const line1 = compassEmojis(rating);
  const line2 = String(parsed.notesText || "").trim();
  const line3 = "Better consolidation:";
  const line4 = String(parsed.consolidationText || "").trim();
  return `${line1}\n${line2}\n${line3}\n${line4}`;
}

export function isValid4LineFeedback(feedback) {
  const lines = String(feedback || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length !== 4) return false;
  if (!/^\s*(?:🧭|⚪){5}\s*\(\s*[1-5]\s*\/\s*5\s*\)\s*$/.test(lines[0])) return false;
  if (!lines[1] || lines[1].length < 10) return false;
  if (lines[2] !== "Better consolidation:") return false;
  if (!lines[3] || lines[3].length < 10) return false;
  return true;
}
