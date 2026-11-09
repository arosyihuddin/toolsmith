import { registerExposedTool } from "./register";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSystemInfo, getHardwareInfo, getCapabilities } from "../../system/info";
import { errorMessage, errorResult, result } from "./shared";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function registerSystemTools(server: McpServer) {
  registerExposedTool(server, "system_info", {
    description: "Get a structured snapshot of the host OS, CPU, memory, GPU, disk, desktop session, display, runtimes, and network interfaces. Read-only.",
    inputSchema: {}, annotations: readOnly,
  }, async () => {
    try { return result(await getSystemInfo()); }
    catch (error) { return errorResult(errorMessage(error)); }
  });

  registerExposedTool(server, "hardware_info", {
    description: "Get CPU, memory, GPU, and root filesystem information. Read-only.",
    inputSchema: {}, annotations: readOnly,
  }, async () => {
    try { return result(await getHardwareInfo()); }
    catch (error) { return errorResult(errorMessage(error)); }
  });

  registerExposedTool(server, "capabilities", {
    description: "Detect host capabilities relevant to computer automation, including GUI session, display server, accessibility bus, NVIDIA GPU, and installed runtimes. Read-only.",
    inputSchema: {}, annotations: readOnly,
  }, async () => {
    try { return result(await getCapabilities()); }
    catch (error) { return errorResult(errorMessage(error)); }
  });
}
