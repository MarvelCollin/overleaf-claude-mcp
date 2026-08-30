import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const ENTRY = process.env.OVERLEAF_MCP_ENTRY ?? path.join(ROOT, "dist", "index.js");

const EXPECTED = [
  "overleaf_status",
  "overleaf_list_projects",
  "overleaf_select_project",
  "overleaf_list_files",
  "overleaf_read_file",
  "overleaf_read_image",
  "overleaf_grep",
  "overleaf_write_file",
  "overleaf_edit_file",
  "overleaf_delete",
  "overleaf_history",
  "overleaf_diff",
  "overleaf_restore_file",
  "overleaf_compile",
  "overleaf_ai_detect",
  "overleaf_plagiarism_check",
  "overleaf_detectors",
];

let failures = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` :: ${detail}` : ""}`);
  }
}

const transport = new StdioClientTransport({
  command: "node",
  args: [ENTRY],
  env: {
    ...process.env,
    OVERLEAF_HOME_DIR: path.join(os.tmpdir(), `overleaf-ci-${Date.now()}`),
  },
});

const client = new Client({ name: "overleaf-ci", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name);

check("server starts and completes the MCP handshake", tools.length > 0, `${tools.length} tools`);

for (const name of EXPECTED) {
  check(`exposes ${name}`, names.includes(name));
}

check(
  "every tool has a description",
  tools.every((t) => typeof t.description === "string" && t.description.length > 0),
);

const status = await client.callTool({ name: "overleaf_status", arguments: {} });
const statusText = (status.content ?? [])
  .filter((c) => c.type === "text")
  .map((c) => c.text)
  .join("\n");
check(
  "reports a missing session instead of crashing",
  statusText.includes("No session"),
  statusText.slice(0, 120),
);

const read = await client.callTool({
  name: "overleaf_read_file",
  arguments: { filePath: "main.tex" },
});
check("unauthenticated read returns an error result", read.isError === true);

const destructive = await client.callTool({
  name: "overleaf_delete",
  arguments: { filePath: "main.tex", confirm: false },
});
check("delete refuses without confirm", destructive.isError === true);

await client.close();

console.log(failures === 0 ? "\nAll startup checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
