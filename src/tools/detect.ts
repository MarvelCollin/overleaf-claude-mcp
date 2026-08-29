import { z } from "zod";
import { DETECT_MIN_CHARS } from "../config.js";
import { detect } from "../detect/engine.js";
import { formatDetection, formatPlagiarism } from "../detect/format.js";
import { extractProse } from "../detect/latex-text.js";
import { checkPlagiarism } from "../detect/plagiarism.js";
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

interface Gathered {
  document: ProseDocument;
  source: string;
}

async function gather(
  ctx: Parameters<ToolModule>[1],
  args: { text?: string; filePath?: string; wholeProject?: boolean; projectId?: string; plain?: boolean },
): Promise<Gathered> {
  if (args.text) {
    let document = args.plain ? asPlain(args.text) : extractProse(args.text);
    if (document.blocks.length === 0) document = asPlain(args.text);
    return { document, source: "pasted text" };
  }

  if (args.wholeProject) {
    const id = await ctx.activeProject(args.projectId);
    const sources = (await ctx.workspace.sources(id)).filter((s) => /\.tex$/i.test(s.path));
    if (sources.length === 0) throw new Error("no .tex files in this project");
    return {
      document: combine(sources.map((s) => tag(extractProse(s.content), s.path))),
      source: `${sources.length} source file(s)`,
    };
  }

  if (args.filePath) {
    const id = await ctx.activeProject(args.projectId);
    const content = await ctx.workspace.readText(id, args.filePath);
    const parsed =
      args.plain || !TEX_FILE.test(args.filePath) ? asPlain(content) : extractProse(content);
    return { document: tag(parsed, args.filePath), source: args.filePath };
  }

  throw new Error("Pass text, filePath or wholeProject.");
}

function requireProse(document: ProseDocument): void {
  const size = document.text.trim().length;
  if (size < DETECT_MIN_CHARS) {
    throw new Error(
      `Only ${size} characters of prose to check, the checkers need at least ${DETECT_MIN_CHARS}.`,
    );
  }
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
        const { document, source } = await gather(ctx, {
          text: pasted,
          filePath,
          wholeProject,
          projectId,
          plain,
        });
        requireProse(document);

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
    "overleaf_plagiarism_check",
    {
      title: "Check text for plagiarism",
      description:
        "Search the web for verbatim copies of the sentences in the text and report which ones already exist online, with the source URL and the file and line the sentence came from. Sentences are searched as exact phrases, so a hit means the wording appears on that page word for word. Pass text to check a pasted passage, filePath to check one project file, or wholeProject to check every source file. LaTeX markup is stripped before checking.",
      inputSchema: {
        text: z.string().optional(),
        filePath: z.string().optional(),
        wholeProject: z.boolean().optional(),
        projectId: z.string().optional(),
        plain: z.boolean().optional().describe("skip LaTeX stripping and check the text as given"),
        maxQueries: z
          .number()
          .int()
          .positive()
          .max(40)
          .optional()
          .describe("how many sentences to search, sampled evenly across the text, default 12"),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ text: pasted, filePath, wholeProject, projectId, plain, maxQueries, limit }) =>
      guard(async () => {
        const { document, source } = await gather(ctx, {
          text: pasted,
          filePath,
          wholeProject,
          projectId,
          plain,
        });
        requireProse(document);

        const report = await checkPlagiarism({
          text: document.text,
          blocks: document.blocks,
          maxQueries,
        });

        return text(formatPlagiarism(report, source, limit ?? 25));
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
