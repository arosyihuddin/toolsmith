import { registerExtendedTools } from "./extended";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerComputerTools } from "./computer";
import { registerFilesystemTools } from "./filesystem";
import { registerCoreTools } from "./core";
import { registerSystemTools } from "./system";
import { registerTunnelTools } from "./tunnels";
import { registerRootTools } from "./root";

export async function registerTools(server: McpServer) {
  registerSystemTools(server);
  registerComputerTools(server);
  registerFilesystemTools(server);
  registerCoreTools(server);
  registerExtendedTools(server);
  registerRootTools(server);
  registerTunnelTools(server);
}
