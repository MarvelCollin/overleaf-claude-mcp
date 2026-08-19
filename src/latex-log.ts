export interface LogEntry {
  level: "error" | "warning";
  message: string;
  file?: string;
  line?: number;
}

const FILE_LINE = /^l\.(\d+)/;

export function parseLatexLog(log: string): LogEntry[] {
  const lines = log.split(/\r?\n/);
  const entries: LogEntry[] = [];
  const fileStack: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    for (const match of line.matchAll(/\((\.\/[^\s()]+|\/[^\s()]+)/g)) {
      if (match[1]) fileStack.push(match[1]);
    }
    for (const _ of line.matchAll(/\)/g)) fileStack.pop();

    if (line.startsWith("! ")) {
      const detail = [line.slice(2).trim()];
      let lineNumber: number | undefined;
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j += 1) {
        const next = lines[j] ?? "";
        const hit = next.match(FILE_LINE);
        if (hit?.[1]) {
          lineNumber = Number(hit[1]);
          break;
        }
        if (next.trim()) detail.push(next.trim());
      }
      entries.push({
        level: "error",
        message: detail.join(" ").slice(0, 500),
        file: fileStack[fileStack.length - 1],
        line: lineNumber,
      });
      continue;
    }

    if (/^(LaTeX|Package|Class)\s.*Warning:/.test(line) || /^(Overfull|Underfull)\s/.test(line)) {
      const lineHit = line.match(/on input line (\d+)/);
      entries.push({
        level: "warning",
        message: line.trim().slice(0, 400),
        file: fileStack[fileStack.length - 1],
        line: lineHit?.[1] ? Number(lineHit[1]) : undefined,
      });
    }
  }

  return entries;
}

export function summarizeLog(entries: LogEntry[]): string {
  if (entries.length === 0) return "No LaTeX errors or warnings found.";
  const errors = entries.filter((e) => e.level === "error");
  const warnings = entries.filter((e) => e.level === "warning");
  const render = (list: LogEntry[]): string =>
    list
      .map((e) => {
        const where = e.file ? `${e.file}${e.line ? `:${e.line}` : ""}` : "(unknown location)";
        return `- ${where} ${e.message}`;
      })
      .join("\n");

  const parts: string[] = [`${errors.length} error(s), ${warnings.length} warning(s)`];
  if (errors.length) parts.push(`\nErrors:\n${render(errors)}`);
  if (warnings.length) parts.push(`\nWarnings:\n${render(warnings.slice(0, 40))}`);
  return parts.join("\n");
}
