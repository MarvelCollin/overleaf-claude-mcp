import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AppContext } from "../context.js";

export type ToolResult = CallToolResult;

export type ToolModule = (server: McpServer, context: AppContext) => void;
