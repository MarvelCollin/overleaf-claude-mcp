import type { ToolResult } from "./types.js";

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
