import type { OverleafClient } from "./client.js";
import { basename } from "./tree.js";
import type { CompileSnapshot } from "./types.js";

const COMPILE_TTL_MS = Number(process.env.OVERLEAF_COMPILE_TTL_MS ?? 120_000);

const ARTIFACT_NAMES = new Set([
  "output.log",
  "output.blg",
  "output.blg2",
  "output.aux",
  "output.bbl",
  "output.chktex",
  "output.fls",
  "output.fdb_latexmk",
  "output.stdout",
  "output.stderr",
  "output.pdf",
  "output.synctex.gz",
]);

export function isCompileArtifact(filePath: string): boolean {
  const name = basename(filePath);
  return ARTIFACT_NAMES.has(name) || /^output\.[A-Za-z][\w.]*$/.test(name);
}

export class Artifacts {
  private snapshots = new Map<string, CompileSnapshot>();

  constructor(private readonly client: OverleafClient) {}

  invalidate(projectId: string): void {
    this.snapshots.delete(projectId);
  }

  async compile(
    projectId: string,
    options: { draft?: boolean; stopOnFirstError?: boolean; refresh?: boolean } = {},
  ): Promise<CompileSnapshot> {
    const cached = this.snapshots.get(projectId);
    const reusable =
      cached &&
      !options.refresh &&
      !options.draft &&
      !options.stopOnFirstError &&
      Date.now() - cached.compiledAt < COMPILE_TTL_MS;
    if (reusable) return { ...cached, fromCache: true };

    const result = await this.client.compile(projectId, {
      draft: options.draft,
      stopOnFirstError: options.stopOnFirstError,
    });
    const snapshot: CompileSnapshot = { result, compiledAt: Date.now(), fromCache: false };
    this.snapshots.set(projectId, snapshot);
    return snapshot;
  }

  async fetch(projectId: string, filePath: string, refresh = false): Promise<Buffer> {
    const name = basename(filePath);
    let snapshot = await this.compile(projectId, { refresh });
    let file = snapshot.result.outputFiles.find((f) => basename(f.path) === name);

    if (!file && snapshot.fromCache) {
      snapshot = await this.compile(projectId, { refresh: true });
      file = snapshot.result.outputFiles.find((f) => basename(f.path) === name);
    }

    if (!file) {
      const produced = snapshot.result.outputFiles.map((f) => basename(f.path)).join(", ");
      throw new Error(
        `The last compile (status ${snapshot.result.status}) produced no "${name}". Available: ${produced || "(none)"}`,
      );
    }
    return await this.client.fetchOutput(file.url, snapshot.result.clsiServerId);
  }

  async log(projectId: string, refresh = false): Promise<{ text: string; snapshot: CompileSnapshot }> {
    const snapshot = await this.compile(projectId, { refresh });
    const file = snapshot.result.outputFiles.find((f) => basename(f.path) === "output.log");
    if (!file) return { text: "", snapshot };
    const bytes = await this.client.fetchOutput(file.url, snapshot.result.clsiServerId);
    return { text: bytes.toString("utf8"), snapshot };
  }
}

export function describeAge(snapshot: CompileSnapshot): string {
  const seconds = Math.round((Date.now() - snapshot.compiledAt) / 1000);
  if (!snapshot.fromCache) return "compiled just now";
  return `reused a compile from ${seconds}s ago, pass refresh to recompile`;
}
