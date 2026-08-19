import fsp from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BASE_URL } from "./config.js";
import { AuthError, SessionStore } from "./auth/session.js";
import { OverleafClient, type ProjectSummary } from "./overleaf/client.js";
import { Workspace, isImage, mimeFor } from "./overleaf/workspace.js";
import { renderTree } from "./overleaf/tree.js";
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
    description: "Read a LaTeX or other text file from the project.",
    inputSchema: { filePath: z.string(), projectId: z.string().optional() },
  },
  async ({ filePath, projectId }) => {
    try {
      const id = await activeProject(projectId);
      return text(await workspace.readText(id, filePath));
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
      projectId: z.string().optional(),
    },
  },
  async ({ filePath, content, projectId }) => {
    try {
      const id = await activeProject(projectId);
      const type = await workspace.writeText(id, filePath, content);
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
      if (!logFile) return text(`status: ${result.status}\nNo output.log was produced.`);
      const log = (await client.fetchOutput(logFile.url, result.clsiServerId)).toString("utf8");
      return text(`status: ${result.status}\n\n${summarizeLog(parseLatexLog(log))}`);
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
