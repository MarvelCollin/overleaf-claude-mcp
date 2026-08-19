import fsp from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { CACHE_DIR, CACHE_TTL_MS } from "../config.js";
import type { OverleafClient } from "./client.js";

export interface ProjectEntry {
  path: string;
  size: number;
  binary: boolean;
}

const BINARY_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp",
  ".eps", ".ps", ".zip", ".gz", ".tar", ".ttf", ".otf", ".woff", ".woff2",
  ".mp4", ".mp3", ".ico", ".xlsx", ".docx", ".pptx",
]);

function isBinaryPath(entryPath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(entryPath).toLowerCase());
}

function zipPath(projectId: string): string {
  return path.join(CACHE_DIR, `${projectId}.zip`);
}

async function mtimeMs(file: string): Promise<number | null> {
  try {
    const stat = await fsp.stat(file);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

export class ProjectCache {
  private zips = new Map<string, { zip: AdmZip; loadedAt: number }>();

  constructor(private readonly client: OverleafClient) {}

  async refresh(projectId: string): Promise<void> {
    const buffer = await this.client.downloadProjectZip(projectId);
    await fsp.mkdir(CACHE_DIR, { recursive: true, mode: 0o700 });
    await fsp.writeFile(zipPath(projectId), buffer, { mode: 0o600 });
    this.zips.set(projectId, { zip: new AdmZip(buffer), loadedAt: Date.now() });
  }

  private async zip(projectId: string, force = false): Promise<AdmZip> {
    const cached = this.zips.get(projectId);
    if (!force && cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.zip;

    if (!force) {
      const file = zipPath(projectId);
      const stamp = await mtimeMs(file);
      if (stamp !== null && Date.now() - stamp < CACHE_TTL_MS) {
        const buffer = await fsp.readFile(file);
        const zip = new AdmZip(buffer);
        this.zips.set(projectId, { zip, loadedAt: stamp });
        return zip;
      }
    }

    await this.refresh(projectId);
    return this.zips.get(projectId)!.zip;
  }

  async list(projectId: string, force = false): Promise<ProjectEntry[]> {
    const zip = await this.zip(projectId, force);
    return zip
      .getEntries()
      .filter((entry) => !entry.isDirectory)
      .map((entry) => ({
        path: entry.entryName,
        size: entry.header.size,
        binary: isBinaryPath(entry.entryName),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async readText(projectId: string, filePath: string, force = false): Promise<string> {
    const zip = await this.zip(projectId, force);
    const normalized = filePath.replace(/^\.?\//, "");
    const entry = zip.getEntry(normalized);
    if (!entry) {
      const available = zip.getEntries().filter((e) => !e.isDirectory).map((e) => e.entryName);
      throw new Error(
        `File "${filePath}" not found in project ${projectId}. Available: ${available.slice(0, 40).join(", ")}`,
      );
    }
    if (isBinaryPath(normalized)) {
      throw new Error(`File "${filePath}" looks binary. Use overleaf_download_file instead.`);
    }
    return entry.getData().toString("utf8");
  }

  async readBinary(projectId: string, filePath: string, force = false): Promise<Buffer> {
    const zip = await this.zip(projectId, force);
    const normalized = filePath.replace(/^\.?\//, "");
    const entry = zip.getEntry(normalized);
    if (!entry) throw new Error(`File "${filePath}" not found in project ${projectId}.`);
    return entry.getData();
  }

  async grep(
    projectId: string,
    pattern: string,
    options: { flags?: string; maxMatches?: number; force?: boolean } = {},
  ): Promise<{ path: string; line: number; text: string }[]> {
    const regex = new RegExp(pattern, options.flags ?? "i");
    const max = options.maxMatches ?? 200;
    const entries = await this.list(projectId, options.force);
    const hits: { path: string; line: number; text: string }[] = [];

    for (const entry of entries) {
      if (entry.binary) continue;
      const content = await this.readText(projectId, entry.path);
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        if (regex.test(line)) {
          hits.push({ path: entry.path, line: i + 1, text: line.trim().slice(0, 400) });
          if (hits.length >= max) return hits;
        }
      }
    }
    return hits;
  }
}
