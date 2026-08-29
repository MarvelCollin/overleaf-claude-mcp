import type { DetectResult } from "./engine.js";
import type { FlaggedSentence, PlagiarismMatch, PlagiarismReport } from "./types.js";

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

export function formatPlagiarism(report: PlagiarismReport, source: string, limit: number): string {
  const grouped = new Map<string, PlagiarismMatch[]>();
  for (const match of report.matches) {
    const list = grouped.get(match.sentence);
    if (list) list.push(match);
    else grouped.set(match.sentence, [match]);
  }

  const lines = [
    `${source}, checked by ${report.provider}`,
    `${report.checked} passage(s) searched, ${grouped.size} found verbatim on the web`,
  ];

  if (report.exactMatch !== undefined) {
    lines.push(`${report.exactMatch}% of searched passages matched a source, ${report.original ?? 0}% appear original`);
  }
  if (report.note) lines.push(report.note);

  if (grouped.size === 0) {
    lines.push("", "No searched passage was found verbatim on the web.");
    return lines.join("\n");
  }

  lines.push("");
  let shown = 0;
  for (const [sentence, hits] of grouped) {
    if (shown >= limit) break;
    shown += 1;
    const first = hits[0] as PlagiarismMatch;
    const at =
      first.path && first.line ? `${first.path}:${first.line}` : first.line ? `line ${first.line}` : "";
    lines.push(`${at ? `${at}  ` : ""}${shorten(sentence, 130)}`);
    for (const hit of hits) lines.push(`  ${hit.title || hit.url}
  ${hit.url}`);
    lines.push("");
  }

  if (grouped.size > shown) {
    lines.push(`... ${grouped.size - shown} more, raise limit to see them`);
  }

  return lines.join("\n").trimEnd();
}
