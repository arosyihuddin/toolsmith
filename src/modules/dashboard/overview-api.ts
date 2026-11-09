import { config } from "../../lib/config";
import { getSystemInfo } from "../system/info";
import { listApprovals } from "../approval";
import { countToolCallsToday, listToolCallLogs } from "../../control-plane/logs";
import { getDashboardTools } from "./tools";

export async function handleOverviewApi(request: Request, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/logs" && request.method === "GET") {
    const rawLimit = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(rawLimit) ? rawLimit : 100;
    return Response.json(
      { logs: listToolCallLogs(limit) },
      { headers: { "cache-control": "no-store" } },
    );
  }
  if (url.pathname === "/api/dashboard") {
    const [system, tools] = await Promise.all([
      getSystemInfo(),
      getDashboardTools(),
    ]);
    const toolRiskCounts = Object.fromEntries(
      ["low", "medium", "high", "isolated"].map((risk) => [
        risk,
        tools.filter((tool) => tool.risk === risk).length,
      ]),
    );
    return Response.json(
      {
        host: {
          system,
          service: {
            transport: config.transport,
            httpHost: config.httpHost,
            httpPort: config.httpPort,
            httpPath: config.httpPath,
          },
        },
        toolCount: tools.length,
        toolRiskCounts,
        toolCallsToday: countToolCallsToday(),
        approvalCount: listApprovals().filter(
          (approval) => approval.status === "pending",
        ).length,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  return null;
}
