import type { JoinedProject, ProjectTree, RawFolder, TreeEntry } from "./types.js";

export function normalizePath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/+$/, "");
}

export function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

export function basename(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

export function buildTree(project: JoinedProject): ProjectTree {
  const root = project.rootFolder[0];
  if (!root) throw new Error(`Project ${project._id} returned no root folder`);

  const entries: TreeEntry[] = [];

  const visit = (folder: RawFolder, prefix: string): void => {
    for (const doc of folder.docs ?? []) {
      entries.push({
        path: prefix + doc.name,
        name: doc.name,
        type: "doc",
        id: doc._id,
        parentFolderId: folder._id,
      });
    }
    for (const file of folder.fileRefs ?? []) {
      entries.push({
        path: prefix + file.name,
        name: file.name,
        type: "file",
        id: file._id,
        hash: file.hash,
        parentFolderId: folder._id,
      });
    }
    for (const child of folder.folders ?? []) {
      entries.push({
        path: prefix + child.name,
        name: child.name,
        type: "folder",
        id: child._id,
        parentFolderId: folder._id,
      });
      visit(child, `${prefix}${child.name}/`);
    }
  };

  visit(root, "");
  entries.sort((a, b) => a.path.localeCompare(b.path));

  return {
    projectId: project._id,
    name: project.name,
    rootFolderId: root._id,
    rootDocId: project.rootDoc_id,
    compiler: project.compiler,
    entries,
  };
}

export function findEntry(tree: ProjectTree, path: string): TreeEntry | undefined {
  const target = normalizePath(path);
  return tree.entries.find((entry) => entry.path === target);
}

export function findFolderId(tree: ProjectTree, folderPath: string): string | undefined {
  const target = normalizePath(folderPath);
  if (target === "") return tree.rootFolderId;
  return tree.entries.find((e) => e.path === target && e.type === "folder")?.id;
}

export function renderTree(tree: ProjectTree): string {
  return tree.entries
    .map((entry) => {
      if (entry.type === "folder") return `${entry.path}/`;
      return entry.type === "file" ? `${entry.path}  [binary]` : entry.path;
    })
    .join("\n");
}
