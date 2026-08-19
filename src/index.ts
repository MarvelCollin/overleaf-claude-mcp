import fsp from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BASE_URL } from "./config.js";
import { AuthError, SessionStore } from "./auth/session.js";
import { OverleafClient } from "./overleaf/client.js";
import { ProjectCache } from "./overleaf/cache.js";
import { parseLatexLog, summarizeLog } from "./latex-log.js";

const session = new SessionStore();
const client = new OverleafClient(session);
const cache = new ProjectCache(client);
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

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

async function guard<T>(fn: () => Promise<T>): Promise<T | ReturnType<typeof errorResult>> {
  try {
    return await fn();
  } catch (err) {
    return errorResult(err);
  }
}

const server = new McpServer({ name: "overleaf-claude-mcp", version: "0.1.0" });

server.registerTool(
  "overleaf_list_projects",
  {
    title: "List Overleaf projects",
    description: "List every project visible to the signed-in Overleaf account.",
    inputSchema: {
      includeArchived: z.boolean().optional(),
    },
  },
  async ({ includeArchived }) =>
    guard(async () => {
      await ensureSession();
      const projects = await client.listProjects();
      const visible = includeArchived
        ? projects
        : projects.filter((p) => !p.archived && !p.trashed);
      if (visible.length === 0) return textResult("No projects found.");
      const lines = visible.map(
        (p) => `${p.id}  ${p.name}${p.lastUpdated ? `  (updated ${p.lastUpdated})` : ""}`,
      );
      return textResult(`${visible.length} project(s) on ${BASE_URL}\n\n${lines.join("\n")}`);
    }),
);

server.registerTool(
  "overleaf_list_files",
  {
    title: "List project files",
    description: "List every file in an Overleaf project, from the downloaded project archive.",
    inputSchema: {
      projectId: z.string(),
      refresh: z.boolean().optional(),
    },
  },
  async ({ projectId, refresh }) =>
    guard(async () => {
      await ensureSession();
      const entries = await cache.list(projectId, refresh ?? false);
      const lines = entries.map((e) => `${e.path}  ${e.size}B${e.binary ? "  [binary]" : ""}`);
      return textResult(`${entries.length} file(s)\n\n${lines.join("\n")}`);
    }),
);

server.registerTool(
  "overleaf_read_file",
  {
    title: "Read project file",
    description: "Read one text file from an Overleaf project.",
    inputSchema: {
      projectId: z.string(),
      filePath: z.string(),
      refresh: z.boolean().optional(),
    },
  },
  async ({ projectId, filePath, refresh }) =>
    guard(async () => {
      await ensureSession();
      const content = await cache.readText(projectId, filePath, refresh ?? false);
      return textResult(content);
    }),
);

server.registerTool(
  "overleaf_grep",
  {
    title: "Search project",
    description: "Regex search across every text file in an Overleaf project.",
    inputSchema: {
      projectId: z.string(),
      pattern: z.string(),
      flags: z.string().optional(),
      maxMatches: z.number().int().positive().optional(),
      refresh: z.boolean().optional(),
    },
  },
  async ({ projectId, pattern, flags, maxMatches, refresh }) =>
    guard(async () => {
      await ensureSession();
      const hits = await cache.grep(projectId, pattern, {
        flags,
        maxMatches,
        force: refresh ?? false,
      });
      if (hits.length === 0) return textResult(`No matches for /${pattern}/`);
      return textResult(hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n"));
    }),
);

server.registerTool(
  "overleaf_refresh",
  {
    title: "Refresh project cache",
    description: "Re-download an Overleaf project archive, discarding the local cache.",
    inputSchema: { projectId: z.string() },
  },
  async ({ projectId }) =>
    guard(async () => {
      await ensureSession();
      await cache.refresh(projectId);
      const entries = await cache.list(projectId);
      return textResult(`Refreshed ${projectId}. ${entries.length} file(s) cached.`);
    }),
);

server.registerTool(
  "overleaf_compile",
  {
    title: "Compile project",
    description: "Trigger a server-side LaTeX compile and report the status and output files.",
    inputSchema: {
      projectId: z.string(),
      rootDocId: z.string().optional(),
      draft: z.boolean().optional(),
      stopOnFirstError: z.boolean().optional(),
    },
  },
  async ({ projectId, rootDocId, draft, stopOnFirstError }) =>
    guard(async () => {
      await ensureSession();
      const result = await client.compile(projectId, { rootDocId, draft, stopOnFirstError });
      const files = result.outputFiles.map((f) => `- ${f.path}`).join("\n");
      return textResult(`status: ${result.status}\n\noutput files:\n${files || "(none)"}`);
    }),
);

server.registerTool(
  "overleaf_compile_log",
  {
    title: "Compile and read log",
    description: "Compile an Overleaf project and return the parsed LaTeX errors and warnings.",
    inputSchema: {
      projectId: z.string(),
      rootDocId: z.string().optional(),
    },
  },
  async ({ projectId, rootDocId }) =>
    guard(async () => {
      await ensureSession();
      const result = await client.compile(projectId, { rootDocId });
      const logFile = result.outputFiles.find((f) => f.path.endsWith("output.log"));
      if (!logFile) {
        return textResult(`status: ${result.status}\nNo output.log was produced.`);
      }
      const log = (await client.fetchOutput(logFile.url, result.clsiServerId)).toString("utf8");
      const entries = parseLatexLog(log);
      return textResult(`status: ${result.status}\n\n${summarizeLog(entries)}`);
    }),
);

server.registerTool(
  "overleaf_download_pdf",
  {
    title: "Download compiled PDF",
    description: "Compile an Overleaf project and save the resulting PDF to a local path.",
    inputSchema: {
      projectId: z.string(),
      destPath: z.string(),
    },
  },
  async ({ projectId, destPath }) =>
    guard(async () => {
      await ensureSession();
      const result = await client.compile(projectId);
      const pdf = result.outputFiles.find((f) => f.path.endsWith(".pdf"));
      if (!pdf) return textResult(`status: ${result.status}\nNo PDF was produced.`);
      const bytes = await client.fetchOutput(pdf.url, result.clsiServerId);
      const target = path.resolve(destPath);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, bytes);
      return textResult(`Saved ${bytes.length} bytes to ${target}`);
    }),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
