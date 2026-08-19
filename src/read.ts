import { loadSessionOrThrow } from "./auth/session.js";
import { OverleafClient } from "./overleaf/client.js";
import { Workspace, isImage } from "./overleaf/workspace.js";
import { renderTree } from "./overleaf/tree.js";

function usage(): never {
  process.stderr.write('Usage: npm run read -- "<project name or id>" [file path]\n');
  process.exit(1);
}

async function main(): Promise<void> {
  const [query, filePath] = process.argv.slice(2);
  if (!query) usage();

  const session = await loadSessionOrThrow();
  const client = new OverleafClient(session);
  const workspace = new Workspace(client);

  const projects = await client.listProjects();
  const byId = projects.find((p) => p.id === query);
  const matches = byId ? [byId] : projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  if (matches.length === 0) {
    process.stderr.write(`No project matched "${query}". Available:\n`);
    for (const p of projects) process.stderr.write(`  ${p.id}  ${p.name}\n`);
    process.exit(1);
  }
  if (matches.length > 1) {
    process.stderr.write(`"${query}" matched ${matches.length} projects:\n`);
    for (const p of matches) process.stderr.write(`  ${p.id}  ${p.name}\n`);
    process.exit(1);
  }

  const project = matches[0]!;
  const tree = await workspace.tree(project.id, true);

  if (!filePath) {
    const docs = tree.entries.filter((e) => e.type === "doc");
    const files = tree.entries.filter((e) => e.type === "file");
    process.stdout.write(`${project.name}\n${project.id}\n\n`);
    process.stdout.write(`compiler: ${tree.compiler ?? "unknown"}\n`);
    process.stdout.write(`${docs.length} docs, ${files.length} binary files\n\n`);
    process.stdout.write(`${renderTree(tree)}\n\n`);

    for (const doc of docs) {
      const content = await workspace.readText(project.id, doc.path);
      const headings = content.match(/\\(section|subsection)\*?\{[^}]{0,80}\}/g) ?? [];
      process.stdout.write(`${doc.path}  ${content.length} chars\n`);
      for (const heading of headings.slice(0, 12)) process.stdout.write(`    ${heading}\n`);
    }
    return;
  }

  if (isImage(filePath)) {
    const bytes = await workspace.readBinary(project.id, filePath);
    process.stdout.write(`${filePath}: ${bytes.length} bytes of ${filePath.split(".").pop()}\n`);
    return;
  }
  process.stdout.write(await workspace.readText(project.id, filePath));
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
