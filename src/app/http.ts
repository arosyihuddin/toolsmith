import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "../modules/mcp/server";
import { logger } from "../lib/logger";

interface HttpSession {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}

const sessions = new Map<string, HttpSession>();

export async function handleMcpHttpRequest(
  request: Request,
): Promise<Response> {
  const sessionId = request.headers.get("mcp-session-id");

  const startedAt = performance.now();
  const requestLog = {
    method: request.method,
    path: new URL(request.url).pathname,
    sessionId: sessionId ?? null,
    protocolVersion: request.headers.get("mcp-protocol-version"),
    clientInfo: request.headers.get("user-agent"),
    origin: request.headers.get("origin"),
  };
  logger.info(
    { event: "mcp_http_request", ...requestLog },
    "MCP HTTP request received",
  );
  const logResponse = (response: Response, responseSessionId?: string) => {
    logger.info(
      {
        event: "mcp_http_response",
        ...requestLog,
        responseSessionId:
          responseSessionId ?? response.headers.get("mcp-session-id"),
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
      },
      "MCP HTTP response sent",
    );
    return response;
  };

  if (sessionId) {
    const session = sessions.get(sessionId);

    if (!session) {
      return logResponse(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Unknown MCP session" },
            id: null,
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
      );
    }

    const response = await session.transport.handleRequest(request);
    return logResponse(response, sessionId);
  }

  if (request.method === "GET" || request.method === "DELETE") {
    return logResponse(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "MCP session ID is required" },
          id: null,
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
  }

  let sessionIdForCleanup: string | undefined;

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => {
      sessionIdForCleanup = id;
      logger.info(
        {
          event: "mcp_session_initialized",
          ...requestLog,
          createdSessionId: id,
        },
        "MCP session initialized",
      );
    },
    onsessionclosed: (id) => {
      sessions.delete(id);
      logger.info(
        { event: "mcp_session_closed", sessionId: id },
        "MCP session closed",
      );
    },
  });

  const server = await createServer();

  transport.onclose = () => {
    if (sessionIdForCleanup) {
      sessions.delete(sessionIdForCleanup);
      logger.info(
        { event: "mcp_transport_closed", sessionId: sessionIdForCleanup },
        "MCP transport closed",
      );
    }
  };

  await server.connect(transport);

  const response = await transport.handleRequest(request);

  if (sessionIdForCleanup) {
    sessions.set(sessionIdForCleanup, { server, transport });
  }

  return logResponse(response, sessionIdForCleanup);
}

export async function closeMcpHttpSessions(): Promise<void> {
  const currentSessions = [...sessions.entries()];
  sessions.clear();

  await Promise.allSettled(
    currentSessions.map(async ([sessionId, { server, transport }]) => {
      await transport.close();
      await server.close();
      logger.info({ sessionId }, "MCP HTTP session disposed");
    }),
  );
}
