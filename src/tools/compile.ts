import { z } from "zod";
import { describeAge } from "../overleaf/artifacts.js";
import { checkReferences, formatCheck } from "../overleaf/check.js";
import { formatLog, parseLatexLog } from "../overleaf/latex-log.js";
import { saveLocally } from "./files.js";
import { guard, text } from "./registry.js";
import type { ToolModule } from "./types.js";

const KINDS = [
  "error",
  "missing-file",
  "overfull-hbox",
  "underfull-hbox",
  "overfull-vbox",
  "underfull-vbox",
  "undefined-reference",
  "undefined-citation",
  "duplicate-label",
  "font-warning",
  "package-warning",
  "class-warning",
  "latex-warning",
];

export const registerCompileTools: ToolModule = (server, ctx) => {
  server.registerTool(
    "overleaf_compile",
    {
      title: "Compile the project",
      description:
        "Run a server-side LaTeX compile and report status, page count and output files. Results are cached briefly; pass refresh to force a new compile.",
      inputSchema: {
        projectId: z.string().optional(),
        draft: z.boolean().optional(),
        stopOnFirstError: z.boolean().optional(),
        refresh: z.boolean().optional(),
      },
    },
    async ({ projectId, draft, stopOnFirstError, refresh }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const snapshot = await ctx.artifacts.compile(id, { draft, stopOnFirstError, refresh });
        const files = snapshot.result.outputFiles.map((f) => `- ${f.path}`).join("\n");

        const lines = [`status: ${snapshot.result.status} (${describeAge(snapshot)})`];
        const { text: log } = await ctx.artifacts.log(id);
        if (log) {
          const parsed = parseLatexLog(log);
          const errors = parsed.entries.filter((e) => e.level === "error").length;
          if (parsed.pages !== undefined) lines.push(`pages: ${parsed.pages}`);
          lines.push(
            `log: ${errors} error(s), ${parsed.entries.length - errors} warning(s). Read them with overleaf_compile_log.`,
          );
        }
        lines.push(`\noutput files:\n${files || "(none)"}`);
        lines.push(
          "\nAny output.* artifact can be saved with overleaf_download_file, for example output.log.",
        );
        return text(lines.join("\n"));
      }),
  );

  server.registerTool(
    "overleaf_compile_log",
    {
      title: "Compile and read the log",
      description:
        "Compile the project and return parsed LaTeX errors and warnings with real file:line locations, grouped by kind and file. Page through them with limit and offset, and narrow them with severity, kind or file.",
      inputSchema: {
        projectId: z.string().optional(),
        severity: z.enum(["error", "warning", "all"]).optional(),
        kind: z
          .string()
          .optional()
          .describe(`substring of a warning kind, one of: ${KINDS.join(", ")}`),
        file: z.string().optional(),
        limit: z.number().int().positive().max(500).optional(),
        offset: z.number().int().nonnegative().optional(),
        group: z.boolean().optional(),
        refresh: z.boolean().optional(),
      },
    },
    async ({ projectId, severity, kind, file, limit, offset, group, refresh }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const { text: log, snapshot } = await ctx.artifacts.log(id, refresh);
        if (!log) {
          return text(
            `status: ${snapshot.result.status}\nNo output.log was produced. Output files: ${
              snapshot.result.outputFiles.map((f) => f.path).join(", ") || "(none)"
            }`,
          );
        }

        const parsed = parseLatexLog(log);
        const header = [`status: ${snapshot.result.status} (${describeAge(snapshot)})`];
        if (parsed.pages !== undefined) header.push(`pages: ${parsed.pages}`);

        const summary = formatLog(parsed.entries, { severity, kind, file, limit, offset, group });
        const failed = snapshot.result.status !== "success";
        const hasError = parsed.entries.some((e) => e.level === "error");

        if (!failed || hasError) return text(`${header.join("\n")}\n\n${summary}`);

        const tail = log.split(/\r?\n/).slice(-60).join("\n");
        return text(`${header.join("\n")}\n\n${summary}\n\nLast 60 log lines:\n${tail}`);
      }),
  );

  server.registerTool(
    "overleaf_check",
    {
      title: "Check references and citations",
      description:
        "Report dangling \\ref, undefined \\cite, duplicate \\label and uncited bibliography entries across the project, with the file and line of every occurrence.",
      inputSchema: {
        projectId: z.string().optional(),
        includeLog: z.boolean().optional(),
        reportUnusedLabels: z.boolean().optional(),
        limit: z.number().int().positive().max(500).optional(),
      },
    },
    async ({ projectId, includeLog, reportUnusedLabels, limit }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const sources = await ctx.workspace.sources(id);

        let logEntries: ReturnType<typeof parseLatexLog>["entries"] = [];
        let note = "static analysis only";
        if (includeLog !== false) {
          try {
            const { text: log, snapshot } = await ctx.artifacts.log(id);
            if (log) {
              logEntries = parseLatexLog(log).entries;
              note = `static analysis plus output.log from a ${snapshot.result.status} compile`;
            }
          } catch (err) {
            note = `static analysis only, the compile log was unavailable: ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }

        const issues = checkReferences(sources, logEntries, { reportUnusedLabels });
        return text(
          `${sources.length} source file(s), ${note}\n\n${formatCheck(issues, limit ?? 30)}`,
        );
      }),
  );

  server.registerTool(
    "overleaf_download_pdf",
    {
      title: "Download the compiled PDF",
      description: "Compile the project and save the resulting PDF locally.",
      inputSchema: {
        destPath: z.string(),
        projectId: z.string().optional(),
        refresh: z.boolean().optional(),
      },
    },
    async ({ destPath, projectId, refresh }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const snapshot = await ctx.artifacts.compile(id, { refresh });
        const pdf = snapshot.result.outputFiles.find((f) => f.path.endsWith(".pdf"));
        if (!pdf) return text(`status: ${snapshot.result.status}\nNo PDF was produced.`);

        const bytes = await ctx.client.fetchOutput(pdf.url, snapshot.result.clsiServerId);
        const target = await saveLocally(bytes, destPath);
        const pages = (bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
        return text(
          `Saved ${bytes.length} bytes to ${target}${pages > 0 ? `, ${pages} page(s)` : ""}`,
        );
      }),
  );

  server.registerTool(
    "overleaf_word_count",
    {
      title: "Word count",
      description: "Return the compiled word count for the project.",
      inputSchema: { projectId: z.string().optional() },
    },
    async ({ projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        return text(JSON.stringify(await ctx.client.wordCount(id), null, 2));
      }),
  );
};
