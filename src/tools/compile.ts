import { z } from "zod";
import { parseLatexLog, summarizeLog } from "../overleaf/latex-log.js";
import { saveLocally } from "./files.js";
import { guard, text } from "./registry.js";
import type { ToolModule } from "./types.js";

export const registerCompileTools: ToolModule = (server, ctx) => {
  server.registerTool(
    "overleaf_compile",
    {
      title: "Compile the project",
      description: "Run a server-side LaTeX compile and report status plus output files.",
      inputSchema: {
        projectId: z.string().optional(),
        draft: z.boolean().optional(),
        stopOnFirstError: z.boolean().optional(),
      },
    },
    async ({ projectId, draft, stopOnFirstError }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const result = await ctx.client.compile(id, { draft, stopOnFirstError });
        const files = result.outputFiles.map((f) => `- ${f.path}`).join("\n");
        return text(`status: ${result.status}\n\noutput files:\n${files || "(none)"}`);
      }),
  );

  server.registerTool(
    "overleaf_compile_log",
    {
      title: "Compile and read the log",
      description: "Compile the project and return parsed LaTeX errors and warnings.",
      inputSchema: { projectId: z.string().optional() },
    },
    async ({ projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const result = await ctx.client.compile(id);
        const logFile = result.outputFiles.find((f) => f.path.endsWith("output.log"));
        if (!logFile) {
          return text(
            `status: ${result.status}\nNo output.log was produced. Output files: ${
              result.outputFiles.map((f) => f.path).join(", ") || "(none)"
            }`,
          );
        }

        const log = (await ctx.client.fetchOutput(logFile.url, result.clsiServerId)).toString("utf8");
        const entries = parseLatexLog(log);
        const summary = summarizeLog(entries);
        if (entries.some((e) => e.level === "error") || result.status === "success") {
          return text(`status: ${result.status}\n\n${summary}`);
        }

        const tail = log.split(/\r?\n/).slice(-60).join("\n");
        return text(`status: ${result.status}\n\n${summary}\n\nLast 60 log lines:\n${tail}`);
      }),
  );

  server.registerTool(
    "overleaf_download_pdf",
    {
      title: "Download the compiled PDF",
      description: "Compile the project and save the resulting PDF locally.",
      inputSchema: { destPath: z.string(), projectId: z.string().optional() },
    },
    async ({ destPath, projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const result = await ctx.client.compile(id);
        const pdf = result.outputFiles.find((f) => f.path.endsWith(".pdf"));
        if (!pdf) return text(`status: ${result.status}\nNo PDF was produced.`);

        const bytes = await ctx.client.fetchOutput(pdf.url, result.clsiServerId);
        const target = await saveLocally(bytes, destPath);
        return text(`Saved ${bytes.length} bytes to ${target}`);
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
