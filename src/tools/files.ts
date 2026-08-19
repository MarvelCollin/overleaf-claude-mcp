import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { MAX_READ_CHARS } from "../config.js";
import { renderTree } from "../overleaf/tree.js";
import { isImage, mimeFor } from "../overleaf/workspace.js";
import { failure, guard, image, text } from "./registry.js";
import type { ToolModule, ToolResult } from "./types.js";

function linesWithinBudget(lines: string[]): number {
  let cutoff = 0;
  let shown = 0;
  while (cutoff < lines.length && shown + (lines[cutoff]?.length ?? 0) + 1 <= MAX_READ_CHARS) {
    shown += (lines[cutoff]?.length ?? 0) + 1;
    cutoff += 1;
  }
  return cutoff;
}

function renderSlice(filePath: string, lines: string[], startLine?: number, endLine?: number): ToolResult {
  const from = Math.max(1, startLine ?? 1);
  const to = Math.min(lines.length, endLine ?? lines.length);
  if (from > lines.length) {
    return failure(new Error(`${filePath} has ${lines.length} lines, so line ${from} does not exist.`));
  }
  const slice = lines.slice(from - 1, to).join("\n");
  return text(`${filePath} lines ${from}-${to} of ${lines.length}\n\n${slice.slice(0, MAX_READ_CHARS)}`);
}

async function saveLocally(bytes: Buffer, destPath: string): Promise<string> {
  const target = path.resolve(destPath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, bytes);
  return target;
}

export { saveLocally };

export const registerFileTools: ToolModule = (server, ctx) => {
  server.registerTool(
    "overleaf_list_files",
    {
      title: "List project files",
      description: "List every file and folder in the project.",
      inputSchema: { projectId: z.string().optional(), refresh: z.boolean().optional() },
    },
    async ({ projectId, refresh }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const tree = await ctx.workspace.tree(id, refresh ?? false);
        return text(
          `${tree.name} (${id})\nroot doc: ${tree.rootDocId ?? "unset"}\n\n${renderTree(tree)}`,
        );
      }),
  );

  server.registerTool(
    "overleaf_read_file",
    {
      title: "Read a text file",
      description:
        "Read a LaTeX or other text file. Long files are truncated; use startLine and endLine to page through them.",
      inputSchema: {
        filePath: z.string(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
        projectId: z.string().optional(),
      },
    },
    async ({ filePath, startLine, endLine, projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const content = await ctx.workspace.readText(id, filePath);
        const lines = content.split("\n");

        if (startLine || endLine) return renderSlice(filePath, lines, startLine, endLine);
        if (content.length <= MAX_READ_CHARS) return text(content);

        const cutoff = linesWithinBudget(lines);
        return text(
          `${filePath} is ${content.length} chars over ${lines.length} lines. Showing lines 1-${cutoff}.\n` +
            `Read the rest with startLine ${cutoff + 1}, or search it with overleaf_grep.\n\n` +
            lines.slice(0, cutoff).join("\n"),
        );
      }),
  );

  server.registerTool(
    "overleaf_read_image",
    {
      title: "View an image",
      description: "Fetch an image from the project so it can be viewed directly.",
      inputSchema: { filePath: z.string(), projectId: z.string().optional() },
    },
    async ({ filePath, projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        if (!isImage(filePath)) {
          return failure(new Error(`"${filePath}" is not an image. Use overleaf_download_file.`));
        }
        return image(await ctx.workspace.readBinary(id, filePath), mimeFor(filePath));
      }),
  );

  server.registerTool(
    "overleaf_download_file",
    {
      title: "Download a file",
      description: "Save any project file, including PDFs and images, to a local path.",
      inputSchema: {
        filePath: z.string(),
        destPath: z.string(),
        projectId: z.string().optional(),
      },
    },
    async ({ filePath, destPath, projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const bytes = await ctx.workspace.readBinary(id, filePath);
        const target = await saveLocally(bytes, destPath);
        return text(`Saved ${bytes.length} bytes to ${target}`);
      }),
  );

  server.registerTool(
    "overleaf_grep",
    {
      title: "Search the project",
      description: "Regex search across every text file in the project.",
      inputSchema: {
        pattern: z.string(),
        flags: z.string().optional(),
        maxMatches: z.number().int().positive().optional(),
        projectId: z.string().optional(),
      },
    },
    async ({ pattern, flags, maxMatches, projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const hits = await ctx.workspace.grep(id, pattern, { flags, maxMatches });
        if (hits.length === 0) return text(`No matches for /${pattern}/`);
        return text(hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n"));
      }),
  );
};
