import { registerExposedTool } from "./register";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { takeScreenshot, listWindows, activeWindow, listApps } from "../../computer";
import { errorMessage, errorResult, result } from "./shared";

const screenshotOutput = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

export function registerComputerTools(server: McpServer) {
  registerExposedTool(server, "window_list", {
    description: "List currently open desktop windows and their workspace, monitor, application, and focus state.",
    inputSchema: {}, annotations: screenshotOutput,
  }, async () => {
    try { return result({ windows: await listWindows() }); }
    catch (error) { return errorResult(errorMessage(error)); }
  });

  registerExposedTool(server, "window_active", {
    description: "Get the desktop window that currently has keyboard focus.",
    inputSchema: {}, annotations: screenshotOutput,
  }, async () => {
    try { return result({ window: await activeWindow() }); }
    catch (error) { return errorResult(errorMessage(error)); }
  });

  registerExposedTool(server, "app_list", {
    description: "List desktop applications available on the operating system. Supports optional search and result limit.",
    inputSchema: {
      query: z.string().optional().describe("Search by application name, id, or executable."),
      limit: z.number().int().min(1).max(100).optional().default(20).describe("Maximum number of applications to return."),
    }, annotations: screenshotOutput,
  }, async ({ query, limit }) => {
    try { return result({ apps: await listApps({ query, limit }) }); }
    catch (error) { return errorResult(errorMessage(error)); }
  });

  registerExposedTool(server, "screenshot", {
    description: "Capture the current desktop screen as a PNG. Requires an interactive GUI session.",
    inputSchema: { output_path: z.string().min(1).optional() }, annotations: screenshotOutput,
  }, async ({ output_path }) => {
    try {
      const image = await takeScreenshot(output_path);
      return { content: [
        { type: "text", text: JSON.stringify({ mime_type: image.mime_type, size_bytes: image.size_bytes, path: image.path }) },
        { type: "image", data: image.data_base64, mimeType: image.mime_type },
      ] };
    } catch (error) { return errorResult(errorMessage(error)); }
  });
}
