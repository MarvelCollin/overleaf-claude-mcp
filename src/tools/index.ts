import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../context.js";
import { registerProjectTools } from "./projects.js";
import { registerFileTools } from "./files.js";
import { registerEditingTools } from "./editing.js";
import { registerHistoryTools } from "./history.js";
import { registerCompileTools } from "./compile.js";
import { registerDetectTools } from "./detect.js";
import type { ToolModule } from "./types.js";

const MODULES: ToolModule[] = [
  registerProjectTools,
  registerFileTools,
  registerEditingTools,
  registerHistoryTools,
  registerCompileTools,
  registerDetectTools,
];

export function registerTools(server: McpServer, context: AppContext): void {
  for (const register of MODULES) register(server, context);
}
