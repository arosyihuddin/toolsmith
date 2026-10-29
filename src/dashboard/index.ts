import { handleTunnelApi } from "../tunnels/manager";
import { handleWorkspaceApi } from "./workspace-api";
import { handleEventsApi } from "./events-api";
import { handleTerminalApi } from "./terminal-api";
import { handleToolsApi } from "./tools-api";
import { handleOverviewApi } from "./overview-api";
import { handleRootCommandsApi } from "./root-commands-api";
import { handleApprovalsApi } from "./approvals-api";
import { handleWorkspaceFilesApi } from "./workspace-files-api";

export async function handleDashboardRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const tunnelResponse = await handleTunnelApi(request, url);
  if (tunnelResponse) return tunnelResponse;

  const workspaceResponse = await handleWorkspaceApi(request, url);
  if (workspaceResponse) return workspaceResponse;

  const eventsResponse = await handleEventsApi(request, url);
  if (eventsResponse) return eventsResponse;

  const terminalResponse = await handleTerminalApi(request, url);
  if (terminalResponse) return terminalResponse;

  const toolsResponse = await handleToolsApi(request, url);
  if (toolsResponse) return toolsResponse;

  const overviewResponse = await handleOverviewApi(request, url);
  if (overviewResponse) return overviewResponse;

  const rootCommandsResponse = await handleRootCommandsApi(request, url);
  if (rootCommandsResponse) return rootCommandsResponse;

  const approvalsResponse = await handleApprovalsApi(request, url);
  if (approvalsResponse) return approvalsResponse;

  const workspaceFilesResponse = await handleWorkspaceFilesApi(request, url);
  if (workspaceFilesResponse) return workspaceFilesResponse;

  if (url.pathname === "/" || url.pathname === "/dashboard") {
    return Response.json({
      service: "toolsmith",
      message:
        "The dashboard UI is provided by the standalone Toolsmith Console project.",
      apiBase: "/api",
    });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
