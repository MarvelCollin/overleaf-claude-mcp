import { z } from "zod";
import { parseCookieInput, saveAndVerify } from "../auth/paste.js";
import { BASE_URL, SESSION_COOKIE_NAMES } from "../config.js";
import type { ProjectSummary } from "../overleaf/types.js";
import { renderTree } from "../overleaf/tree.js";
import { guard, text } from "./registry.js";
import type { ToolModule } from "./types.js";

function describeProject(project: ProjectSummary): string {
  const flags = [project.archived ? "archived" : null, project.trashed ? "trashed" : null]
    .filter(Boolean)
    .join(", ");
  return `${project.id}  ${project.name}${flags ? `  (${flags})` : ""}${
    project.lastUpdated ? `  updated ${project.lastUpdated.slice(0, 10)}` : ""
  }`;
}

export const registerProjectTools: ToolModule = (server, ctx) => {
  server.registerTool(
    "overleaf_list_projects",
    {
      title: "List Overleaf projects",
      description: "List projects on the signed-in Overleaf account.",
      inputSchema: { includeArchived: z.boolean().optional() },
    },
    async ({ includeArchived }) =>
      guard(async () => {
        await ctx.ensureSession();
        const projects = await ctx.client.listProjects();
        const visible = includeArchived
          ? projects
          : projects.filter((p) => !p.archived && !p.trashed);
        if (visible.length === 0) return text("No projects found.");

        await ctx.state.load();
        const current = ctx.state.current;
        const lines = visible.map(
          (p) => `${p.id === current?.id ? "* " : "  "}${describeProject(p)}`,
        );
        return text(
          `${visible.length} project(s) on ${BASE_URL}\n\n${lines.join("\n")}\n\n"*" marks the selected project.`,
        );
      }),
  );

  server.registerTool(
    "overleaf_select_project",
    {
      title: "Select active project",
      description:
        "Choose the project every other tool works on. Accepts a project id or part of a project name.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) =>
      guard(async () => {
        await ctx.ensureSession();
        const projects = await ctx.client.listProjects();
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
        await ctx.state.set(chosen);
        const tree = await ctx.workspace.tree(chosen.id, true);
        return text(
          `Selected "${chosen.name}" (${chosen.id})\ncompiler: ${tree.compiler ?? "unknown"}\nfiles: ${
            tree.entries.filter((e) => e.type !== "folder").length
          }\n\n${renderTree(tree)}`,
        );
      }),
  );

  server.registerTool(
    "overleaf_current_project",
    {
      title: "Show active project",
      description: "Report which Overleaf project is currently selected.",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        await ctx.state.load();
        const current = ctx.state.current;
        if (!current) return text("No project selected. Use overleaf_select_project.");
        return text(`${current.name} (${current.id}), selected ${current.selectedAt}`);
      }),
  );

  server.registerTool(
    "overleaf_status",
    {
      title: "Connection status",
      description:
        "Report whether the Overleaf session is alive, when it expires, and which project is selected.",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const found = await ctx.session.load();
        if (!found || !ctx.session.hasSessionCookie()) {
          return text(
            `No session at ${ctx.session.filePath}.\nCall overleaf_set_session with a fresh ${SESSION_COOKIE_NAMES[0]} cookie, or run "npm run setup" in the overleaf-claude-mcp folder.`,
          );
        }
        ctx.markSessionLoaded();

        const lines: string[] = [`session file: ${ctx.session.filePath}`];
        const expiry = ctx.session.sessionExpiry();
        if (expiry) {
          const days = (expiry.getTime() - Date.now()) / 86_400_000;
          lines.push(`expires: ${expiry.toISOString()} (${days.toFixed(1)} days)`);
        }

        try {
          const projects = await ctx.client.listProjects();
          lines.push(`connection: OK, ${projects.length} project(s) visible on ${BASE_URL}`);
        } catch (err) {
          lines.push(`connection: FAILED. ${err instanceof Error ? err.message : String(err)}`);
        }

        await ctx.state.load();
        lines.push(
          ctx.state.current
            ? `selected project: ${ctx.state.current.name} (${ctx.state.current.id})`
            : "selected project: none",
        );
        return text(lines.join("\n"));
      }),
  );

  server.registerTool(
    "overleaf_set_session",
    {
      title: "Set or refresh the session",
      description:
        `Replace the stored Overleaf session with a fresh browser cookie, without restarting the server or editing any file. ` +
        `Accepts the bare ${SESSION_COOKIE_NAMES[0]} value, a "name=value" pair, or a whole Cookie header. ` +
        `Get it from a signed-in browser at ${BASE_URL}/project: F12, Application, Cookies, ${SESSION_COOKIE_NAMES[0]}, copy the Value. ` +
        `The cookie is verified against Overleaf before it is saved and is never echoed back.`,
      inputSchema: { cookie: z.string() },
    },
    async ({ cookie }) =>
      guard(async () => {
        await saveAndVerify(parseCookieInput(cookie));
        await ctx.session.load();
        ctx.markSessionLoaded();

        const lines = [`Session verified against ${BASE_URL} and saved to ${ctx.session.filePath}.`];
        const expiry = ctx.session.sessionExpiry();
        if (expiry) {
          const days = (expiry.getTime() - Date.now()) / 86_400_000;
          lines.push(`expires: ${expiry.toISOString()} (${days.toFixed(1)} days)`);
        }
        const projects = await ctx.client.listProjects();
        lines.push(`${projects.length} project(s) visible.`);
        return text(lines.join("\n"));
      }),
  );

  server.registerTool(
    "overleaf_project_url",
    {
      title: "Project URL",
      description: "Return the browser URL for the selected project, optionally for one file.",
      inputSchema: { projectId: z.string().optional() },
    },
    async ({ projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        return text(`${BASE_URL}/project/${id}`);
      }),
  );
};
