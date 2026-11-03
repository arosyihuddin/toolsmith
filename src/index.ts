import { mkdir } from "node:fs/promises";
import { logger } from "./lib/logger";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./mcp/server";
import { handleMcpHttpRequest, closeMcpHttpSessions } from "./app/http";
import { handleDashboardRequest } from "./dashboard";
import { terminalManager } from "./terminal";
import { config } from "./lib/config";
import { stopAllTunnels } from "./tunnels/manager";
import { authorizeHttpRequest } from "./lib/http-auth";
import { handleOAuthRequest, isOAuthEndpoint } from "./lib/oauth";

let server: Awaited<ReturnType<typeof createServer>> | undefined;
let httpServer: ReturnType<typeof Bun.serve> | undefined;

await mkdir(config.defaultCwd, { recursive: true });

server = await createServer();
if (config.transport === "stdio" || config.transport === "both") {
  logger.info({ transport: "stdio" }, "Toolsmith server starting");

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info({ transport: "stdio" }, "Toolsmith server connected");
} else {
  // Register tool schemas at startup even in HTTP-only mode, before the first
  // MCP client connects and the dashboard requests its tool catalog.
  logger.info({ transport: "http", schemas: "initialized" }, "Toolsmith tool schemas initialized");
}

if (config.transport === "http" || config.transport === "both") {
  httpServer = Bun.serve({
    hostname: config.httpHost,
    port: config.httpPort,
    async fetch(request) {
      const url = new URL(request.url);
      if (isOAuthEndpoint(url.pathname)) return handleOAuthRequest(request);

      const authFailure = await authorizeHttpRequest(request, url.pathname === config.httpPath);
      if (authFailure) return authFailure;

      if (url.pathname === config.httpPath) {
        return handleMcpHttpRequest(request);
      }

      if (url.pathname === "/api/terminal/socket" && request.method === "GET") {
        const terminalId = url.searchParams.get("id");
        if (!terminalId || !terminalManager.get(terminalId)) {
          return new Response("Unknown terminal", { status: 404 });
        }
        if (httpServer?.upgrade(request, { data: { terminalId } })) return;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      return handleDashboardRequest(request);
    },
    websocket: {
      open(ws) {
        const terminalId = (ws.data as { terminalId: string }).terminalId;
        terminalManager.attach(ws as Bun.ServerWebSocket<{ terminalId: string }>, terminalId);
      },
      message(ws, message) {
        try {
          const payload = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
          const terminalId = (ws.data as { terminalId: string }).terminalId;
          if (payload.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", time: payload.time }));
          } else if (payload.type === "input" && typeof payload.data === "string") {
            terminalManager.input(terminalId, payload.data);
          } else if (payload.type === "resize") {
            terminalManager.resize(terminalId, Number(payload.cols), Number(payload.rows));
          }
        } catch {}
      },
      close(ws) {
        terminalManager.detach(ws as Bun.ServerWebSocket<{ terminalId: string }>);
      },
      idleTimeout: 0,
    },
    idleTimeout: 120,
  });

  logger.info(
    {
      transport: "streamable-http",
      url: `http://${config.httpHost}:${httpServer.port}${config.httpPath}`,
    },
    "Toolsmith MCP Streamable HTTP server listening",
  );
}

let shutdownPromise: Promise<void> | undefined;

const shutdown = (signal: string) => {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    logger.info({ signal }, "Toolsmith server shutting down");

    httpServer?.stop();
    await stopAllTunnels();
    await closeMcpHttpSessions();
    await terminalManager.disposeAll();
    await server?.close();
  })();
  return shutdownPromise;
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
