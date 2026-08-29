import type { DetectResult } from "./engine.js";
import type { FlaggedSentence, PlagiarismReport } from "./types.js";

function band(percentage: number): string {
  if (percentage >= 80) return "very likely AI";
  if (percentage >= 50) return "likely AI";
  if (percentage >= 20) return "mixed";
  return "reads as human";
}

function shorten(value: string, width = 150): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`;
}

function where(sentence: FlaggedSentence): string {
  if (sentence.path && sentence.line) return `${sentence.path}:${sentence.line}`;
  if (sentence.line) return `line ${sentence.line}`;
  return "";
}

function bullet(sentence: FlaggedSentence): string {
  const at = where(sentence);
  const score = sentence.score !== undefined ? ` [${sentence.score}%]` : "";
  return `  ${at ? `${at}  ` : ""}${shorten(sentence.text)}${score}`;
}

export function formatDetection(result: DetectResult, source: string, limit: number): string {
  const lines = [`${source}, ${result.words} words, ${result.chars} chars`];

  if (result.consensus !== undefined) {
    const ran = result.outcomes.filter((o) => o.report).length;
    lines.push(`consensus: ${result.consensus}% AI, ${band(result.consensus)}, across ${ran} detector(s)`);
  }

  lines.push("");

  for (const outcome of result.outcomes) {
    const name = outcome.provider.padEnd(10);
    if (outcome.report) {
      const pct = `${outcome.report.aiPercentage.toFixed(1)}%`.padStart(6);
      const note = outcome.report.note ? ` (${outcome.report.note})` : "";
      lines.push(`${name}${pct}  ${outcome.report.verdict}${note}`);
    } else if (outcome.skipped) {
      lines.push(`${name}     -  skipped, ${outcome.skipped}`);
    } else {
      lines.push(`${name}     -  failed, ${outcome.error}`);
    }
  }

  if (result.agreed.length > 0) {
    lines.push("", `flagged by more than one detector (${result.agreed.length}):`);
    for (const sentence of result.agreed.slice(0, limit)) lines.push(bullet(sentence));
  }

  for (const outcome of result.outcomes) {
    const flagged = outcome.report?.flagged ?? [];
    if (flagged.length === 0) continue;
    lines.push("", `${outcome.provider} flagged ${flagged.length} sentence(s):`);
    for (const sentence of flagged.slice(0, limit)) lines.push(bullet(sentence));
    if (flagged.length > limit) lines.push(`  ... ${flagged.length - limit} more, raise limit to see them`);
  }

  const nothing = result.outcomes.every((o) => (o.report?.flagged.length ?? 0) === 0);
  if (nothing && result.consensus !== undefined) {
    lines.push("", "No individual sentence was flagged.");
  }

  return lines.join("\n");
}

export function formatPlagiarism(report: PlagiarismReport, limit: number): string {
  const lines = [
    `${report.provider}: ${report.checked} passage(s) checked, ${report.matches.length} with a web match`,
  ];
  if (report.note) lines.push(report.note);

  if (report.matches.length === 0) {
    lines.push("", "No verbatim web source was found for any checked passage.");
    return lines.join("\n");
  }

  lines.push("");
  for (const match of report.matches.slice(0, limit)) {
    const at = match.path && match.line ? `${match.path}:${match.line}` : match.line ? `line ${match.line}` : "";
    lines.push(`${at ? `${at}  ` : ""}${shorten(match.sentence, 120)}`);
    lines.push(`  ${match.title}`);
    lines.push(`  ${match.url}`);
    lines.push("");
  }

  if (report.matches.length > limit) {
    lines.push(`... ${report.matches.length - limit} more, raise limit to see them`);
  }

  return lines.join("\n").trimEnd();
}
