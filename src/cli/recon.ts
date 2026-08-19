import fsp from "node:fs/promises";
import path from "node:path";
import { BASE_URL } from "../config.js";
import { loadSessionOrThrow } from "../auth/session.js";
import { OverleafClient } from "../overleaf/client.js";
import { Workspace } from "../overleaf/workspace.js";
import { joinProject } from "../overleaf/socket.js";

const OUT_DIR = path.resolve("recon-output");

interface Probe {
  name: string;
  ok: boolean;
  detail: unknown;
}

async function probe(
  probes: Probe[],
  name: string,
  fn: () => Promise<unknown>,
): Promise<unknown | null> {
  try {
    const detail = await fn();
    probes.push({ name, ok: true, detail });
    return detail;
  } catch (err) {
    probes.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function run(): Promise<void> {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const probes: Probe[] = [];
  const session = await loadSessionOrThrow();
  const client = new OverleafClient(session);
  const workspace = new Workspace(client);

  const projects = (await probe(probes, "listProjects", async () => {
    const list = await client.listProjects();
    return { count: list.length, names: list.map((p) => p.name).slice(0, 10) };
  })) as { count: number } | null;

  const explicit = process.env.OVERLEAF_RECON_PROJECT_ID;
  let target = explicit;
  if (!target && projects) {
    const list = await client.listProjects();
    target = list.find((p) => !p.archived && !p.trashed)?.id;
  }

  if (!target) {
    probes.push({ name: "project probes", ok: false, detail: "No project id available" });
  } else {
    await probe(probes, "socket joinProject", async () => {
      const joined = await joinProject(client, target!);
      return {
        permissionsLevel: joined.permissionsLevel,
        protocolVersion: joined.protocolVersion,
        compiler: joined.project.compiler,
        rootFolders: joined.project.rootFolder.length,
      };
    });

    await probe(probes, "buildTree", async () => {
      const tree = await workspace.tree(target!, true);
      return {
        rootDocId: Boolean(tree.rootDocId),
        docs: tree.entries.filter((e) => e.type === "doc").length,
        files: tree.entries.filter((e) => e.type === "file").length,
        folders: tree.entries.filter((e) => e.type === "folder").length,
        paths: tree.entries.map((e) => e.path).slice(0, 40),
      };
    });

    await probe(probes, "entities", async () => {
      const result = await client.entities(target!);
      return { count: result.entities.length };
    });

    await probe(probes, "readDoc", async () => {
      const tree = await workspace.tree(target!);
      const doc = tree.entries.find((e) => e.type === "doc");
      if (!doc) return "no docs in project";
      const content = await workspace.readText(target!, doc.path);
      return { path: doc.path, chars: content.length };
    });

    await probe(probes, "readBlob", async () => {
      const tree = await workspace.tree(target!);
      const file = tree.entries.find((e) => e.type === "file" && e.hash);
      if (!file) return "no hashed files in project";
      const bytes = await workspace.readBinary(target!, file.path);
      return { path: file.path, bytes: bytes.length };
    });

    await probe(probes, "downloadZip", async () => {
      const zip = await client.downloadProjectZip(target!);
      return { bytes: zip.length };
    });

    await probe(probes, "compile", async () => {
      const result = await client.compile(target!);
      return { status: result.status, outputs: result.outputFiles.map((f) => f.path) };
    });
  }

  const report = { baseUrl: BASE_URL, ranAt: new Date().toISOString(), probes };
  await fsp.writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");

  for (const item of probes) {
    process.stdout.write(`${item.ok ? "OK  " : "FAIL"} ${item.name}\n`);
    if (!item.ok) process.stdout.write(`     ${String(item.detail)}\n`);
  }
  process.stdout.write(`\nFull report: ${path.join(OUT_DIR, "report.json")}\n`);
}

run().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
