import type { LogEntry, LogEntryKind, LogFilter, ParsedLog } from "./types.js";

const FILE_LINE_ERROR = /^(\.?\/?[^\s:()]+\.[A-Za-z][\w.+-]*):(\d+):\s*(.*)$/;
const TEX_LINE = /^l\.(\d+)/;
const WARNING = /^(LaTeX Font|LaTeX|Package|Class)(?:\s+([^\s]+))?\s+Warning:\s*(.*)$/;
const BOX = /^(Overfull|Underfull)\s+\\([hv])box\s+\(([^)]*)\)\s*(.*)$/;
const CONTINUATION = /^\([\w@.-]+\)\s{2,}(.*)$/;
const LINE_RANGE = /at lines (\d+)--(\d+)/;
const SINGLE_LINE = /(?:detected )?at line (\d+)/;
const INPUT_LINE = /on input line (\d+)/;
const TOO_MUCH = /(\d+(?:\.\d+)?)pt too (?:wide|high)/;
const PAGES = /Output written on (\S+) \((\d+) pages?/;
const MISSING_FILE = /File [`'"]([^'"]+)['"] not found/;
const REFERENCE = /Reference [`'"]([^'"]+)['"] on page \S+ undefined/;
const CITATION = /Citation [`'"]([^'"]+)['"] on page \S+ undefined/;
const MULTIPLY_DEFINED = /Label [`'"]([^'"]+)['"] multiply defined/;

function isPathToken(token: string): boolean {
  if (token.length < 3) return false;
  if (!/^[\w./@+-]+$/.test(token)) return false;
  const base = token.slice(token.lastIndexOf("/") + 1);
  return /\.[A-Za-z][\w.+-]*$/.test(base);
}

function detectWrapWidth(lines: string[]): number {
  let widest = 0;
  let atWidest = 0;
  for (const line of lines) {
    if (line.length > widest) {
      widest = line.length;
      atWidest = 1;
    } else if (line.length === widest) {
      atWidest += 1;
    }
  }
  if (widest < 60 || widest > 300) return 0;
  return atWidest >= 5 ? widest : 0;
}

export function reflow(lines: string[]): string[] {
  const width = detectWrapWidth(lines);
  if (width === 0) return lines;

  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    let joined = lines[i] ?? "";
    while (joined.length > 0 && joined.length % width === 0 && i + 1 < lines.length) {
      i += 1;
      joined += lines[i] ?? "";
    }
    out.push(joined);
  }
  return out;
}

function walkStack(fragment: string, stack: (string | null)[]): void {
  for (let i = 0; i < fragment.length; i += 1) {
    const char = fragment[i];
    if (char === "(") {
      let end = i + 1;
      while (end < fragment.length && !"()[]{} \t".includes(fragment[end] ?? "")) end += 1;
      const token = fragment.slice(i + 1, end);
      if (isPathToken(token)) {
        stack.push(token.replace(/^\.\//, ""));
        i = end - 1;
      } else {
        stack.push(null);
      }
    } else if (char === ")") {
      stack.pop();
    }
  }
}

function currentFile(stack: (string | null)[]): string | undefined {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const entry = stack[i];
    if (entry) return entry;
  }
  return undefined;
}

function classifyWarning(source: string, name: string | undefined, body: string): LogEntryKind {
  if (REFERENCE.test(body)) return "undefined-reference";
  if (CITATION.test(body)) return "undefined-citation";
  if (MULTIPLY_DEFINED.test(body)) return "duplicate-label";
  if (source === "LaTeX Font") return "font-warning";
  if (source === "Package") return "package-warning";
  if (source === "Class") return "class-warning";
  void name;
  return "latex-warning";
}

function warningKey(kind: LogEntryKind, body: string): string | undefined {
  const pattern =
    kind === "undefined-reference"
      ? REFERENCE
      : kind === "undefined-citation"
        ? CITATION
        : kind === "duplicate-label"
          ? MULTIPLY_DEFINED
          : null;
  return pattern ? (body.match(pattern)?.[1] ?? undefined) : undefined;
}

function boxKind(direction: string, box: string): LogEntryKind {
  const axis = box === "h" ? "hbox" : "vbox";
  return (direction === "Overfull" ? `overfull-${axis}` : `underfull-${axis}`) as LogEntryKind;
}

export function parseLatexLog(log: string): ParsedLog {
  const lines = reflow(log.split(/\r?\n/));
  const entries: LogEntry[] = [];
  const stack: (string | null)[] = [];
  let pages: number | undefined;
  let outputPath: string | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    const pageHit = line.match(PAGES);
    if (pageHit) {
      outputPath = pageHit[1];
      pages = Number(pageHit[2]);
    }

    const fileLine = line.match(FILE_LINE_ERROR);
    if (fileLine && /^[!A-Z]/.test(fileLine[3] ?? "")) {
      const detail = [fileLine[3]?.trim() ?? ""];
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j += 1) {
        const next = (lines[j] ?? "").trim();
        if (!next || TEX_LINE.test(next)) break;
        detail.push(next);
      }
      const message = detail.join(" ").slice(0, 500);
      entries.push({
        level: "error",
        kind: MISSING_FILE.test(message) ? "missing-file" : "error",
        message,
        file: (fileLine[1] ?? "").replace(/^\.\//, ""),
        line: Number(fileLine[2]),
      });
      walkStack(line, stack);
      continue;
    }

    if (line.startsWith("! ")) {
      const detail = [line.slice(2).trim()];
      let lineNumber: number | undefined;
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j += 1) {
        const next = lines[j] ?? "";
        const hit = next.match(TEX_LINE);
        if (hit?.[1]) {
          lineNumber = Number(hit[1]);
          break;
        }
        if (next.trim()) detail.push(next.trim());
      }
      const message = detail.join(" ").slice(0, 500);
      entries.push({
        level: "error",
        kind: MISSING_FILE.test(message) ? "missing-file" : "error",
        message,
        file: currentFile(stack),
        line: lineNumber,
      });
      walkStack(line, stack);
      continue;
    }

    const box = line.match(BOX);
    if (box) {
      const detail = box[4] ?? "";
      const range = detail.match(LINE_RANGE);
      const single = detail.match(SINGLE_LINE);
      const amount = (box[3] ?? "").match(TOO_MUCH);
      entries.push({
        level: "warning",
        kind: boxKind(box[1] ?? "", box[2] ?? "h"),
        message: `${box[1]} \\${box[2]}box (${box[3]}) ${detail}`.trim().slice(0, 400),
        file: currentFile(stack),
        line: range?.[1] ? Number(range[1]) : single?.[1] ? Number(single[1]) : undefined,
        endLine: range?.[2] ? Number(range[2]) : undefined,
        overflowPt: amount?.[1] ? Number(amount[1]) : undefined,
      });
      walkStack(line, stack);
      continue;
    }

    const warning = line.match(WARNING);
    if (warning) {
      const head = warning.index ?? 0;
      walkStack(line.slice(0, head), stack);

      const source = warning[1] ?? "LaTeX";
      const name = warning[2];
      let body = warning[3] ?? "";
      let last = i;
      for (let j = i + 1; j < lines.length; j += 1) {
        const cont = (lines[j] ?? "").match(CONTINUATION);
        if (!cont) break;
        body += ` ${cont[1]?.trim() ?? ""}`;
        last = j;
      }

      const kind = classifyWarning(source, name, body);
      const inputLine = body.match(INPUT_LINE);
      entries.push({
        level: "warning",
        kind,
        message: `${source}${name ? ` ${name}` : ""} Warning: ${body}`.trim().slice(0, 400),
        file: currentFile(stack),
        line: inputLine?.[1] ? Number(inputLine[1]) : undefined,
        key: warningKey(kind, body),
      });

      walkStack(line.slice(head), stack);
      i = last;
      continue;
    }

    walkStack(line, stack);
  }

  return { entries, pages, outputPath };
}

export function filterEntries(entries: LogEntry[], filter: LogFilter): LogEntry[] {
  const severity = filter.severity ?? "all";
  const kind = filter.kind?.toLowerCase();
  const file = filter.file?.toLowerCase();
  return entries.filter((entry) => {
    if (severity !== "all" && entry.level !== severity) return false;
    if (kind && !entry.kind.includes(kind)) return false;
    if (file && !(entry.file ?? "").toLowerCase().includes(file)) return false;
    return true;
  });
}

function describe(entry: LogEntry): string {
  const where = entry.file
    ? `${entry.file}${entry.line ? `:${entry.line}${entry.endLine ? `-${entry.endLine}` : ""}` : ""}`
    : "(unknown location)";
  return `- ${where}  ${entry.message}`;
}

function tally(entries: LogEntry[], pick: (entry: LogEntry) => string): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = pick(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => `  ${String(count).padStart(4)}  ${key}`);
}

export function formatLog(entries: LogEntry[], filter: LogFilter = {}): string {
  const errors = entries.filter((e) => e.level === "error").length;
  const warnings = entries.length - errors;
  const parts: string[] = [`${errors} error(s), ${warnings} warning(s) in the whole log`];

  const matching = filterEntries(entries, filter);
  if (entries.length === 0) return "No LaTeX errors or warnings found.";

  if (filter.group !== false && matching.length > 0) {
    parts.push(`\nby kind:\n${tally(matching, (e) => e.kind).join("\n")}`);
    const byFile = tally(matching, (e) => e.file ?? "(unknown location)");
    parts.push(`\nby file:\n${byFile.slice(0, 15).join("\n")}`);
    if (byFile.length > 15) parts.push(`  ... ${byFile.length - 15} more file(s)`);
  }

  const limit = filter.limit ?? 40;
  const offset = Math.max(0, filter.offset ?? 0);
  const page = matching.slice(offset, offset + limit);

  if (matching.length === 0) {
    parts.push("\nNothing matched that filter.");
    return parts.join("\n");
  }

  parts.push(
    `\nshowing ${offset + 1}-${offset + page.length} of ${matching.length} matching entr(ies)\n${page
      .map(describe)
      .join("\n")}`,
  );

  const remaining = matching.length - (offset + page.length);
  if (remaining > 0) parts.push(`\n${remaining} more. Pass offset ${offset + page.length}.`);
  return parts.join("\n");
}
