import { registerExposedTool } from "./register";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../../lib/config";
import { logger } from "../../lib/logger";
import { fsFind, fsGrep } from "../../filesystem/search";
import { errorMessage, errorResult, logValue, result } from "./shared";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function registerFilesystemTools(server: McpServer) {
  registerExposedTool(server, "fs_find", {
    description: "Search files and directories by pattern. Uses fd when available and a built-in fallback otherwise; read-only.",
    inputSchema: {
      pattern: z.string().optional(), path: z.string().min(1).optional(),
      type: z.enum(["file", "directory", "both"]).optional().default("both"),
      hidden: z.boolean().optional().default(false), max_results: z.number().int().min(1).max(1000).optional().default(100),
      max_depth: z.number().int().min(0).optional(),
    }, annotations: readOnly,
  }, async ({ pattern, path, type, hidden, max_results, max_depth }, extra) => {
    const startedAt = performance.now();
    const args = { pattern, path, type, hidden, max_results, max_depth };
    logger.debug({ tool: "fs_find", args }, "MCP tool call");
    try {
      const value = await fsFind(args, config.defaultCwd, extra.signal);
      logger.debug({ tool: "fs_find", durationMs: Math.round(performance.now() - startedAt), result: logValue(value) }, "MCP tool call completed");
      return result(value);
    } catch (error) {
      logger.error({ err: error, tool: "fs_find", durationMs: Math.round(performance.now() - startedAt) }, "MCP tool call failed");
      return errorResult(errorMessage(error));
    }
  });

  registerExposedTool(server, "fs_grep", {
    description: "Fast recursive content search using ripgrep. Suitable for large directory trees; read-only.",
    inputSchema: {
      pattern: z.string().min(1), path: z.string().min(1).optional(), glob: z.string().min(1).optional(),
      hidden: z.boolean().optional().default(false), max_results: z.number().int().min(1).max(1000).optional().default(100),
      max_depth: z.number().int().min(0).optional(), fixed_strings: z.boolean().optional().default(false),
    }, annotations: readOnly,
  }, async ({ pattern, path, glob, hidden, max_results, max_depth, fixed_strings }, extra) => {
    const startedAt = performance.now();
    const args = { pattern, path, glob, hidden, max_results, max_depth, fixed_strings };
    logger.debug({ tool: "fs_grep", args }, "MCP tool call");
    try {
      const value = await fsGrep(args, config.defaultCwd, extra.signal);
      logger.debug({ tool: "fs_grep", durationMs: Math.round(performance.now() - startedAt), result: logValue(value) }, "MCP tool call completed");
      return result(value);
    } catch (error) {
      logger.error({ err: error, tool: "fs_grep", durationMs: Math.round(performance.now() - startedAt) }, "MCP tool call failed");
      return errorResult(errorMessage(error));
    }
  });
}
