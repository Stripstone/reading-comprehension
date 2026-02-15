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
  // NOTE:
  // - We parse the model's structured output for per-criterion scores + Overall Score.
  // - We apply the +5 "structural fidelity" bonus deterministically in code (3a),
  //   without altering any individual criterion scores.
  const cleaned = String(rawText || "")
    .replace(/\*\*/g, "")
    .replace(/^###\s+/gm, "")
    .replace(/^##\s+/gm, "")
    .replace(/^#\s+/gm, "");

  const lines = cleaned.split("\n");

  let coreIdeaScore = null;
  let accuracyScore = null;
  let compressionScore = null;
  let engagementScore = null;
  let overallScore = null;

  let notesText = "";
  let consolidationText = "";

  let inNotes = false;
  let inConsolidation = false;

  function parsePct(line, labelRegex) {
    // Accept "Label: 87.5%" or "Label: 87%"
    const m = String(line || "").match(new RegExp(`${labelRegex.source}\\s*:\\s*\\[?([\\d.]+)\\s*%?\\]?`, "i"));
    if (!m) return null;
    const v = Number.parseFloat(m[1]);
    return Number.isFinite(v) ? v : null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || "").trim();

    // Per-criterion scores (accept decimals)
    if (coreIdeaScore === null) {
      const v = parsePct(line, /^Core Idea/);
      if (v !== null) { coreIdeaScore = v; continue; }
    }
    if (accuracyScore === null) {
      const v = parsePct(line, /^Accuracy/);
      if (v !== null) { accuracyScore = v; continue; }
    }
    if (compressionScore === null) {
      const v = parsePct(line, /^Compression/);
      if (v !== null) { compressionScore = v; continue; }
    }
    if (engagementScore === null) {
      const v = parsePct(line, /^Engagement/);
      if (v !== null) { engagementScore = v; continue; }
    }

    // Overall Score (accept decimals)
    if (line.match(/Overall Score:\s*\[?([\d.]+)\s*%?\]?/i)) {
      const match = line.match(/Overall Score:\s*\[?([\d.]+)\s*%?\]?/i);
      if (match) {
        const v = Number.parseFloat(match[1]);
        if (Number.isFinite(v)) overallScore = v;
      }
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
      line.match(/^Compression:/i) ||
      line.match(/^Engagement:/i) ||
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

  // Normalize / fallbacks
  const overallRounded = (() => {
    if (overallScore === null) return 60;
    const r = Math.round(Number.parseFloat(overallScore));
    return Number.isFinite(r) ? r : 60;
  })();

  // 3a (code): deterministic +5 bonus when the model already scored high and shows strong structural fidelity.
  // Conservative gates (subordinate to the model's own criterion scoring):
  // - overall already high (>= 86)
  // - Core Idea + Accuracy both high
  // - no obvious "hard error" language / material inaccuracies
  let adjustedOverallScore = overallRounded;

  const hasNoMaterialInaccuracies = /no material inaccuracies/i.test(cleaned);
  const hasMaterialInaccuracies = /material inaccuracies/i.test(cleaned) && !hasNoMaterialInaccuracies;

  const hardErrorPattern = /\b(incorrect|inaccurate|wrong|misstates|false|contradict(?:s|ing)|fabricat(?:e|ed|ion)|hallucinat(?:e|ed|ion))\b/i;
  const hasHardErrorLanguage = hardErrorPattern.test(cleaned) && !hasNoMaterialInaccuracies;

  const canAssessFidelity =
    Number.isFinite(coreIdeaScore) &&
    Number.isFinite(accuracyScore);

  const coreOK = canAssessFidelity && coreIdeaScore >= 88;
  const accOK = canAssessFidelity && accuracyScore >= 85;

  const qualifies3a =
    overallRounded >= 86 &&
    canAssessFidelity &&
    coreOK &&
    accOK &&
    !hasMaterialInaccuracies &&
    !hasHardErrorLanguage;

  if (qualifies3a) {
    adjustedOverallScore = Math.min(100, overallRounded + 5);
  }

  if (!notesText) notesText = "Review the passage for key details and mechanisms.";
  if (!consolidationText) consolidationText = "Unable to generate improved consolidation.";

  return {
    // Keep the model's original overall (rounded) and expose adjusted score for rating.
    overallScore: overallRounded,
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
  const ratingScore = (parsed && Number.isFinite(parsed.adjustedOverallScore))
    ? parsed.adjustedOverallScore
    : parsed.overallScore;
  const rating = scoreToCompassRating(ratingScore);
  const line1 = compassEmojis(rating);
  const line2 = String(parsed.notesText || "").trim();
  const line3 = "Better consolidation:";
  const line4 = String(parsed.consolidationText || "").trim();
  return `${line1}\n${line2}\n${line3}\n${line4}`;
}

export function isValid4LineFeedback(feedback) {(feedback) {
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
