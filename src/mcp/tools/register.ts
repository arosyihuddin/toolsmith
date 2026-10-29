import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureToolConfig, isToolExposed, subscribeToolExposure } from "../../control-plane/tools/exposure";
import { recordToolCallLog, updateToolCallLog } from "../../control-plane/logs";
import { getToolPermission } from "../../control-plane/tools/permissions";
import { evaluateCustomPermissionRule } from "../../control-plane/tools/custom-rules";
import { getApprovalDecisionMessage, requestApproval } from "../../approval";
import { isRootCommandWhitelisted } from "../../control-plane/root-commands";
import { errorResult } from "./shared";
import { registerToolInputSchema } from "../../control-plane/tools/input-schema";
const handles = new WeakMap<McpServer, Map<string, RegisteredTool>>();
const subscribedServers = new WeakSet<McpServer>();

function ensureServerSubscription(server: McpServer) {
  if (subscribedServers.has(server)) return;
  subscribedServers.add(server);
  const serverHandles = new Map<string, RegisteredTool>();
  handles.set(server, serverHandles);
  subscribeToolExposure((name, exposed) => {
    const tool = serverHandles.get(name);
    if (!tool) return;
    if (exposed) tool.update({ name, enabled: true });
    else tool.update({ name: null, enabled: false });
  });
}

type ToolDefinition<OutputArgs extends ZodRawShapeCompat | AnySchema, InputArgs extends undefined | ZodRawShapeCompat | AnySchema> = {
  title?: string;
  description?: string;
  inputSchema?: InputArgs;
  outputSchema?: OutputArgs;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
};

export function registerExposedTool<OutputArgs extends ZodRawShapeCompat | AnySchema, InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined>(
  server: McpServer,
  name: string,
  definition: ToolDefinition<OutputArgs, InputArgs>,
  handler: ToolCallback<InputArgs>,
): RegisteredTool {
  ensureServerSubscription(server);
  ensureToolConfig(name);
  registerToolInputSchema(name, definition.inputSchema);
  type GenericExtra = Parameters<ToolCallback<ZodRawShapeCompat>>[1];
  type GenericHandler = (...args: unknown[]) => ReturnType<ToolCallback<ZodRawShapeCompat>>;
  const genericHandler = handler as unknown as GenericHandler;
  const wrappedHandler = async (...callbackArgs: unknown[]) => {
    const hasArgs = callbackArgs.length === 2;
    const args = hasArgs ? callbackArgs[0] : undefined;
    const extra = (hasArgs ? callbackArgs[1] : callbackArgs[0]) as GenericExtra;
    const startedAt = performance.now();
    let serializedArgs = "{}";
    try { serializedArgs = JSON.stringify(args); } catch { serializedArgs = String(args); }
    let logId: string | undefined;
    try {
      const log = recordToolCallLog({
        timestamp: new Date().toISOString(),
        requestId: String(extra.requestId),
        sessionId: extra.sessionId,
        toolName: name,
        status: "waiting_approval",
        approval: null,
        durationMs: null,
        arguments: serializedArgs,
        result: null,
        error: null,
      });
      logId = log.id;
      const annotations = definition.annotations;
      const risk = annotations?.readOnlyHint ? "low" : (annotations?.openWorldHint || ["bash", "sudo_exec", "mouse_click", "mouse_drag", "keyboard_press", "keyboard_hotkey", "keyboard_type"].includes(name)) ? "high" : "medium";
      const toolPermission = getToolPermission(name, risk);
      const policy = toolPermission.permission;
      const customAction = policy === "custom"
        ? evaluateCustomPermissionRule(toolPermission.customRule, { name, risk, args })
        : null;
      if (policy === "blocked" || customAction === "block") {
        const message = `Tool '${name}' is blocked by the Toolsmith permission policy.`;
        updateToolCallLog(logId, {
          status: "error",
          durationMs: Math.round(performance.now() - startedAt),
          result: JSON.stringify({ error: message, blocked: true }),
          error: message,
        });
        return errorResult(message);
      }
      let whitelistMatch = false;
      if (name === "sudo_exec" && args !== null && typeof args === "object" && "command" in args && "args" in args) {
        whitelistMatch = isRootCommandWhitelisted(args.command, args.args);
      }
      const needsApproval = !whitelistMatch && (policy === "require_approval" || customAction === "require_approval");
      if (needsApproval) {
        const decision = await requestApproval({
          tool: name,
          args: (args && typeof args === "object" ? args : {}) as Record<string, unknown>,
          risk: risk === "high" ? "high" : "medium",
          sessionId: extra.sessionId,
          requestId: extra.requestId,
          signal: extra.signal,
          reason: policy === "custom" ? "Custom permission rule requires approval." : "Tool permission policy requires approval before execution.",
        });
        if (!decision.approved) {
          const message = getApprovalDecisionMessage(decision.status);
          updateToolCallLog(logId, { status: "error", durationMs: Math.round(performance.now() - startedAt), error: message, result: JSON.stringify({ error: message }) });
          return errorResult(message);
        }
      }
      updateToolCallLog(logId, { status: "running" });
      const response = hasArgs ? await genericHandler(args, extra) : await genericHandler(extra);
      let serializedResult = "";
      try { serializedResult = JSON.stringify(response.content); } catch { serializedResult = String(response.content); }
      updateToolCallLog(logId, {
        status: response.isError ? "error" : "success",
        durationMs: Math.round(performance.now() - startedAt),
        result: serializedResult.length > 20000 ? serializedResult.slice(0, 20000) + "…" : serializedResult,
        error: response.isError ? serializedResult : null,
      });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (logId) updateToolCallLog(logId, {
        status: "error",
        durationMs: Math.round(performance.now() - startedAt),
        result: null,
        error: message,
      });
      throw error;
    }
  };
  const tool = server.registerTool(name, definition, wrappedHandler as unknown as ToolCallback<InputArgs>);
  handles.get(server)!.set(name, tool);
  if (!isToolExposed(name)) tool.update({ name: null, enabled: false });
  return tool;
}
