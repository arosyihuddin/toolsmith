import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerExposedTool } from "./register";
import { errorMessage, errorResult, result } from "./shared";
import { getTunnel, listTunnels, startTunnel, stopTunnel } from "../../tunnels/manager";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const mutating = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;

export function registerTunnelTools(server: McpServer) {
  registerExposedTool(server, "tunnel_list", {
    description: "List Cloudflare Quick Tunnels managed by Toolsmith, including state, target URL, public URL, and recent logs.",
    inputSchema: {}, annotations: readOnly,
  }, async () => result({ tunnels: listTunnels() }));

  registerExposedTool(server, "tunnel_start", {
    description: "Start a Cloudflare Quick Tunnel to a local HTTP(S) service. Target must use localhost, 127.0.0.1, or ::1. Requires cloudflared installed on the Toolsmith host.",
    inputSchema: { target: z.string().min(1).max(2048).describe("Local target URL, for example http://127.0.0.1:5173") },
    annotations: mutating,
  }, async ({ target }) => {
    try { return result({ tunnel: await startTunnel(target) }); }
    catch (error) { return errorResult(errorMessage(error)); }
  });

  registerExposedTool(server, "tunnel_stop", {
    description: "Stop a managed Cloudflare Quick Tunnel by its ID.",
    inputSchema: { id: z.string().min(1) },
    annotations: mutating,
  }, async ({ id }) => {
    try {
      const tunnel = await stopTunnel(id);
      return tunnel ? result({ tunnel }) : errorResult("Tunnel not found.");
    } catch (error) { return errorResult(errorMessage(error)); }
  });

  registerExposedTool(server, "tunnel_status", {
    description: "Get the current state and recent logs for a managed Cloudflare Quick Tunnel.",
    inputSchema: { id: z.string().min(1) },
    annotations: readOnly,
  }, async ({ id }) => {
    const tunnel = getTunnel(id);
    return tunnel ? result({ tunnel }) : errorResult("Tunnel not found.");
  });
}
