// api/_lib/grader.js

export function scoreToCompassRating(overallScore) {
  const score = Number.parseFloat(overallScore);
  const s = Number.isFinite(score) ? score : 0;
  if (s >= 90) return 5;
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
  let coreIdeaScore = null;
  let accuracyScore = null;
  let compressionScore = null;
  let engagementScore = null;
  let notesText = "";
  let consolidationText = "";

  let inNotes = false;
  let inConsolidation = false;

  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || "").trim();

    // Criterion scores (accept decimals)
    // Keep parsing lightweight and tolerant of extra text after the percent.
    if (coreIdeaScore === null && line.match(/^Core Idea:\s*\[?([\d.]+)%?\]?/i)) {
      const m = line.match(/^Core Idea:\s*\[?([\d.]+)%?\]?/i);
      if (m) coreIdeaScore = Math.round(parseFloat(m[1]));
      continue;
    }
    if (accuracyScore === null && line.match(/^Accuracy:\s*\[?([\d.]+)%?\]?/i)) {
      const m = line.match(/^Accuracy:\s*\[?([\d.]+)%?\]?/i);
      if (m) accuracyScore = Math.round(parseFloat(m[1]));
      continue;
    }
    if (compressionScore === null && line.match(/^Compression:\s*\[?([\d.]+)%?\]?/i)) {
      const m = line.match(/^Compression:\s*\[?([\d.]+)%?\]?/i);
      if (m) compressionScore = Math.round(parseFloat(m[1]));
      continue;
    }
    if (engagementScore === null && line.match(/^Engagement:\s*\[?([\d.]+)%?\]?/i)) {
      const m = line.match(/^Engagement:\s*\[?([\d.]+)%?\]?/i);
      if (m) engagementScore = Math.round(parseFloat(m[1]));
      continue;
    }

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

  // 3a bonus (deterministic, applied after parsing and only to the overall score)
  // Goal: make 5⭐ reachable for high-fidelity consolidations without changing any criterion scores.
  // Guardrails:
  // - Only consider when the model already gave a strong overall (>= 86)
  // - Require strong Core Idea + Accuracy (subordinate to existing criteria)
  // - Disallow when the model output mentions clear inaccuracies
  let adjustedOverallScore = overallScore;
  try {
    const hasHardErrorLanguage = /\b(material\s+inaccurac|inaccurat|incorrect|wrong|misstat|hallucinat)\b/i.test(cleaned);
    const strongOverall = Number.isFinite(overallScore) && overallScore >= 86;
    const strongCore = Number.isFinite(coreIdeaScore) && coreIdeaScore >= 85;
    const strongAcc = Number.isFinite(accuracyScore) && accuracyScore >= 85;
    if (strongOverall && strongCore && strongAcc && !hasHardErrorLanguage) {
      adjustedOverallScore = Math.min(100, overallScore + 5);
    }
  } catch (_) {}
  if (!notesText) notesText = "Review the passage for key details and mechanisms.";
  if (!consolidationText) consolidationText = "Unable to generate improved consolidation.";

  return {
    overallScore,
    adjustedOverallScore,
    coreIdeaScore,
    accuracyScore,
    compressionScore,
    engagementScore,
    notesText: notesText.replace(/\s+/g, " ").trim(),
    consolidationText: consolidationText.replace(/\s+/g, " ").trim(),
  };
}

export function formatAs4Lines(parsed) {
  const scoreForStars = Number.isFinite(Number(parsed.adjustedOverallScore))
    ? parsed.adjustedOverallScore
    : parsed.overallScore;
  const rating = scoreToCompassRating(scoreForStars);
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
