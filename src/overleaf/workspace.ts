import path from "node:path";
import AdmZip from "adm-zip";
import type { OverleafClient } from "./client.js";
import { joinProject } from "./socket.js";
import {
  basename,
  buildTree,
  dirname,
  findEntry,
  findFolderId,
  normalizePath,
  type EntityType,
  type ProjectTree,
  type TreeEntry,
} from "./tree.js";

const TREE_TTL_MS = Number(process.env.OVERLEAF_TREE_TTL_MS ?? 15_000);
const DOC_GREP_LIMIT = Number(process.env.OVERLEAF_DOC_GREP_LIMIT ?? 40);

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".eps": "application/postscript",
  ".tex": "text/x-tex",
  ".bib": "text/x-bibtex",
  ".cls": "text/x-tex",
  ".sty": "text/x-tex",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".md": "text/markdown",
};

export function mimeFor(filePath: string): string {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function isImage(filePath: string): boolean {
  return mimeFor(filePath).startsWith("image/");
}

export interface GrepHit {
  path: string;
  line: number;
  text: string;
}

export class Workspace {
  private trees = new Map<string, { tree: ProjectTree; at: number }>();
  private zips = new Map<string, { zip: AdmZip; at: number }>();

  constructor(private readonly client: OverleafClient) {}

  invalidate(projectId: string): void {
    this.trees.delete(projectId);
    this.zips.delete(projectId);
  }

  async tree(projectId: string, force = false): Promise<ProjectTree> {
    const cached = this.trees.get(projectId);
    if (!force && cached && Date.now() - cached.at < TREE_TTL_MS) return cached.tree;
    const joined = await joinProject(this.client, projectId);
    const tree = buildTree(joined.project);
    this.trees.set(projectId, { tree, at: Date.now() });
    return tree;
  }

  async entry(projectId: string, filePath: string): Promise<TreeEntry> {
    let tree = await this.tree(projectId);
    let found = findEntry(tree, filePath);
    if (!found) {
      tree = await this.tree(projectId, true);
      found = findEntry(tree, filePath);
    }
    if (!found) {
      const wanted = normalizePath(filePath).toLowerCase();
      const wantedName = basename(wanted);
      const near = tree.entries
        .filter((e) => e.type !== "folder")
        .map((e) => {
          const lower = e.path.toLowerCase();
          let score = 0;
          if (basename(lower) === wantedName) score += 3;
          if (lower.includes(wanted) || wanted.includes(lower)) score += 2;
          if (basename(lower).startsWith(wantedName.slice(0, 4))) score += 1;
          return { path: e.path, score };
        })
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((c) => c.path);

      const hint = near.length
        ? `Did you mean: ${near.join(", ")}`
        : `Files: ${tree.entries
            .filter((e) => e.type !== "folder")
            .map((e) => e.path)
            .slice(0, 40)
            .join(", ")}`;
      throw new Error(`"${filePath}" not found in project ${projectId}. ${hint}`);
    }
    return found;
  }

  async readText(projectId: string, filePath: string): Promise<string> {
    const entry = await this.entry(projectId, filePath);
    if (entry.type === "folder") throw new Error(`"${filePath}" is a folder.`);
    if (entry.type === "doc") return await this.client.readDoc(projectId, entry.id);
    if (isImage(entry.path) || mimeFor(entry.path) === "application/pdf") {
      throw new Error(`"${filePath}" is binary. Use overleaf_read_image or overleaf_download_file.`);
    }
    return (await this.readBinary(projectId, filePath)).toString("utf8");
  }

  async readBinary(projectId: string, filePath: string): Promise<Buffer> {
    const entry = await this.entry(projectId, filePath);
    if (entry.type === "doc") {
      return Buffer.from(await this.client.readDoc(projectId, entry.id), "utf8");
    }
    if (entry.type === "folder") throw new Error(`"${filePath}" is a folder.`);
    if (!entry.hash) {
      throw new Error(`"${filePath}" has no content hash, so it cannot be downloaded directly.`);
    }
    return await this.client.readBlob(projectId, entry.hash);
  }

  async ensureFolder(projectId: string, folderPath: string): Promise<string> {
    const target = normalizePath(folderPath);
    let tree = await this.tree(projectId);
    if (target === "") return tree.rootFolderId;

    const existing = findFolderId(tree, target);
    if (existing) return existing;

    const segments = target.split("/");
    let currentPath = "";
    let currentId = tree.rootFolderId;

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const found = findFolderId(tree, currentPath);
      if (found) {
        currentId = found;
        continue;
      }
      const created = await this.client.createEntity(projectId, "folder", segment, currentId);
      if (!created._id) throw new Error(`Overleaf did not return an id for folder "${currentPath}"`);
      currentId = created._id;
      this.invalidate(projectId);
      tree = await this.tree(projectId, true);
    }

    return currentId;
  }

  async writeText(projectId: string, filePath: string, contents: string): Promise<string> {
    const folderId = await this.ensureFolder(projectId, dirname(filePath));
    const name = basename(filePath);
    const result = await this.client.uploadFile(
      projectId,
      folderId,
      name,
      Buffer.from(contents, "utf8"),
      mimeFor(name),
    );
    this.invalidate(projectId);
    if (!result.success) throw new Error(`Upload of "${filePath}" was rejected by Overleaf.`);
    return result.entity_type ?? "doc";
  }

  async writeBinary(
    projectId: string,
    filePath: string,
    contents: Buffer,
  ): Promise<string> {
    const folderId = await this.ensureFolder(projectId, dirname(filePath));
    const name = basename(filePath);
    const result = await this.client.uploadFile(projectId, folderId, name, contents, mimeFor(name));
    this.invalidate(projectId);
    if (!result.success) throw new Error(`Upload of "${filePath}" was rejected by Overleaf.`);
    return result.entity_type ?? "file";
  }

  async remove(projectId: string, filePath: string): Promise<EntityType> {
    const entry = await this.entry(projectId, filePath);
    await this.client.deleteEntity(projectId, entry.type, entry.id);
    this.invalidate(projectId);
    return entry.type;
  }

  async rename(projectId: string, filePath: string, newName: string): Promise<void> {
    const entry = await this.entry(projectId, filePath);
    await this.client.renameEntity(projectId, entry.type, entry.id, newName);
    this.invalidate(projectId);
  }

  async move(projectId: string, filePath: string, destFolder: string): Promise<void> {
    const entry = await this.entry(projectId, filePath);
    const folderId = await this.ensureFolder(projectId, destFolder);
    await this.client.moveEntity(projectId, entry.type, entry.id, folderId);
    this.invalidate(projectId);
  }

  private async zip(projectId: string, force = false): Promise<AdmZip> {
    const cached = this.zips.get(projectId);
    if (!force && cached && Date.now() - cached.at < TREE_TTL_MS) return cached.zip;
    const buffer = await this.client.downloadProjectZip(projectId);
    const zip = new AdmZip(buffer);
    this.zips.set(projectId, { zip, at: Date.now() });
    return zip;
  }

  private scan(path: string, content: string, regex: RegExp, hits: GrepHit[], max: number): boolean {
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (regex.test(line)) {
        hits.push({ path, line: i + 1, text: line.trim().slice(0, 400) });
        if (hits.length >= max) return true;
      }
    }
    return false;
  }

  async grep(
    projectId: string,
    pattern: string,
    options: { flags?: string; maxMatches?: number } = {},
  ): Promise<GrepHit[]> {
    const regex = new RegExp(pattern, options.flags ?? "i");
    const max = options.maxMatches ?? 200;
    const hits: GrepHit[] = [];

    const tree = await this.tree(projectId);
    const docs = tree.entries.filter((e) => e.type === "doc");

    if (docs.length <= DOC_GREP_LIMIT) {
      const contents = await Promise.all(
        docs.map(async (doc) => ({
          path: doc.path,
          content: await this.client.readDoc(projectId, doc.id),
        })),
      );
      for (const doc of contents) {
        if (this.scan(doc.path, doc.content, regex, hits, max)) break;
      }
      return hits;
    }

    const zip = await this.zip(projectId);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (isImage(entry.entryName) || mimeFor(entry.entryName) === "application/pdf") continue;
      if (this.scan(entry.entryName, entry.getData().toString("utf8"), regex, hits, max)) break;
    }
    return hits;
  }
}
