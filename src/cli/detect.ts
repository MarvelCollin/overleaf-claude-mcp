import fsp from "node:fs/promises";
import { loadSessionOrThrow } from "../auth/session.js";
import { OverleafClient } from "../overleaf/client.js";
import { Workspace } from "../overleaf/workspace.js";
import { closeBrowser } from "../detect/browser.js";
import { detect } from "../detect/engine.js";
import { formatDetection, formatPlagiarism } from "../detect/format.js";
import { extractProse } from "../detect/latex-text.js";
import { checkPlagiarism } from "../detect/plagiarism.js";
import type { ProseBlock, ProseDocument } from "../detect/types.js";

async function readInput(argument: string | undefined): Promise<{ text: string; source: string }> {
  if (argument && argument.length > 0) {
    try {
      const file = await fsp.readFile(argument, "utf8");
      return { text: file, source: argument };
    } catch {
      return { text: argument, source: "argument" };
    }
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return { text: Buffer.concat(chunks).toString("utf8"), source: "stdin" };
}

async function fromProject(query: string, only?: string): Promise<{ document: ProseDocument; source: string }> {
  const session = await loadSessionOrThrow();
  const client = new OverleafClient(session);
  const workspace = new Workspace(client);

  const projects = await client.listProjects();
  const byId = projects.find((p) => p.id === query);
  const matches = byId
    ? [byId]
    : projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  if (matches.length !== 1) {
    for (const p of projects) process.stderr.write(`  ${p.id}  ${p.name}
`);
    throw new Error(`"${query}" matched ${matches.length} projects`);
  }

  const project = matches[0] as (typeof projects)[number];
  const sources = (await workspace.sources(project.id)).filter(
    (s) => /\.tex$/i.test(s.path) && (!only || s.path === only),
  );
  if (sources.length === 0) throw new Error(`no .tex file to check in "${project.name}"`);

  const blocks: ProseBlock[] = [];
  for (const source of sources) {
    const parsed = extractProse(source.content);
    for (const block of parsed.blocks) block.path = source.path;
    blocks.push(...parsed.blocks);
  }

  return {
    document: { blocks, text: blocks.map((b) => b.text).join("\n\n") },
    source: only ? `${project.name} / ${only}` : `${project.name}, ${sources.length} file(s)`,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const providers = args
    .filter((a) => a.startsWith("--providers="))
    .flatMap((a) => a.split("=")[1]?.split(",") ?? []);
  const positional = args.find((a) => !a.startsWith("--"));
  const project = args.find((a) => a.startsWith("--project="))?.split("=").slice(1).join("=");
  const file = args.find((a) => a.startsWith("--file="))?.split("=").slice(1).join("=");

  let prose: ProseDocument;
  let source: string;
  let path: string | undefined;

  if (project) {
    const pulled = await fromProject(project, file);
    prose = pulled.document;
    source = pulled.source;
  } else {
    const input = await readInput(positional);
    source = input.source;
    const isTex = /\\(documentclass|begin\{document\}|section|usepackage)/.test(input.text);
    prose = isTex
      ? extractProse(input.text)
      : { blocks: [{ text: input.text, line: 1 }], text: input.text };
    path = source === "argument" || source === "stdin" ? undefined : source;
  }

  if (prose.text.trim().length < 100) {
    console.error("Need at least 100 characters of prose to check.");
    process.exitCode = 1;
    return;
  }

  if (args.includes("--plagiarism")) {
    const report = await checkPlagiarism({ text: prose.text, blocks: prose.blocks, path });
    console.log(formatPlagiarism(report, source, 20));
    await closeBrowser();
    return;
  }

  const result = await detect({
    text: prose.text,
    blocks: prose.blocks,
    path,
    providers: providers.length > 0 ? providers : undefined,
  });

  console.log(formatDetection(result, source, 20));
  await closeBrowser();
}

await main();
