import type { CheckIssue, LogEntry, TextSource } from "./types.js";

const LABEL = /\\label\s*\{([^}]*)\}/g;
const REF =
  /\\(?:ref|eqref|autoref|pageref|nameref|vref|Vref|cref|Cref|crefrange|Crefrange|cpageref|Cpageref)\s*\*?\s*\{([^}]*)\}/g;
const CITE = /\\(?:[a-zA-Z]*cite[a-zA-Z]*)\s*\*?\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}/g;
const BIBITEM = /\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
const BIB_ENTRY = /@(\w+)\s*[{(]\s*([^,\s}]+)\s*,/g;
const NON_ENTRY_TYPES = new Set(["string", "comment", "preamble"]);

export function stripComments(line: string): string {
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== "%") continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === "\\"; j -= 1) backslashes += 1;
    if (backslashes % 2 === 0) return line.slice(0, i);
  }
  return line;
}

interface Occurrence {
  key: string;
  where: string;
}

function collect(sources: TextSource[], pattern: RegExp, group = 1): Occurrence[] {
  const found: Occurrence[] = [];
  for (const source of sources) {
    const lines = source.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = stripComments(lines[i] ?? "");
      pattern.lastIndex = 0;
      for (const match of line.matchAll(pattern)) {
        const raw = match[group] ?? "";
        for (const key of raw.split(",")) {
          const trimmed = key.trim();
          if (!trimmed || trimmed === "*") continue;
          found.push({ key: trimmed, where: `${source.path}:${i + 1}` });
        }
      }
    }
  }
  return found;
}

function group(occurrences: Occurrence[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const item of occurrences) {
    const list = map.get(item.key);
    if (list) list.push(item.where);
    else map.set(item.key, [item.where]);
  }
  return map;
}

function isTex(path: string): boolean {
  return /\.(tex|ltx|cls|sty)$/i.test(path);
}

function isBib(path: string): boolean {
  return /\.(bib|bbl)$/i.test(path);
}

export function checkReferences(
  sources: TextSource[],
  logEntries: LogEntry[] = [],
  options: { reportUnusedLabels?: boolean } = {},
): CheckIssue[] {
  const tex = sources.filter((s) => isTex(s.path));
  const bib = sources.filter((s) => isBib(s.path));

  const labels = group(collect(tex, LABEL));
  const refs = group(collect(tex, REF));
  const cites = group(collect(tex, CITE));
  const bibitems = group(collect(tex, BIBITEM));
  const entries = group(collect(bib, BIB_ENTRY, 2));

  for (const source of bib) {
    BIB_ENTRY.lastIndex = 0;
    for (const match of source.content.matchAll(BIB_ENTRY)) {
      if (NON_ENTRY_TYPES.has((match[1] ?? "").toLowerCase())) entries.delete(match[2] ?? "");
    }
  }

  const known = new Set([...bibitems.keys(), ...entries.keys()]);
  const issues: CheckIssue[] = [];

  for (const [key, where] of refs) {
    if (labels.has(key)) continue;
    issues.push({
      kind: "undefined-reference",
      key,
      detail: `\\ref{${key}} has no matching \\label`,
      locations: where,
    });
  }

  for (const [key, where] of cites) {
    if (known.has(key)) continue;
    if (known.size === 0 && bib.length === 0 && bibitems.size === 0) continue;
    issues.push({
      kind: "undefined-citation",
      key,
      detail: `\\cite{${key}} matches no .bib entry or \\bibitem`,
      locations: where,
    });
  }

  for (const [key, where] of labels) {
    if (where.length > 1) {
      issues.push({
        kind: "duplicate-label",
        key,
        detail: `\\label{${key}} is defined ${where.length} times`,
        locations: where,
      });
    }
  }

  for (const [key, where] of new Map([...bibitems, ...entries])) {
    if (cites.has(key)) continue;
    issues.push({
      kind: "uncited-entry",
      key,
      detail: `bibliography entry "${key}" is never cited`,
      locations: where,
    });
  }

  if (options.reportUnusedLabels) {
    for (const [key, where] of labels) {
      if (refs.has(key)) continue;
      issues.push({
        kind: "unused-label",
        key,
        detail: `\\label{${key}} is never referenced`,
        locations: where,
      });
    }
  }

  for (const entry of logEntries) {
    if (!entry.key) continue;
    const kind =
      entry.kind === "undefined-reference"
        ? "undefined-reference"
        : entry.kind === "undefined-citation"
          ? "undefined-citation"
          : entry.kind === "duplicate-label"
            ? "duplicate-label"
            : null;
    if (!kind) continue;
    if (issues.some((issue) => issue.kind === kind && issue.key === entry.key)) continue;
    issues.push({
      kind,
      key: entry.key,
      detail: `${entry.message}`,
      locations: [entry.file ? `${entry.file}${entry.line ? `:${entry.line}` : ""}` : "output.log"],
    });
  }

  return issues;
}

const ORDER: CheckIssue["kind"][] = [
  "undefined-reference",
  "undefined-citation",
  "duplicate-label",
  "uncited-entry",
  "unused-label",
];

export function formatCheck(issues: CheckIssue[], limit = 30): string {
  if (issues.length === 0) return "No dangling references, citations, or duplicate labels found.";

  const parts: string[] = [`${issues.length} issue(s)`];
  for (const kind of ORDER) {
    const group = issues.filter((issue) => issue.kind === kind);
    if (group.length === 0) continue;
    const shown = group.slice(0, limit);
    const lines = shown.map(
      (issue) => `  ${issue.key}  ${issue.locations.slice(0, 4).join(", ")}${issue.locations.length > 4 ? ", ..." : ""}`,
    );
    parts.push(
      `\n${kind} (${group.length}):\n${lines.join("\n")}${
        group.length > shown.length ? `\n  ... ${group.length - shown.length} more` : ""
      }`,
    );
  }
  return parts.join("\n");
}
