import { stripComments } from "../overleaf/check.js";
import type { ProseBlock, ProseDocument } from "./types.js";

const SKIP_ENVIRONMENTS = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "alignat",
  "alignat*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "eqnarray",
  "eqnarray*",
  "displaymath",
  "math",
  "array",
  "matrix",
  "bmatrix",
  "pmatrix",
  "tabular",
  "tabular*",
  "tabularx",
  "longtable",
  "verbatim",
  "lstlisting",
  "minted",
  "tikzpicture",
  "pgfpicture",
  "thebibliography",
  "filecontents",
  "filecontents*",
]);

const FLOAT_ENVIRONMENTS = /^(figure|table|algorithm|algorithmic|subfigure|wrapfigure)\*?$/;

const DROPPED_ARGUMENTS =
  /\\(?:label|ref|eqref|autoref|pageref|nameref|vref|Vref|cref|Cref|cpageref|Cpageref|cite[a-zA-Z]*|nocite|includegraphics|input|include|subfile|bibliography|addbibresource|bibliographystyle|usepackage|documentclass|newcommand|renewcommand|def|setlength|geometry|hypersetup|graphicspath|color|textcolor|vspace|hspace|rule)\s*\*?\s*(?:\[[^\]]*\]\s*)*\{[^{}]*\}/g;

const KEPT_ARGUMENTS =
  /\\(?:textbf|textit|texttt|textsc|textrm|textsf|emph|underline|uline|mbox|text|footnote|caption|title|author|section|subsection|subsubsection|paragraph|subparagraph|chapter|part|item)\s*\*?\s*(?:\[[^\]]*\]\s*)*\{/g;

const BARE_COMMAND = /\\[a-zA-Z]+\s*\*?\s*(?:\[[^\]]*\])*/g;
const ACCENTS = /\\[^a-zA-Z\s]/g;
const URL_COMMAND = /\\(?:url|href)\s*\{[^{}]*\}(?:\s*\{([^{}]*)\})?/g;

function stripMath(line: string): string {
  return line
    .replace(/\\\[[\s\S]*?\\\]/g, " ")
    .replace(/\\\([\s\S]*?\\\)/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/(?<!\\)\$[^$]*\$/g, " ");
}

function unwrapKept(line: string): string {
  let out = "";
  let index = 0;
  KEPT_ARGUMENTS.lastIndex = 0;

  for (const match of line.matchAll(KEPT_ARGUMENTS)) {
    const start = match.index ?? 0;
    out += line.slice(index, start);
    let depth = 1;
    let cursor = start + match[0].length;
    while (cursor < line.length && depth > 0) {
      const char = line[cursor];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      if (depth > 0) out += char;
      cursor += 1;
    }
    index = cursor;
    KEPT_ARGUMENTS.lastIndex = cursor;
  }

  return out + line.slice(index);
}

function clean(line: string): string {
  let value = stripMath(stripComments(line));
  value = value.replace(URL_COMMAND, (_all, label: string | undefined) => label ?? " ");
  value = value.replace(DROPPED_ARGUMENTS, " ");
  value = unwrapKept(value);
  value = value.replace(BARE_COMMAND, " ").replace(ACCENTS, "");
  value = value.replace(/[{}~^_&]/g, " ").replace(/\\\\/g, " ");
  value = value.replace(/``|''/g, '"').replace(/\s+/g, " ");
  return value.trim();
}

function environmentName(line: string, keyword: "begin" | "end"): string | undefined {
  const match = line.match(new RegExp(`\\\\${keyword}\\s*\\{([^}]*)\\}`));
  return match?.[1]?.trim();
}

export function extractProse(source: string): ProseDocument {
  const lines = source.split(/\r?\n/);
  const blocks: ProseBlock[] = [];

  let inDocument = !/\\begin\s*\{document\}/.test(source);
  let skipDepth = 0;
  let skipName = "";
  let buffer: string[] = [];
  let bufferLine = 0;

  const flush = () => {
    const joined = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (joined.length > 0) blocks.push({ text: joined, line: bufferLine });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const begun = environmentName(raw, "begin");
    const ended = environmentName(raw, "end");

    if (ended === "document") break;
    if (begun === "document") {
      inDocument = true;
      continue;
    }
    if (!inDocument) continue;

    if (skipDepth > 0) {
      if (begun === skipName) skipDepth += 1;
      if (ended === skipName) skipDepth -= 1;
      continue;
    }

    if (begun && (SKIP_ENVIRONMENTS.has(begun) || FLOAT_ENVIRONMENTS.test(begun))) {
      flush();
      skipDepth = 1;
      skipName = begun;
      continue;
    }

    if (raw.trim().length === 0) {
      flush();
      continue;
    }

    const cleaned = clean(raw);
    if (cleaned.length === 0) continue;
    if (buffer.length === 0) bufferLine = i + 1;
    buffer.push(cleaned);
  }

  flush();

  return { blocks, text: blocks.map((b) => b.text).join("\n\n") };
}

export function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function locateSentence(blocks: ProseBlock[], sentence: string): number | undefined {
  const needle = normalise(sentence);
  if (needle.length < 12) return undefined;

  for (const block of blocks) {
    if (normalise(block.text).includes(needle)) return block.line;
  }

  const head = needle.split(" ").slice(0, 6).join(" ");
  if (head.length < 12) return undefined;
  for (const block of blocks) {
    if (normalise(block.text).includes(head)) return block.line;
  }
  return undefined;
}
