#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AppContext } from "./context.js";
import { registerTools } from "./tools/index.js";

const SERVER_INFO = { name: "overleaf-claude-mcp", version: "0.2.0" };

async function main(): Promise<void> {
  const server = new McpServer(SERVER_INFO);
  registerTools(server, new AppContext());
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
