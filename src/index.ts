#!/usr/bin/env node
import fsp from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BASE_URL, MAX_READ_CHARS } from "./config.js";
import { AuthError, SessionStore } from "./auth/session.js";
import { OverleafClient, type ProjectSummary } from "./overleaf/client.js";
import { Workspace, isImage, mimeFor } from "./overleaf/workspace.js";
import { normalizePath, renderTree } from "./overleaf/tree.js";
import { ProjectState } from "./state.js";
import { parseLatexLog, summarizeLog } from "./latex-log.js";

const session = new SessionStore();
const client = new OverleafClient(session);
const workspace = new Workspace(client);
const state = new ProjectState();
let sessionLoaded = false;

async function ensureSession(): Promise<void> {
  if (sessionLoaded) return;
  const found = await session.load();
  if (!found || !session.hasSessionCookie()) {
    throw new AuthError(
      `No Overleaf session at ${session.filePath}. Run "npm run login" in the overleaf-claude-mcp folder and sign in.`,
    );
  }
  sessionLoaded = true;
}

async function activeProject(projectId?: string): Promise<string> {
  await ensureSession();
  return await state.resolve(projectId);
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function failure(err: unknown) {
  return {
    content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
    isError: true,
  };
}

function describeProject(project: ProjectSummary): string {
  const flags = [project.archived ? "archived" : null, project.trashed ? "trashed" : null]
    .filter(Boolean)
    .join(", ");
  return `${project.id}  ${project.name}${flags ? `  (${flags})` : ""}${
    project.lastUpdated ? `  updated ${project.lastUpdated.slice(0, 10)}` : ""
  }`;
}

const server = new McpServer({ name: "overleaf-claude-mcp", version: "0.2.0" });

server.registerTool(
  "overleaf_list_projects",
  {
    title: "List Overleaf projects",
    description: "List projects on the signed-in Overleaf account.",
    inputSchema: { includeArchived: z.boolean().optional() },
  },
  async ({ includeArchived }) => {
    try {
      await ensureSession();
      const projects = await client.listProjects();
      const visible = includeArchived ? projects : projects.filter((p) => !p.archived && !p.trashed);
      if (visible.length === 0) return text("No projects found.");
      await state.load();
      const current = state.current;
      const lines = visible.map(
        (p) => `${p.id === current?.id ? "* " : "  "}${describeProject(p)}`,
      );
      return text(
        `${visible.length} project(s) on ${BASE_URL}\n\n${lines.join("\n")}\n\n"*" marks the selected project.`,
      );
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "overleaf_select_project",
  {
    title: "Select active project",
    description:
      "Choose the project every other tool works on. Accepts a project id or part of a project name.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    try {
      await ensureSession();
      const projects = await client.listProjects();
      const byId = projects.find((p) => p.id === query);
      const matches = byId
        ? [byId]
        : projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

      if (matches.length === 0) return text(`No project matched "${query}".`);
      if (matches.length > 1) {
        return text(
          `"${query}" matched ${matches.length} projects. Select one by id:\n\n${matches
            .map(describeProject)
            .join("\n")}`,
        );
      }

      const chosen = matches[0]!;
      await state.set(chosen);
      const tree = await workspace.tree(chosen.id, true);
      return text(
        `Selected "${chosen.name}" (${chosen.id})\ncompiler: ${tree.compiler ?? "unknown"}\nfiles: ${
          tree.entries.filter((e) => e.type !== "folder").length
        }\n\n${renderTree(tree)}`,
      );
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "overleaf_current_project",
  {
    title: "Show active project",
    description: "Report which Overleaf project is currently selected.",
    inputSchema: {},
  },
  async () => {
    try {
      await state.load();
      const current = state.current;
      if (!current) return text("No project selected. Use overleaf_select_project.");
      return text(`${current.name} (${current.id}), selected ${current.selectedAt}`);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "overleaf_status",
  {
    title: "Connection status",
    description:
      "Report whether the Overleaf session is alive, when it expires, and which project is selected.",
    inputSchema: {},
  },
  async () => {
    try {
      const found = await session.load();
      if (!found || !session.hasSessionCookie()) {
        return text(
          `No session at ${session.filePath}.\nRun "npm run setup" in the overleaf-claude-mcp folder.`,
        );
      }
      sessionLoaded = true;

      const lines: string[] = [`session file: ${session.filePath}`];
      const expiry = session.sessionExpiry();
      if (expiry) {
        const days = (expiry.getTime() - Date.now()) / 86_400_000;
        lines.push(`expires: ${expiry.toISOString()} (${days.toFixed(1)} days)`);
      }

      try {
        const projects = await client.listProjects();
        lines.push(`connection: OK, ${projects.length} project(s) visible on ${BASE_URL}`);
      } catch (err) {
        lines.push(`connection: FAILED. ${err instanceof Error ? err.message : String(err)}`);
      }

      await state.load();
      lines.push(
        state.current
          ? `selected project: ${state.current.name} (${state.current.id})`
          : "selected project: none",
      );
      return text(lines.join("\n"));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "overleaf_project_url",
  {
    title: "Project URL",
    description: "Return the browser URL for the selected project, optionally for one file.",
    inputSchema: { projectId: z.string().optional() },
  },
  async ({ projectId }) => {
    try {
      const id = await activeProject(projectId);
      return text(`${BASE_URL}/project/${id}`);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "overleaf_list_files",
  {
    title: "List project files",
    description: "List every file and folder in the project.",
    inputSchema: { projectId: z.string().optional(), refresh: z.boolean().optional() },
  },
  async ({ projectId, refresh }) => {
    try {
      const id = await activeProject(projectId);
      const tree = await workspace.tree(id, refresh ?? false);
      return text(`${tree.name} (${id})\nroot doc: ${tree.rootDocId ?? "unset"}\n\n${renderTree(tree)}`);
    } catch (err) {
      return failure(err);
    }
  },
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
  async ({ filePath, startLine, endLine, projectId }) => {
    try {
      const id = await activeProject(projectId);
      const content = await workspace.readText(id, filePath);
      const allLines = content.split("\n");

      if (startLine || endLine) {
        const from = Math.max(1, startLine ?? 1);
        const to = Math.min(allLines.length, endLine ?? allLines.length);
        if (from > allLines.length) {
          return failure(
            new Error(`${filePath} has ${allLines.length} lines, so line ${from} does not exist.`),
          );
        }
        const slice = allLines.slice(from - 1, to).join("\n");
        return text(
          `${filePath} lines ${from}-${to} of ${allLines.length}\n\n${slice.slice(0, MAX_READ_CHARS)}`,
        );
      }

      if (content.length <= MAX_READ_CHARS) return text(content);

      let cutoff = 0;
      let shown = 0;
      while (cutoff < allLines.length && shown + (allLines[cutoff]?.length ?? 0) + 1 <= MAX_READ_CHARS) {
        shown += (allLines[cutoff]?.length ?? 0) + 1;
        cutoff += 1;
      }
      return text(
        `${filePath} is ${content.length} chars over ${allLines.length} lines. Showing lines 1-${cutoff}.\n` +
          `Read the rest with startLine ${cutoff + 1}, or search it with overleaf_grep.\n\n` +
          allLines.slice(0, cutoff).join("\n"),
      );
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "overleaf_read_image",
  {
    title: "View an image",
    description: "Fetch an image from the project so it can be viewed directly.",
    inputSchema: { filePath: z.string(), projectId: z.string().optional() },
  },
  async ({ filePath, projectId }) => {
    try {
      const id = await activeProject(projectId);
      if (!isImage(filePath)) {
        return failure(new Error(`"${filePath}" is not an image. Use overleaf_download_file.`));
      }
      const bytes = await workspace.readBinary(id, filePath);
      return {
        content: [
          { type: "image" as const, data: bytes.toString("base64"), mimeType: mimeFor(filePath) },
        ],
      };
    } catch (err) {
      return failure(err);
    }
  },
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
  async ({ filePath, destPath, projectId }) => {
    try {
      const id = await activeProject(projectId);
      const bytes = await workspace.readBinary(id, filePath);
      const target = path.resolve(destPath);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, bytes);
      return text(`Saved ${bytes.length} bytes to ${target}`);
    } catch (err) {
      return failure(err);
    }
  },
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
  async ({ pattern, flags, maxMatches, projectId }) => {
    try {
      const id = await activeProject(projectId);
      const hits = await workspace.grep(id, pattern, { flags, maxMatches });
      if (hits.length === 0) return text(`No matches for /${pattern}/`);
      return text(hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n"));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "overleaf_write_file",
  {
    title: "Write a text file",
    description:
      "Create or overwrite a text file in the project. Missing parent folders are created.",
    inputSchema: {
      filePath: z.string(),
      content: z.string(),
      force: z.boolean().optional(),
      projectId: z.string().optional(),
    },
  },
  async ({ filePath, content, force, projectId }) => {
    try {
      const id = await activeProject(projectId);
      const type = await workspace.writeText(id, filePath, content, { force });
      return text(`Wrote ${content.length} chars to ${filePath} (stored as ${type}).`);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "overleaf_edit_file",
  {
    title: "Edit a text file",
    description: "Replace an exact string inside a project file.",
    inputSchema: {
      filePath: z.string(),
      oldString: z.string(),
      newString: z.string(),
      replaceAll: z.boolean().optional(),
      projectId: z.string().optional(),
    },
  },
  async ({ filePath, oldString, newString, replaceAll, projectId }) => {
    try {
      const id = await activeProject(projectId);
      const original = await workspace.readText(id, filePath);
      const occurrences = original.split(oldString).length - 1;

      if (occurrences === 0) return failure(new Error(`No match for that string in ${filePath}.`));
      if (occurrences > 1 && !replaceAll) {
        return failure(
          new Error(
            `Found ${occurrences} matches in ${filePath}. Pass replaceAll or use a longer, unique string.`,
          ),
        );
      }

      const updated = replaceAll
        ? original.split(oldString).join(newString)
        : original.replace(oldString, newString);
      await workspace.writeText(id, filePath, updated);
      return text(`Replaced ${replaceAll ? occurrences : 1} occurrence(s) in ${filePath}.`);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "overleaf_upload_file",
  {
    title: "Upload a local file",
    description: "Upload a local file, such as a figure, into the project.",
    inputSchema: {
      localPath: z.string(),
      filePath: z.string(),
      projectId: z.string().optional(),
    },
  },
  async ({ localPath, filePath, projectId }) => {
    try {
      const id = await activeProject(projectId);
      const bytes = await fsp.readFile(path.resolve(localPath));
      const type = await workspace.writeBinary(id, filePath, bytes);
      return text(`Uploaded ${bytes.length} bytes to ${filePath} (stored as ${type}).`);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "overleaf_create_folder",
  {
    title: "Create a folder",
    description: "Create a folder, including any missing parents.",
    inputSchema: { folderPath: z.string(), projectId: z.string().optional() },
  },
  async ({ folderPath, projectId }) => {
    try {
      const id = await activeProject(projectId);
      await workspace.ensureFolder(id, folderPath);
      return text(`Folder ready: ${folderPath}`);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "overleaf_rename",
  {
    title: "Rename an entry",
    description: "Rename a file or folder in place.",
    inputSchema: {
      filePath: z.string(),
      newName: z.string(),
      projectId: z.string().optional(),
    },
  },
  async ({ filePath, newName, projectId }) => {
    try {
      const id = await activeProject(projectId);
      await workspace.rename(id, filePath, newName);
      return text(`Renamed ${filePath} to ${newName}.`);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "overleaf_move",
  {
    title: "Move an entry",
    description: "Move a file or folder into another folder.",
    inputSchema: {
      filePath: z.string(),
      destFolder: z.string(),
      projectId: z.string().optional(),
    },
  },
  async ({ filePath, destFolder, projectId }) => {
    try {
      const id = await activeProject(projectId);
      await workspace.move(id, filePath, destFolder);
      return text(`Moved ${filePath} into ${destFolder || "the project root"}.`);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "overleaf_delete",
  {
    title: "Delete an entry",
    description:
      "Delete a file or folder from the project. Requires confirm to be true.",
    inputSchema: {
      filePath: z.string(),
      confirm: z.boolean(),
      projectId: z.string().optional(),
    },
  },
  async ({ filePath, confirm, projectId }) => {
    try {
      if (!confirm) {
        return failure(new Error(`Refusing to delete ${filePath} without confirm set to true.`));
      }
      const id = await activeProject(projectId);
      const type = await workspace.remove(id, filePath);
      return text(`Deleted ${type} ${filePath}.`);
    } catch (err) {
      return failure(err);
    }
  },
);

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
  async ({ count, filePath, projectId }) => {
    try {
      const id = await activeProject(projectId);
      const { updates } = await client.updates(id, count ?? 10);
      const wanted = filePath ? normalizePath(filePath) : null;
      const relevant = wanted
        ? updates.filter((u) => u.pathnames.some((p) => normalizePath(p) === wanted))
        : updates;

      if (relevant.length === 0) {
        return text(wanted ? `No recorded changes to ${filePath}.` : "No history recorded.");
      }

      const lines = relevant.map((u) => {
        const who =
          u.meta?.users
            ?.map((x) => [x.first_name, x.last_name].filter(Boolean).join(" ") || x.email)
            .filter(Boolean)
            .join(", ") || "unknown";
        const when = u.meta?.end_ts ? new Date(u.meta.end_ts).toISOString() : "unknown time";
        return `v${u.fromV}-${u.toV}  ${when}  ${who}\n    ${u.pathnames.join(", ")}`;
      });
      return text(
        `${relevant.length} update(s)${wanted ? ` touching ${filePath}` : ""}\n\n${lines.join("\n")}`,
      );
    } catch (err) {
      return failure(err);
    }
  },
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
  async ({ filePath, version, projectId }) => {
    try {
      const id = await activeProject(projectId);
      const content = await workspace.contentAtVersion(id, filePath, version);
      if (!content) return text(`${filePath} was empty or absent at version ${version}.`);
      return text(
        content.length > MAX_READ_CHARS
          ? `${filePath} at v${version} is ${content.length} chars, truncated.\n\n${content.slice(0, MAX_READ_CHARS)}`
          : `${filePath} at v${version}\n\n${content}`,
      );
    } catch (err) {
      return failure(err);
    }
  },
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
  async ({ filePath, from, to, projectId }) => {
    try {
      const id = await activeProject(projectId);
      const segments = await client.diff(id, normalizePath(filePath), from, to);
      const changes = segments.filter((s) => s.i !== undefined || s.d !== undefined);
      if (changes.length === 0) return text(`${filePath} is unchanged between v${from} and v${to}.`);

      const rendered = changes
        .map((s) => {
          const marker = s.i !== undefined ? "+" : "-";
          const body = (s.i ?? s.d ?? "").replace(/\n/g, `\n${marker} `);
          return `${marker} ${body}`;
        })
        .join("\n");
      return text(
        `${filePath} v${from} to v${to}, ${changes.length} change(s)\n\n${rendered.slice(0, MAX_READ_CHARS)}`,
      );
    } catch (err) {
      return failure(err);
    }
  },
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
  async ({ filePath, version, confirm, projectId }) => {
    try {
      if (!confirm) {
        return failure(
          new Error(`Refusing to restore ${filePath} to v${version} without confirm set to true.`),
        );
      }
      const id = await activeProject(projectId);
      const content = await workspace.contentAtVersion(id, filePath, version);
      if (!content) {
        return failure(new Error(`${filePath} had no content at version ${version}.`));
      }
      await workspace.writeText(id, filePath, content, { force: true });
      return text(`Restored ${filePath} to its v${version} contents (${content.length} chars).`);
    } catch (err) {
      return failure(err);
    }
  },
);

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
  async ({ projectId, draft, stopOnFirstError }) => {
    try {
      const id = await activeProject(projectId);
      const result = await client.compile(id, { draft, stopOnFirstError });
      const files = result.outputFiles.map((f) => `- ${f.path}`).join("\n");
      return text(`status: ${result.status}\n\noutput files:\n${files || "(none)"}`);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "overleaf_compile_log",
  {
    title: "Compile and read the log",
    description: "Compile the project and return parsed LaTeX errors and warnings.",
    inputSchema: { projectId: z.string().optional() },
  },
  async ({ projectId }) => {
    try {
      const id = await activeProject(projectId);
      const result = await client.compile(id);
      const logFile = result.outputFiles.find((f) => f.path.endsWith("output.log"));
      if (!logFile) {
        return text(
          `status: ${result.status}\nNo output.log was produced. Output files: ${
            result.outputFiles.map((f) => f.path).join(", ") || "(none)"
          }`,
        );
      }
      const log = (await client.fetchOutput(logFile.url, result.clsiServerId)).toString("utf8");
      const entries = parseLatexLog(log);
      const summary = summarizeLog(entries);
      if (entries.some((e) => e.level === "error") || result.status === "success") {
        return text(`status: ${result.status}\n\n${summary}`);
      }
      const tail = log.split(/\r?\n/).slice(-60).join("\n");
      return text(`status: ${result.status}\n\n${summary}\n\nLast 60 log lines:\n${tail}`);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "overleaf_download_pdf",
  {
    title: "Download the compiled PDF",
    description: "Compile the project and save the resulting PDF locally.",
    inputSchema: { destPath: z.string(), projectId: z.string().optional() },
  },
  async ({ destPath, projectId }) => {
    try {
      const id = await activeProject(projectId);
      const result = await client.compile(id);
      const pdf = result.outputFiles.find((f) => f.path.endsWith(".pdf"));
      if (!pdf) return text(`status: ${result.status}\nNo PDF was produced.`);
      const bytes = await client.fetchOutput(pdf.url, result.clsiServerId);
      const target = path.resolve(destPath);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, bytes);
      return text(`Saved ${bytes.length} bytes to ${target}`);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "overleaf_word_count",
  {
    title: "Word count",
    description: "Return the compiled word count for the project.",
    inputSchema: { projectId: z.string().optional() },
  },
  async ({ projectId }) => {
    try {
      const id = await activeProject(projectId);
      return text(JSON.stringify(await client.wordCount(id), null, 2));
    } catch (err) {
      return failure(err);
    }
  },
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
