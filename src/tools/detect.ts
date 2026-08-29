import { z } from "zod";
import { DETECT_MIN_CHARS } from "../config.js";
import { detect } from "../detect/engine.js";
import { formatDetection } from "../detect/format.js";
import { extractProse } from "../detect/latex-text.js";
import { ALL_PROVIDERS } from "../detect/providers/index.js";
import type { ProseBlock, ProseDocument } from "../detect/types.js";
import { failure, guard, text } from "./registry.js";
import type { ToolModule } from "./types.js";

const TEX_FILE = /\.(tex|bib|sty|cls|txt|md)$/i;

function asPlain(value: string): ProseDocument {
  const blocks: ProseBlock[] = [];
  let line = 1;
  for (const paragraph of value.split(/\r?\n\s*\r?\n/)) {
    const trimmed = paragraph.replace(/\s+/g, " ").trim();
    if (trimmed.length > 0) blocks.push({ text: trimmed, line });
    line += paragraph.split(/\r?\n/).length + 1;
  }
  return { blocks, text: blocks.map((b) => b.text).join("\n\n") };
}

function tag(document: ProseDocument, path: string): ProseDocument {
  for (const block of document.blocks) block.path = path;
  return document;
}

function combine(documents: ProseDocument[]): ProseDocument {
  const blocks = documents.flatMap((d) => d.blocks);
  return { blocks, text: blocks.map((b) => b.text).join("\n\n") };
}

export const registerDetectTools: ToolModule = (server, ctx) => {
  server.registerTool(
    "overleaf_ai_detect",
    {
      title: "Check text for AI detection",
      description:
        "Run text through free AI content detectors and report how much of it reads as AI written, with the exact sentences each detector flagged and the file and line they came from. Pass text to check a pasted passage, filePath to check one project file, or wholeProject to check every source file. LaTeX markup, math, figures and citations are stripped before checking so only prose is scored.",
      inputSchema: {
        text: z.string().optional(),
        filePath: z.string().optional(),
        wholeProject: z.boolean().optional(),
        projectId: z.string().optional(),
        providers: z
          .array(z.string())
          .optional()
          .describe(`any of: ${ALL_PROVIDERS.map((p) => p.name).join(", ")}`),
        plain: z.boolean().optional().describe("skip LaTeX stripping and score the text as given"),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ text: pasted, filePath, wholeProject, projectId, providers, plain, limit }) =>
      guard(async () => {
        let document: ProseDocument;
        let source: string;

        if (pasted) {
          document = plain ? asPlain(pasted) : extractProse(pasted);
          if (document.blocks.length === 0) document = asPlain(pasted);
          source = "pasted text";
        } else if (wholeProject) {
          const id = await ctx.activeProject(projectId);
          const sources = (await ctx.workspace.sources(id)).filter((s) => /\.tex$/i.test(s.path));
          if (sources.length === 0) return failure(new Error("no .tex files in this project"));
          document = combine(sources.map((s) => tag(extractProse(s.content), s.path)));
          source = `${sources.length} source file(s)`;
        } else if (filePath) {
          const id = await ctx.activeProject(projectId);
          const content = await ctx.workspace.readText(id, filePath);
          const parsed = plain || !TEX_FILE.test(filePath) ? asPlain(content) : extractProse(content);
          document = tag(parsed, filePath);
          source = filePath;
        } else {
          return failure(new Error("Pass text, filePath or wholeProject."));
        }

        if (document.text.trim().length < DETECT_MIN_CHARS) {
          return failure(
            new Error(
              `Only ${document.text.trim().length} characters of prose to check, the detectors need at least ${DETECT_MIN_CHARS}.`,
            ),
          );
        }

        const result = await detect({
          text: document.text,
          blocks: document.blocks,
          providers,
        });

        const ran = result.outcomes.filter((o) => o.report).length;
        if (ran === 0) {
          const why = result.outcomes
            .map((o) => `${o.provider}: ${o.error ?? o.skipped ?? "no result"}`)
            .join("\n");
          return failure(new Error(`No detector returned a result.\n${why}`));
        }

        return text(formatDetection(result, source, limit ?? 25));
      }),
  );

  server.registerTool(
    "overleaf_detectors",
    {
      title: "List AI detectors",
      description:
        "List the AI detection providers this server can use, which are ready to run and what each one needs.",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const lines = ALL_PROVIDERS.map((provider) => {
          const state = provider.available()
            ? "ready"
            : `needs ${provider.requires ?? "configuration"}`;
          return `${provider.name.padEnd(10)}${provider.label.padEnd(12)}${state}, up to ${provider.maxChars} chars per request`;
        });
        return text(
          `${lines.join("\n")}\n\nProviders marked ready run by default. Longer text is split into chunks and the scores are averaged by length.`,
        );
      }),
  );
};
