import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const ENTRY = path.join(ROOT, "dist", "index.js");

const PROJECT_QUERY = process.argv[2] ?? "Efficient Reasoning";

interface CallOutcome {
  ok: boolean;
  body: string;
  images: number;
}

let passed = 0;
let failed = 0;

function record(label: string, ok: boolean, detail: string): void {
  if (ok) {
    passed += 1;
    process.stdout.write(`PASS  ${label}\n`);
  } else {
    failed += 1;
    process.stdout.write(`FAIL  ${label}\n`);
  }
  if (detail) process.stdout.write(`      ${detail.replace(/\n/g, "\n      ")}\n`);
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({ command: "node", args: [ENTRY] });
  const client = new Client({ name: "overleaf-mcp-check", version: "1.0.0" });
  await client.connect(transport);
  process.stdout.write(`Connected to ${ENTRY}\n\n`);

  const listed = await client.listTools();
  record("tools/list", listed.tools.length > 0, `${listed.tools.length} tools exposed`);

  const call = async (name: string, args: Record<string, unknown>): Promise<CallOutcome> => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content?: { type: string; text?: string }[];
    };
    const parts = result.content ?? [];
    return {
      ok: result.isError !== true,
      body: parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n"),
      images: parts.filter((p) => p.type === "image").length,
    };
  };

  const projects = await call("overleaf_list_projects", {});
  record("overleaf_list_projects", projects.ok, projects.body.split("\n").slice(0, 12).join("\n"));

  const selected = await call("overleaf_select_project", { query: PROJECT_QUERY });
  record("overleaf_select_project", selected.ok, selected.body.split("\n").slice(0, 30).join("\n"));

  const current = await call("overleaf_current_project", {});
  record("overleaf_current_project", current.ok, current.body);

  const files = await call("overleaf_list_files", {});
  const fileLines = files.body.split("\n").filter((l) => l.trim());
  record("overleaf_list_files", files.ok, `${fileLines.length} lines returned`);

  const head = await call("overleaf_read_file", { filePath: "access.tex", startLine: 1, endLine: 12 });
  record("overleaf_read_file paged", head.ok, head.body);

  const big = await call("overleaf_read_file", { filePath: "IEEEtran.cls" });
  const truncated = big.body.startsWith("IEEEtran.cls is ");
  record("overleaf_read_file truncates big files", big.ok && truncated, big.body.split("\n")[0] ?? "");

  const grep = await call("overleaf_grep", { pattern: "\\\\documentclass", maxMatches: 5 });
  record("overleaf_grep", grep.ok, grep.body.split("\n").slice(0, 5).join("\n"));

  const image = await call("overleaf_read_image", { filePath: "figures/fig1.png" });
  record("overleaf_read_image", image.ok && image.images === 1, `${image.images} image block(s)`);

  const status = await call("overleaf_status", {});
  record("overleaf_status", status.ok && status.body.includes("connection: OK"), status.body);

  const url = await call("overleaf_project_url", {});
  record("overleaf_project_url", url.ok && url.body.includes("/project/"), url.body);

  const missing = await call("overleaf_read_file", { filePath: "does/not/exist.tex" });
  record("missing file reports an error", missing.ok === false, missing.body.slice(0, 120));

  const typo = await call("overleaf_read_file", { filePath: "methodology.tex" });
  record(
    "wrong path suggests the right one",
    typo.ok === false && typo.body.includes("sections/methodology.tex"),
    typo.body.slice(0, 160),
  );

  const guarded = await call("overleaf_delete", { filePath: "access.tex", confirm: false });
  record("delete refuses without confirm", guarded.ok === false, guarded.body.slice(0, 120));

  const compiled = await call("overleaf_compile_log", {});
  record("overleaf_compile_log", compiled.ok, compiled.body.split("\n").slice(0, 6).join("\n"));

  const words = await call("overleaf_word_count", {});
  record("overleaf_word_count", words.ok, words.body.split("\n").slice(0, 8).join("\n"));

  await client.close();
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
