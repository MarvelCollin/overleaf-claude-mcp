import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AppContext } from "../context.js";

export type ToolResult = CallToolResult;

export type ToolModule = (server: McpServer, context: AppContext) => void;

export function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

export function image(data: Buffer, mimeType: string): ToolResult {
  return { content: [{ type: "image", data: data.toString("base64"), mimeType }] };
}

export function failure(err: unknown): ToolResult {
  return {
    content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
    isError: true,
  };
}

export async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    return failure(err);
  }
}
