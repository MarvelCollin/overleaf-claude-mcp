import path from "node:path";
import fsp from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadSessionOrThrow } from "../auth/session.js";
import { OverleafClient } from "../overleaf/client.js";
import { check, report } from "./shared-checks.js";
import type { CallOutcome } from "./types.js";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const ENTRY = path.join(ROOT, "dist", "index.js");
const NAME = process.env.OVERLEAF_FEATURE_PROJECT ?? `claude-mcp-featurecheck-${Date.now()}`;

const MAIN_TEX = String.raw`\documentclass{article}
\usepackage[margin=1in]{geometry}
\begin{document}

\section{Introduction}\label{sec:intro}
This paper refers to \ref{sec:intro} and to \ref{fig:nowhere}, which does not exist.
It cites \cite{knuth1984} and \cite{ghost2020}.

\section{Method}\label{sec:dup}
\subsection{Details}\label{sec:dup}

\noindent\begin{minipage}{2cm}
Supercalifragilisticexpialidociousantidisestablishmentarianismfloccinaucinihilipilification
\end{minipage}

\noindent\begin{minipage}{2cm}
Pneumonoultramicroscopicsilicovolcanoconiosisthyroparathyroidectomizedhonorificabilitudinitatibus
\end{minipage}

\begin{table}[t]
\caption{Split precision results}\label{tab:results}
\centering
\begin{tabular}{l}
An intentionally long single column row that runs well past the printable width of this page layout
\end{tabular}
\end{table}

\begin{thebibliography}{9}
\bibitem{knuth1984} D. Knuth. The TeXbook.
\bibitem{unread1999} Nobody. An uncited work.
\end{thebibliography}

\end{document}
`;

function bigTex(): string {
  const parts: string[] = ["\\documentclass{article}", "\\begin{document}"];
  for (let i = 1; i <= 400; i += 1) {
    parts.push(`\\section{Generated section ${i}}\\label{sec:gen${i}}`);
    parts.push(`\\begin{figure}\\caption{Figure for section ${i}}\\label{fig:gen${i}}\\end{figure}`);
    parts.push("Filler text ".repeat(12));
  }
  parts.push("\\end{document}");
  return parts.join("\n");
}

async function main(): Promise<void> {
  const session = await loadSessionOrThrow();
  const created = await new OverleafClient(session).createProject(NAME);
  const projectId = created.project_id;
  if (!projectId) throw new Error("createProject did not return a project_id");
  process.stdout.write(`Created a fresh project "${NAME}" (${projectId})\n\n`);

  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "overleaf-featurecheck-"));
  const bigPath = path.join(scratch, "big.tex");
  await fsp.writeFile(bigPath, bigTex(), "utf8");

  const transport = new StdioClientTransport({ command: "node", args: [ENTRY] });
  const client = new Client({ name: "overleaf-feature-check", version: "1.0.0" });
  await client.connect(transport);

  const call = async (name: string, args: Record<string, unknown>): Promise<CallOutcome> => {
    const result = (await client.callTool({
      name,
      arguments: { ...args, projectId },
    })) as { isError?: boolean; content?: { type: string; text?: string }[] };
    const parts = result.content ?? [];
    return {
      ok: result.isError !== true,
      body: parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n"),
      images: parts.filter((p) => p.type === "image").length,
    };
  };

  const listed = await client.listTools();
  const names = listed.tools.map((t) => t.name);
  check("overleaf_set_session is exposed", names.includes("overleaf_set_session"), names.join(", "));
  check("overleaf_check is exposed", names.includes("overleaf_check"), names.join(", "));

  const uploadDescription = listed.tools.find((t) => t.name === "overleaf_upload_file")?.description ?? "";
  check(
    "upload_file advertises text files",
    /\.tex/.test(uploadDescription) && /text/i.test(uploadDescription),
    uploadDescription,
  );

  const write = await call("overleaf_write_file", { filePath: "main.tex", content: MAIN_TEX, force: true });
  check("write main.tex", write.ok, write.body);

  const upload = await call("overleaf_upload_file", { localPath: bigPath, filePath: "big.tex" });
  check("upload a large local .tex", upload.ok && upload.body.includes("bytes"), upload.body);

  const compile = await call("overleaf_compile", { refresh: true });
  check("compile reports a page count", compile.ok && /pages: \d+/.test(compile.body), compile.body.split("\n").slice(0, 4).join(" | "));
  check("compile reports cache freshness", compile.body.includes("compiled just now"), compile.body.split("\n")[0] ?? "");
  check("compile points at the artifacts", compile.body.includes("output.log"), compile.body);

  const cached = await call("overleaf_compile", {});
  check("second compile is reused from cache", cached.body.includes("reused a compile"), cached.body.split("\n")[0] ?? "");

  const log = await call("overleaf_compile_log", { limit: 5 });
  check("compile_log groups by kind", log.ok && log.body.includes("by kind:"), log.body.split("\n").slice(0, 12).join(" | "));
  check("compile_log groups by file", log.body.includes("by file:"), log.body);
  check("compile_log paginates", /showing 1-\d+ of \d+/.test(log.body), log.body);
  check(
    "compile_log resolves real locations",
    /- main\.tex:\d+/.test(log.body) || /- main\.tex:\d+-\d+/.test(log.body),
    log.body.split("\n").filter((l) => l.startsWith("- ")).slice(0, 6).join(" | "),
  );
  check("compile_log leaves nothing at unknown location", !log.body.includes("(unknown location)"), log.body);

  const overfull = await call("overleaf_compile_log", { kind: "overfull", limit: 50, group: false });
  check("compile_log filters by kind", overfull.ok && /Overfull/.test(overfull.body), overfull.body.split("\n").slice(0, 6).join(" | "));

  const offset = await call("overleaf_compile_log", { limit: 2, offset: 2, group: false });
  check("compile_log honours offset", /showing 3-4 of/.test(offset.body), offset.body.split("\n").find((l) => l.startsWith("showing")) ?? offset.body);

  const errorsOnly = await call("overleaf_compile_log", { severity: "error", group: false });
  check("compile_log filters by severity", errorsOnly.ok, errorsOnly.body.split("\n").slice(0, 4).join(" | "));

  const logPath = path.join(scratch, "output.log");
  const artifact = await call("overleaf_download_file", { filePath: "output.log", destPath: logPath });
  check("download_file fetches output.log", artifact.ok && artifact.body.includes("compilation artifact"), artifact.body);
  const savedLog = await fsp.readFile(logPath, "utf8").catch(() => "");
  check("the downloaded log is a real LaTeX log", savedLog.includes("Output written on"), `${savedLog.length} bytes`);

  const blg = await call("overleaf_download_file", { filePath: "output.blg", destPath: path.join(scratch, "output.blg") });
  check("download_file handles a missing artifact cleanly", blg.ok || blg.body.includes("produced no"), blg.body.slice(0, 160));

  const checked = await call("overleaf_check", {});
  check("check finds the dangling ref", checked.ok && checked.body.includes("fig:nowhere"), checked.body);
  check("check finds the undefined citation", checked.body.includes("ghost2020"), checked.body);
  check("check finds the duplicate label", checked.body.includes("sec:dup"), checked.body);
  check("check finds the uncited bibitem", checked.body.includes("unread1999"), checked.body);
  check("check reports file and line", /main\.tex:\d+/.test(checked.body), checked.body);

  const outline = await call("overleaf_read_file", { filePath: "big.tex" });
  check("a too large file falls back to an outline", outline.ok && outline.body.includes("outline:"), outline.body.split("\n").slice(0, 3).join(" | "));
  check("the outline lists sections", outline.body.includes("Generated section 1"), outline.body.split("\n").slice(0, 6).join(" | "));
  check("the outline lists captions", outline.body.includes("\\caption"), outline.body.split("\n").slice(0, 12).join(" | "));

  const smallOutline = await call("overleaf_read_file", { filePath: "main.tex", outline: true });
  check("outline can be requested for any file", smallOutline.ok && smallOutline.body.includes("Split precision results"), smallOutline.body.split("\n").slice(0, 10).join(" | "));

  const pdfPath = path.join(scratch, "out.pdf");
  const pdf = await call("overleaf_download_pdf", { destPath: pdfPath });
  check("download_pdf reports pages", pdf.ok && /\d+ page\(s\)/.test(pdf.body), pdf.body);

  const staleProbe = await call("overleaf_edit_file", {
    filePath: "main.tex",
    oldString: "does not exist.",
    newString: "does not exist at all.",
  });
  check("edit invalidates the compile cache", staleProbe.ok, staleProbe.body);
  const afterEdit = await call("overleaf_compile", {});
  check("compile after an edit is not served from cache", afterEdit.body.includes("compiled just now"), afterEdit.body.split("\n")[0] ?? "");

  await client.close();
  await fsp.rm(scratch, { recursive: true, force: true });

  report();
  process.stdout.write(`Scratch project "${NAME}" (${projectId}) is left in the account. Trash it when done.\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
