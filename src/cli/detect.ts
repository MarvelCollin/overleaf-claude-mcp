import fsp from "node:fs/promises";
import { closeBrowser } from "../detect/browser.js";
import { detect } from "../detect/engine.js";
import { formatDetection } from "../detect/format.js";
import { extractProse } from "../detect/latex-text.js";

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const providers = args
    .filter((a) => a.startsWith("--providers="))
    .flatMap((a) => a.split("=")[1]?.split(",") ?? []);
  const positional = args.find((a) => !a.startsWith("--"));

  const { text, source } = await readInput(positional);
  const isTex = /\\(documentclass|begin\{document\}|section|usepackage)/.test(text);
  const prose = isTex ? extractProse(text) : { blocks: [{ text, line: 1 }], text };

  if (prose.text.trim().length < 100) {
    console.error("Need at least 100 characters of prose to check.");
    process.exitCode = 1;
    return;
  }

  const result = await detect({
    text: prose.text,
    blocks: prose.blocks,
    path: source === "argument" || source === "stdin" ? undefined : source,
    providers: providers.length > 0 ? providers : undefined,
  });

  console.log(formatDetection(result, source, 20));
  await closeBrowser();
}

await main();
