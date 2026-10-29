import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeRootCommand } from "../../control-plane/root-commands";
import { registerExposedTool } from "./register";
import { errorMessage, errorResult, result } from "./shared";

export function registerRootTools(server: McpServer) {
  registerExposedTool(
    server,
    "sudo_exec",
    {
      description:
        "Run one root command directly without a shell. An exact enabled Root Command Rule match bypasses approval; otherwise execution follows the Toolsmith permission policy and any required approval. Shells and interpreters are blocked; arguments are passed literally, without shell parsing.",
      inputSchema: {
        command: z
          .string()
          .min(1)
          .max(256)
          .regex(/^[a-zA-Z0-9_.+-]+$/)
          .describe("Command name only, e.g. systemctl; do not pass an absolute path"),
        args: z
          .array(z.string().max(256))
          .max(32)
          .describe("Exact argument list; no shell parsing is performed"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ command, args }, extra) => {
      try {
        const output = await executeRootCommand(command, args, extra.signal);
        return result(output);
      } catch (error) {
        return errorResult(errorMessage(error));
      }
    },
  );
}
