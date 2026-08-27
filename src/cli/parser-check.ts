import { filterEntries, formatLog, parseLatexLog, reflow } from "../overleaf/latex-log.js";
import { check, report } from "./shared-checks.js";

const LOG = [
  "This is pdfTeX, Version 3.141592653-2.6-1.40.25 (TeX Live 2023) (preloaded format=pdflatex)",
  "entering extended mode",
  "(./main.tex",
  "LaTeX2e <2023-11-01> patch level 1",
  "(/usr/local/texlive/2023/texmf-dist/tex/latex/base/article.cls",
  "Document Class: article 2023/05/17 v1.4n Standard LaTeX document class",
  "(/usr/local/texlive/2023/texmf-dist/tex/latex/base/size10.clo))",
  "(./sections/intro.tex",
  "Overfull \\hbox (36.51074pt too wide) in paragraph at lines 12--14",
  "[]\\OT1/cmr/m/n/10 Supercalifragilisticexpialidocious",
  "LaTeX Warning: Reference `fig:missing' on page 1 undefined on input line 20.",
  ")",
  "LaTeX Warning: Citation `nobody2020' on page 1 undefined on input line 25.",
  "Overfull \\hbox (5.0pt too wide) in paragraph at lines 30--31",
  "Underfull \\vbox (badness 10000) has occurred while \\output is active [4]",
  "LaTeX Warning: Label `sec:dup' multiply defined.",
  "Package hyperref Warning: Token not allowed in a PDF string (Unicode):",
  "(hyperref)                removing `\\new'",
  "! Undefined control sequence.",
  "l.42 \\nosuchmacro",
  "                 ",
  "Output written on output.pdf (3 pages, 45678 bytes).",
].join("\n");

function run(): void {
  const parsed = parseLatexLog(LOG);
  const entries = parsed.entries;
  const find = (kind: string): (typeof entries)[number] | undefined =>
    entries.find((e) => e.kind === kind);

  check("page count comes from the log", parsed.pages === 3, String(parsed.pages));

  const overfull = find("overfull-hbox");
  check("overfull hbox is located in the right file", overfull?.file === "sections/intro.tex", overfull?.file);
  check("overfull hbox carries a line range", overfull?.line === 12 && overfull?.endLine === 14, JSON.stringify(overfull));
  check("overfull hbox carries the overflow amount", overfull?.overflowPt === 36.51074, String(overfull?.overflowPt));

  const secondBox = entries.filter((e) => e.kind === "overfull-hbox")[1];
  check("file stack pops on a closing paren", secondBox?.file === "main.tex", secondBox?.file);
  check("underfull vbox is recognised", Boolean(find("underfull-vbox")), JSON.stringify(entries.map((e) => e.kind)));

  const reference = find("undefined-reference");
  check("undefined reference keeps its key", reference?.key === "fig:missing", reference?.key);
  check("undefined reference keeps file and line", reference?.file === "sections/intro.tex" && reference?.line === 20, JSON.stringify(reference));

  const citation = find("undefined-citation");
  check("undefined citation keeps its key", citation?.key === "nobody2020", citation?.key);
  check("duplicate label is recognised", find("duplicate-label")?.key === "sec:dup", find("duplicate-label")?.key);

  const hyperref = find("package-warning");
  check("package warning absorbs its continuation line", Boolean(hyperref?.message.includes("removing")), hyperref?.message);

  const error = entries.find((e) => e.level === "error");
  check("error keeps the l. line number", error?.line === 42, JSON.stringify(error));
  check("error is attributed to the open file", error?.file === "main.tex", error?.file);
  check("no entry is left without a location", entries.every((e) => Boolean(e.file)), JSON.stringify(entries.filter((e) => !e.file)));

  const warnings = filterEntries(entries, { severity: "warning" });
  check("severity filter drops errors", warnings.every((e) => e.level === "warning"), String(warnings.length));
  check("kind filter narrows to one kind", filterEntries(entries, { kind: "overfull" }).length === 2, JSON.stringify(filterEntries(entries, { kind: "overfull" }).length));
  check("file filter narrows to one file", filterEntries(entries, { file: "intro" }).length === 2, String(filterEntries(entries, { file: "intro" }).length));

  const page = formatLog(entries, { limit: 2, offset: 1 });
  check("formatLog paginates", page.includes("showing 2-3 of"), page.split("\n").find((l) => l.startsWith("showing")));
  check("formatLog reports what is left", page.includes("Pass offset 3."), page);
  check("formatLog groups by kind", page.includes("by kind:"), page);
  check("formatLog groups by file", page.includes("by file:"), page);

  const long = "(./wrapped/a-very-long-directory-name/document-with-a-long-name.tex";
  const source = `${long}${"x".repeat(200)}`;
  const width = 79;
  const wrapped: string[] = [];
  for (let i = 0; i < source.length; i += width) wrapped.push(source.slice(i, i + width));
  for (let i = 0; i < 8; i += 1) wrapped.push("y".repeat(width));
  wrapped.push("done");
  const rejoined = reflow(wrapped);
  check("reflow rejoins wrapped lines", rejoined[0] === source, rejoined[0]?.slice(0, 60));

  report();
}

run();
