import { z } from "zod";
import { MAX_READ_CHARS } from "../config.js";
import type { ProjectUpdate } from "../overleaf/types.js";
import { normalizePath } from "../overleaf/tree.js";
import { failure, guard, text } from "./registry.js";
import type { ToolModule } from "./types.js";

function describeAuthors(update: ProjectUpdate): string {
  return (
    update.meta?.users
      ?.map((user) => [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email)
      .filter(Boolean)
      .join(", ") || "unknown"
  );
}

function describeUpdate(update: ProjectUpdate): string {
  const when = update.meta?.end_ts ? new Date(update.meta.end_ts).toISOString() : "unknown time";
  return `v${update.fromV}-${update.toV}  ${when}  ${describeAuthors(update)}\n    ${update.pathnames.join(", ")}`;
}

export const registerHistoryTools: ToolModule = (server, ctx) => {
  server.registerTool(
    "overleaf_history",
    {
      title: "Recent history",
      description:
        "List recent versions of the project: version range, who edited, when, and which files changed.",
      inputSchema: {
        count: z.number().int().positive().optional(),
        filePath: z.string().optional(),
        projectId: z.string().optional(),
      },
    },
    async ({ count, filePath, projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const limit = count ?? 10;
        const { updates } = await ctx.client.updates(id, limit);
        const wanted = filePath ? normalizePath(filePath) : null;
        const matching = wanted
          ? updates.filter((u) => u.pathnames.some((p) => normalizePath(p) === wanted))
          : updates;

        if (matching.length === 0) {
          return text(wanted ? `No recorded changes to ${filePath}.` : "No history recorded.");
        }

        const shown = matching.slice(0, limit);
        const omitted = matching.length - shown.length;
        return text(
          `${shown.length} of ${matching.length} update(s)${wanted ? ` touching ${filePath}` : ""}${
            omitted > 0 ? `, newest first` : ""
          }\n\n${shown.map(describeUpdate).join("\n")}`,
        );
      }),
  );

  server.registerTool(
    "overleaf_file_at_version",
    {
      title: "Read a past version",
      description: "Read the contents a file had at a given history version.",
      inputSchema: {
        filePath: z.string(),
        version: z.number().int().nonnegative(),
        projectId: z.string().optional(),
      },
    },
    async ({ filePath, version, projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const content = await ctx.workspace.contentAtVersion(id, filePath, version);
        if (!content) return text(`${filePath} was empty or absent at version ${version}.`);
        return text(
          content.length > MAX_READ_CHARS
            ? `${filePath} at v${version} is ${content.length} chars, truncated.\n\n${content.slice(0, MAX_READ_CHARS)}`
            : `${filePath} at v${version}\n\n${content}`,
        );
      }),
  );

  server.registerTool(
    "overleaf_diff",
    {
      title: "Diff two versions",
      description: "Show what changed in a file between two history versions.",
      inputSchema: {
        filePath: z.string(),
        from: z.number().int().nonnegative(),
        to: z.number().int().nonnegative(),
        projectId: z.string().optional(),
      },
    },
    async ({ filePath, from, to, projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const segments = await ctx.client.diff(id, normalizePath(filePath), from, to);
        const changes = segments.filter((s) => s.i !== undefined || s.d !== undefined);
        if (changes.length === 0) {
          return text(`${filePath} is unchanged between v${from} and v${to}.`);
        }

        const rendered = changes
          .map((segment) => {
            const marker = segment.i !== undefined ? "+" : "-";
            const body = (segment.i ?? segment.d ?? "").replace(/\n/g, `\n${marker} `);
            return `${marker} ${body}`;
          })
          .join("\n");
        return text(
          `${filePath} v${from} to v${to}, ${changes.length} change(s)\n\n${rendered.slice(0, MAX_READ_CHARS)}`,
        );
      }),
  );

  server.registerTool(
    "overleaf_restore_file",
    {
      title: "Restore a past version",
      description:
        "Overwrite a file with the contents it had at an earlier version. Requires confirm to be true.",
      inputSchema: {
        filePath: z.string(),
        version: z.number().int().nonnegative(),
        confirm: z.boolean(),
        projectId: z.string().optional(),
      },
    },
    async ({ filePath, version, confirm, projectId }) =>
      guard(async () => {
        if (!confirm) {
          return failure(
            new Error(`Refusing to restore ${filePath} to v${version} without confirm set to true.`),
          );
        }
        const id = await ctx.activeProject(projectId);
        const content = await ctx.workspace.contentAtVersion(id, filePath, version);
        if (!content) {
          return failure(new Error(`${filePath} had no content at version ${version}.`));
        }
        await ctx.workspace.writeText(id, filePath, content, { force: true });
        return text(`Restored ${filePath} to its v${version} contents (${content.length} chars).`);
      }),
  );
};
