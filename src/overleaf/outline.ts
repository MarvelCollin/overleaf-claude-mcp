import { stripComments } from "./check.js";
import type { OutlineNode } from "./types.js";

const SECTION =
  /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\s*\*?\s*\{/;
const LABEL = /\\label\s*\{([^}]*)\}/;
const CAPTION = /\\caption\s*(?:\[[^\]]*\])?\s*\{/;
const ENVIRONMENT = /\\begin\s*\{(figure\*?|table\*?|algorithm\d*|lstlisting|equation\*?)\}/;
const INPUT = /\\(input|include|subfile)\s*\{([^}]*)\}/;
const BIBLIOGRAPHY = /\\(bibliography|addbibresource)\s*\{([^}]*)\}/;

const DEPTH: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

function braced(line: string, from: number): string {
  let depth = 0;
  for (let i = from; i < line.length; i += 1) {
    const char = line[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return line.slice(from + 1, i);
    }
  }
  return line.slice(from + 1).replace(/\}\s*$/, "");
}

export function buildOutline(content: string): OutlineNode[] {
  const lines = content.split(/\r?\n/);
  const nodes: OutlineNode[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const line = stripComments(raw);
    const at = i + 1;

    const section = line.match(SECTION);
    if (section && section.index !== undefined) {
      nodes.push({
        kind: section[1] ?? "section",
        title: braced(line, line.indexOf("{", section.index)).trim(),
        line: at,
        depth: DEPTH[section[1] ?? "section"] ?? 2,
      });
    }

    const environment = line.match(ENVIRONMENT);
    if (environment) {
      nodes.push({ kind: environment[1] ?? "env", title: "", line: at, depth: 7 });
    }

    const caption = line.match(CAPTION);
    if (caption && caption.index !== undefined) {
      nodes.push({
        kind: "caption",
        title: braced(line, line.indexOf("{", caption.index)).trim().slice(0, 100),
        line: at,
        depth: 8,
      });
    }

    for (const label of line.matchAll(new RegExp(LABEL, "g"))) {
      nodes.push({ kind: "label", title: label[1] ?? "", line: at, depth: 8 });
    }

    const input = line.match(INPUT) ?? line.match(BIBLIOGRAPHY);
    if (input) {
      nodes.push({ kind: input[1] ?? "input", title: input[2] ?? "", line: at, depth: 7 });
    }
  }

  return nodes;
}

export function formatOutline(filePath: string, content: string): string {
  const nodes = buildOutline(content);
  const lines = content.split(/\r?\n/).length;
  if (nodes.length === 0) {
    return `${filePath}: ${content.length} chars over ${lines} lines, no sections, labels or captions found.`;
  }

  const body = nodes
    .map((node) => {
      const indent = "  ".repeat(Math.min(node.depth, 6));
      const title = node.title ? ` ${node.title}` : "";
      return `${String(node.line).padStart(6)}  ${indent}\\${node.kind}${title}`;
    })
    .join("\n");

  return `${filePath} outline: ${content.length} chars over ${lines} lines, ${nodes.length} entr(ies)\n\n${body}`;
}
