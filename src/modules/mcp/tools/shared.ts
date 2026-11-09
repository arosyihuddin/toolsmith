import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function result(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function logValue(value: unknown, maxLength = 2000) {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
