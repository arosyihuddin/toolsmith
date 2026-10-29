const transport = process.env.MCP_TRANSPORT ?? "http";

if (transport !== "stdio" && transport !== "http" && transport !== "both") {
  throw new Error(
    `Invalid MCP_TRANSPORT: ${transport}. Expected stdio, http, or both.`,
  );
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  logLevel: process.env.LOG_LEVEL ?? "info",
  defaultCwd:
    process.env.TOOLSMITH_DEFAULT_CWD ?? process.env.OMP_DEFAULT_CWD ??
    (process.env.NODE_ENV === "development"
      ? process.cwd()
      : "/var/lib/omp-mcp/workspace"),
  transport,
  httpHost: process.env.MCP_HTTP_HOST ?? "127.0.0.1",
  httpPort: Number(process.env.MCP_HTTP_PORT ?? "48765"),
  httpPath: process.env.MCP_HTTP_PATH ?? "/mcp",
} as const;
