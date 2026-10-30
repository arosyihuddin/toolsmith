import { subscribeDashboardEvents } from "./events";
import { getProcessSnapshots } from "../process";
import { config } from "../lib/config";
import { listApprovals } from "../approval";
import { countToolCallsToday } from "../control-plane/logs";
import { getCpuInfo, getDiskInfo, getDisplayInfo, getDesktopInfo, getGpuInfo, getMemoryInfo, getNetworkInfo, getOsInfo, getRuntimeInfo } from "../system/info";

let dashboardStaticCache: {
  at: number;
  os: unknown;
  disk: unknown;
  display: unknown;
  runtime: unknown;
  desktop: unknown;
  network: unknown;
} | null = null;
let dashboardTelemetryCache: { at: number; promise: Promise<unknown> } | null =
  null;

async function getDashboardTelemetry(): Promise<unknown> {
  const now = Date.now();
  if (dashboardTelemetryCache && now - dashboardTelemetryCache.at < 1_900) {
    return dashboardTelemetryCache.promise;
  }

  const promise = (async () => {
    if (!dashboardStaticCache || now - dashboardStaticCache.at >= 60_000) {
      const [os, disk, display, runtime] = await Promise.all([
        getOsInfo(),
        getDiskInfo(),
        getDisplayInfo(),
        getRuntimeInfo(),
      ]);
      dashboardStaticCache = {
        at: Date.now(),
        os,
        disk,
        display,
        runtime,
        desktop: getDesktopInfo(),
        network: getNetworkInfo(),
      };
    }

    const [gpu] = await Promise.all([getGpuInfo()]);
    const cached = dashboardStaticCache!;
    return {
      system: {
        os: cached.os,
        cpu: getCpuInfo(),
        memory: getMemoryInfo(),
        gpu,
        disk: cached.disk,
        desktop: cached.desktop,
        display: cached.display,
        runtime: cached.runtime,
        network: cached.network,
      },
      service: {
        transport: config.transport,
        httpHost: config.httpHost,
        httpPort: config.httpPort,
        httpPath: config.httpPath,
      },
    };
  })();

  dashboardTelemetryCache = { at: now, promise };
  try {
    return await promise;
  } catch (error) {
    if (dashboardTelemetryCache?.promise === promise)
      dashboardTelemetryCache = null;
    throw error;
  }
}

export async function handleEventsApi(request: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== "/api/events" || request.method !== "GET") return null;
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          cleanup();
        }
      };

      send("dashboard.snapshot", {
        approvals: listApprovals(),
        toolCallsToday: countToolCallsToday(),
      });

      let telemetryBusy = false;
      const sendTelemetry = async () => {
        if (telemetryBusy) return;
        telemetryBusy = true;
        try {
          send("telemetry.updated", await getDashboardTelemetry());
        } finally {
          telemetryBusy = false;
        }
      };
      void sendTelemetry();

      const unsubscribe = subscribeDashboardEvents((event) => {
        send(event.type, event.data);
      });
      const telemetryTimer = setInterval(() => void sendTelemetry(), 2_000);
      let processMetricsBusy = false;
      const sendProcessMetrics = async () => {
        if (processMetricsBusy) return;
        processMetricsBusy = true;
        try {
          const processes = await getProcessSnapshots();
          if (processes.some((item) => item.status === "running" || item.status === "stopping")) {
            send("process.metrics", { processes });
          }
        } finally {
          processMetricsBusy = false;
        }
      };
      void sendProcessMetrics();
      const processMetricsTimer = setInterval(() => void sendProcessMetrics(), 1_000);
      const heartbeat = setInterval(
        () => send("ping", { time: new Date().toISOString() }),
        20_000,
      );
      const onAbort = () => cleanup();
      cleanup = () => {
        unsubscribe();
        clearInterval(telemetryTimer);
        clearInterval(processMetricsTimer);
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, must-revalidate",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
