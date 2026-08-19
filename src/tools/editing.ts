import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { failure, guard, text, type ToolModule } from "./registry.js";

export const registerEditingTools: ToolModule = (server, ctx) => {
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
    async ({ filePath, content, force, projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const type = await ctx.workspace.writeText(id, filePath, content, { force });
        return text(`Wrote ${content.length} chars to ${filePath} (stored as ${type}).`);
      }),
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
    async ({ filePath, oldString, newString, replaceAll, projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const original = await ctx.workspace.readText(id, filePath);
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
        await ctx.workspace.writeText(id, filePath, updated);
        return text(`Replaced ${replaceAll ? occurrences : 1} occurrence(s) in ${filePath}.`);
      }),
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
    async ({ localPath, filePath, projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        const bytes = await fsp.readFile(path.resolve(localPath));
        const type = await ctx.workspace.writeBinary(id, filePath, bytes);
        return text(`Uploaded ${bytes.length} bytes to ${filePath} (stored as ${type}).`);
      }),
  );

  server.registerTool(
    "overleaf_create_folder",
    {
      title: "Create a folder",
      description: "Create a folder, including any missing parents.",
      inputSchema: { folderPath: z.string(), projectId: z.string().optional() },
    },
    async ({ folderPath, projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        await ctx.workspace.ensureFolder(id, folderPath);
        return text(`Folder ready: ${folderPath}`);
      }),
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
    async ({ filePath, newName, projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        await ctx.workspace.rename(id, filePath, newName);
        return text(`Renamed ${filePath} to ${newName}.`);
      }),
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
    async ({ filePath, destFolder, projectId }) =>
      guard(async () => {
        const id = await ctx.activeProject(projectId);
        await ctx.workspace.move(id, filePath, destFolder);
        return text(`Moved ${filePath} into ${destFolder || "the project root"}.`);
      }),
  );

  server.registerTool(
    "overleaf_delete",
    {
      title: "Delete an entry",
      description: "Delete a file or folder from the project. Requires confirm to be true.",
      inputSchema: {
        filePath: z.string(),
        confirm: z.boolean(),
        projectId: z.string().optional(),
      },
    },
    async ({ filePath, confirm, projectId }) =>
      guard(async () => {
        if (!confirm) {
          return failure(new Error(`Refusing to delete ${filePath} without confirm set to true.`));
        }
        const id = await ctx.activeProject(projectId);
        const type = await ctx.workspace.remove(id, filePath);
        return text(`Deleted ${type} ${filePath}.`);
      }),
  );
};
