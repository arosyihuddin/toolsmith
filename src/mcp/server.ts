import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import "../control-plane/db";
import { registerTools } from "./tools";

export async function createServer() {
  const server = new McpServer({ name: "toolsmith-mcp-server", version: "0.1.0" });
  await registerTools(server);
  return server;
}
