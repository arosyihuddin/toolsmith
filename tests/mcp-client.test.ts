import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";

const root = new URL("../", import.meta.url).pathname;
const port = 3101;
const endpoint = `http://127.0.0.1:${port}/mcp`;

let serverProcess: ReturnType<typeof Bun.spawn>;

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(endpoint, { method: "GET" });
      if (response.status === 401) return;
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`MCP HTTP server did not start at ${endpoint}`);
}

async function createClient() {
  const client = new Client({
    name: "toolsmith-test-client",
    version: "0.1.0",
  });

  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { authorization: "Bearer test-toolsmith-token" } },
  });
  await client.connect(transport);

  return { client, transport };
}

beforeAll(async () => {
  serverProcess = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      TOOLSMITH_DEFAULT_CWD: root,
      MCP_TRANSPORT: "http",
      MCP_HTTP_HOST: "127.0.0.1",
      MCP_HTTP_PORT: String(port),
      MCP_HTTP_PATH: "/mcp",
      MCP_PUBLIC_URL: " ",
      TOOLSMITH_OAUTH_USERNAME: "",
      TOOLSMITH_OAUTH_PASSWORD: "",
      TOOLSMITH_API_TOKEN: "test-toolsmith-token",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForServer();
});

afterAll(() => {
  serverProcess.kill();
});

describe("MCP Streamable HTTP integration", () => {
  test("rejects missing and invalid Bearer tokens", async () => {
    const missing = await fetch(endpoint, { method: "GET" });
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");

    const invalid = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", params: {}, id: 1 }),
    });
    expect(invalid.status).toBe(401);
  });

  test("initializes and exposes native tools", async () => {
    const { client, transport } = await createClient();

    try {
      const result = await client.listTools();
      const names = result.tools.map((tool) => tool.name);

      expect(names).toContain("read");
      expect(names).toContain("bash");
      expect(names).toContain("write");
      expect(names).not.toContain("omp_read");
    } finally {
      await transport.close();
    }
  }, 30_000);

  test.skip("executes a native tool over HTTP (temporarily disabled)", async () => {
    const { client, transport } = await createClient();

    try {
      const result = await client.callTool({
        name: "read",
        arguments: { path: "package.json" },
      });

      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text?: string }> | undefined;
      expect(content?.some((item) => item.type === "text" && item.text?.includes("omp-mcp"))).toBe(true);
    } finally {
      await transport.close();
    }
  }, 30_000);


});
