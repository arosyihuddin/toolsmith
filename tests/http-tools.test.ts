import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";

const root = new URL("../", import.meta.url).pathname;
const port = 3102;
const endpoint = `http://127.0.0.1:${port}/mcp`;

let serverProcess: ReturnType<typeof Bun.spawn>;

const filesystemTools = ["fs_find", "fs_grep"] as const;

const computerTools = [
  "window_list",
  "window_active",
  "window_focus",
  "window_close",
  "window_move",
  "app_list",
  "mouse_move",
  "mouse_click",
  "mouse_drag",
  "mouse_scroll",
  "keyboard_press",
  "keyboard_hotkey",
  "keyboard_type",
  "screenshot",
] as const;

const systemTools = ["system_info", "hardware_info", "capabilities"] as const;
const controlTools = ["sudo_exec"] as const;

const tunnelTools = ["tunnel_list", "tunnel_status", "tunnel_start", "tunnel_stop"] as const;

const nativeTools = ["read", "write", "edit", "bash", "find", "grep"] as const;
const compatTools = ["glob", "eval", "context_notes", "wait", "todo", "ast_grep", "ast_edit", "github"] as const;

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
    name: "toolsmith-http-tools-test",
    version: "0.1.0",
  });

  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { authorization: "Bearer test-toolsmith-token" } },
  });
  await client.connect(transport);

  return { client, transport };
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) {
  return client.callTool({ name, arguments: args });
}

async function callToolWithApproval(client: Client, name: string, args: Record<string, unknown>, decision: "approve" | "deny" = "approve") {
  const pendingCall = callTool(client, name, args);
  for (let attempt = 0; attempt < 120; attempt++) {
    const response = await fetch("http://127.0.0.1:" + port + "/api/approvals", {
      headers: { authorization: "Bearer test-toolsmith-token" },
    });
    if (response.ok) {
      const body = await response.json() as { approvals?: Array<{ id: string; tool: string; status: string }> };
      const approval = body.approvals?.find((item) => item.tool === name && item.status === "pending");
      if (approval) {
        await fetch("http://127.0.0.1:" + port + "/api/approvals/" + approval.id + "/" + decision, {
          method: "POST",
          headers: { authorization: "Bearer test-toolsmith-token" },
        });
        break;
      }
    }
    await Bun.sleep(25);
  }
  return pendingCall;
}

beforeAll(async () => {
  serverProcess = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      MCP_TRANSPORT: "http",
      TOOLSMITH_DEFAULT_CWD: root,
      MCP_HTTP_HOST: "127.0.0.1",
      MCP_HTTP_PORT: String(port),
      MCP_HTTP_PATH: "/mcp",
      TOOLSMITH_API_TOKEN: "test-toolsmith-token",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForServer();
});

afterAll(async () => {
  serverProcess.kill("SIGTERM");
  const exited = await Promise.race([serverProcess.exited.then(() => true), Bun.sleep(2_000).then(() => false)]);
  if (!exited && serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
  await serverProcess.exited;
});

describe("MCP Streamable HTTP tool coverage", () => {
  test("exposes every expected MCP and core tool", async () => {
    const { client, transport } = await createClient();

    try {
      const result = await client.listTools();
      const names = new Set(result.tools.map((tool) => tool.name));
      const expected = [...filesystemTools, ...computerTools, ...systemTools, ...tunnelTools, ...nativeTools, ...controlTools, ...compatTools];

      expect(result.tools).toHaveLength(expected.length);

      for (const name of expected) {
        expect(names.has(name)).toBe(true);
      }

      expect(names.size).toBe(expected.length);

      for (const name of ["omp_run", "omp_collab", "omp_status", "omp_result", "omp_resume", "omp_interrupt", "omp_dispose", "omp_list"]) {
        expect(names.has(name)).toBe(false);
      }
    } finally {
      await transport.close();
    }
  }, 30_000);

  test("executes representative Toolsmith tools over HTTP with isolated approvals", async () => {
    const { client, transport } = await createClient();

    try {
      const read = await callTool(client, "read", { path: "package.json" });
      expect(read.isError).not.toBe(true);

      const readContent = read.content as Array<{ type: string; text?: string }> | undefined;
      expect(readContent?.some((item) => item.text?.includes("package.json"))).toBe(true);

      const fsFind = await callTool(client, "fs_find", { pattern: "package.json", path: root });
      expect(fsFind.isError).not.toBe(true);

      const fsGrep = await callTool(client, "fs_grep", { pattern: "omp-mcp", path: root, glob: "package.json" });
      expect(fsGrep.isError).not.toBe(true);

      const liteFind = await callTool(client, "find", { pattern: "package.json", path: ".", type: "file", max_results: 10 });
      expect(liteFind.isError).not.toBe(true);

      const liteGrep = await callTool(client, "grep", { pattern: "\"name\"", path: "package.json", max_results: 10 });
      expect(liteGrep.isError).not.toBe(true);

      const testFile = ".test-data/toolsmith-write-edit-test.txt";
      const write = await callToolWithApproval(client, "write", { path: testFile, content: "toolsmith-before" });
      expect(write.isError).not.toBe(true);
      const edit = await callToolWithApproval(client, "edit", { path: testFile, old_text: "toolsmith-before", new_text: "toolsmith-after" });
      expect(edit.isError).not.toBe(true);
      const edited = await callTool(client, "read", { path: testFile });
      const editedContent = edited.content as Array<{ type: string; text?: string }> | undefined;
      expect(edited.isError).not.toBe(true);
      expect(editedContent?.some((item) => item.text?.includes("toolsmith-after"))).toBe(true);

      const bash = await callToolWithApproval(client, "bash", {
        command: "printf MCP_HTTP_BASH_OK",
      });
      expect(bash.isError).not.toBe(true);

      const bashContent = bash.content as Array<{ type: string; text?: string }> | undefined;
      expect(bashContent?.some((item) => item.text?.includes("MCP_HTTP_BASH_OK"))).toBe(true);

      const timedCommand = await callToolWithApproval(client, "bash", { command: "sleep 10", timeout_ms: 100 });
      const timedContent = timedCommand.content as Array<{ type: string; text?: string }> | undefined;
      expect(timedCommand.isError).not.toBe(true);
      expect(timedContent?.some((item) => /"timed_out"\s*:\s*true/.test(item.text ?? ""))).toBe(true);

      const denied = await callToolWithApproval(client, "bash", { command: "printf SHOULD_NOT_RUN" }, "deny");
      expect(denied.isError).toBe(true);
      expect((denied.content as Array<{ text?: string }>).some((item) => item.text?.includes("SHOULD_NOT_RUN"))).toBe(false);
    } finally {
      await transport.close();
    }
  }, 30_000);



  test("executes compatibility tools with bounded state and subprocesses", async () => {
    const { client, transport } = await createClient();
    try {
      const glob = await callTool(client, "glob", { pattern: "package.json", max_results: 5 });
      expect(glob.isError).not.toBe(true);
      expect((glob.content as Array<{ text?: string }>).some((item) => item.text?.includes("package.json"))).toBe(true);

      const evaluated = await callToolWithApproval(client, "eval", { code: "console.log('EVAL_OK')", language: "javascript", timeout_ms: 3000 });
      expect(evaluated.isError).not.toBe(true);
      expect((evaluated.content as Array<{ text?: string }>).some((item) => item.text?.includes("EVAL_OK"))).toBe(true);

      const notes = await callToolWithApproval(client, "context_notes", { action: "replace", text: "compat-test-note" });
      expect(notes.isError).not.toBe(true);
      const readNotes = await callToolWithApproval(client, "context_notes", { action: "read" });
      expect((readNotes.content as Array<{ text?: string }>).some((item) => item.text?.includes("compat-test-note"))).toBe(true);

      const todo = await callToolWithApproval(client, "todo", { action: "add", title: "compat-test-task" });
      expect(todo.isError).not.toBe(true);
      const listed = await callToolWithApproval(client, "todo", { action: "list" });
      expect((listed.content as Array<{ text?: string }>).some((item) => item.text?.includes("compat-test-task"))).toBe(true);

      const waited = await callTool(client, "wait", { duration_ms: 20 });
      expect(waited.isError).not.toBe(true);
      const github = await callTool(client, "github", { operation: "auth_status" });
      expect(github.isError).not.toBe(true);
      const astMatches = await callTool(client, "ast_grep", { pattern: "registerExposedTool($A, $B, $$$REST)", path: "src/mcp/tools", language: "ts", max_results: 3 });
      expect(astMatches.isError).not.toBe(true);
      expect((astMatches.content as Array<{ text?: string }>).some((item) => item.text?.includes("registerExposedTool"))).toBe(true);

      const astPreview = await callToolWithApproval(client, "ast_edit", { pattern: "registerExposedTool($A, $B, $$$REST)", rewrite: "PREVIEW_ONLY", path: "src/mcp/tools", language: "ts", dry_run: true });
      expect(astPreview.isError).not.toBe(true);
      expect((astPreview.content as Array<{ text?: string }>).some((item) => item.text?.includes("Preview only"))).toBe(true);

    } finally {
      await transport.close();
    }
  }, 30_000);


  test("all native tools expose an MCP input schema", async () => {
    const { client, transport } = await createClient();

    try {
      const result = await client.listTools();
      const toolsByName = new Map(result.tools.map((tool) => [tool.name, tool]));

      for (const name of nativeTools) {
        const tool = toolsByName.get(name);
        expect(tool).toBeDefined();
        expect(tool?.inputSchema).toBeDefined();
        expect(tool?.inputSchema.type).toBe("object");
      }
    } finally {
      await transport.close();
    }
  }, 30_000);
});
