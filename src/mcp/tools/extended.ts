import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../../lib/config";
import { registerExposedTool } from "./register";
import { errorMessage, errorResult, result } from "./shared";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const writeRisk = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;
const base = resolve(config.defaultCwd);
const stateDir = resolve(base, ".toolsmith");
function workspacePath(path = ".") {
  const target = resolve(base, path);
  if (target !== base && !target.startsWith(base + "/")) throw new Error("Path must stay inside the configured workspace.");
  return target;
}
function statePath(kind: string, sessionId?: string) {
  const key = createHash("sha256").update(sessionId || "default").digest("hex").slice(0, 24);
  return resolve(stateDir, kind + "-" + key + ".json");
}
async function readState<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw error; }
}
async function writeState(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}
function run(command: string, args: string[], cwd = base, timeoutMs = 15000, input?: string, signal?: AbortSignal) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolvePromise, reject) => {
    if (signal?.aborted) { reject(new Error("Command cancelled before start: " + command)); return; }
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32", env: process.env });
    const out: Buffer[] = []; const err: Buffer[] = []; let outSize = 0; let errSize = 0;
    const append = (target: Buffer[], chunk: Buffer, current: number, limit: number) => { const kept = chunk.subarray(0, Math.max(0, limit - current)); if (kept.length) target.push(kept); return current + kept.length; };
    child.stdout.on("data", (chunk: Buffer) => { outSize = append(out, chunk, outSize, 100_000); });
    child.stderr.on("data", (chunk: Buffer) => { errSize = append(err, chunk, errSize, 20_000); });
    let settled = false; let timedOut = false; let aborted = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = (sig: NodeJS.Signals) => {
      try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, sig); else child.kill(sig); }
      catch { try { child.kill(sig); } catch {} }
      if (sig === "SIGTERM") forceKillTimer ??= setTimeout(() => terminate("SIGKILL"), 500);
    };
    const abort = () => { aborted = true; terminate("SIGTERM"); };
    const cleanup = () => { clearTimeout(timer); if (forceKillTimer) clearTimeout(forceKillTimer); signal?.removeEventListener("abort", abort); };
    const timer = setTimeout(() => { timedOut = true; terminate("SIGTERM"); }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.once("error", (error) => { if (settled) return; settled = true; cleanup(); reject(error); });
    child.once("close", (code) => {
      if (settled) return; settled = true; cleanup();
      if (aborted) reject(new Error("Command cancelled: " + command));
      else if (timedOut) reject(new Error("Command timed out after " + timeoutMs + "ms: " + command));
      else resolvePromise({ code: code ?? 1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
    child.stdin.end(input);
  });
}

export function registerExtendedTools(server: McpServer) {
  registerExposedTool(server, "glob", {
    description: "Find workspace files matching a glob pattern such as src/**/*.ts.",
    inputSchema: { pattern: z.string().min(1), path: z.string().optional(), include_hidden: z.boolean().optional().default(false), max_results: z.number().int().min(1).max(1000).optional().default(200) },
    annotations: readOnly,
  }, async ({ pattern, path, include_hidden, max_results }) => {
    try {
      const root = workspacePath(path);
      const glob = new Bun.Glob(pattern);
      const matches: string[] = [];
      for await (const item of glob.scan({ cwd: root, onlyFiles: true, dot: include_hidden })) {
        matches.push(item);
        if (matches.length >= max_results) break;
      }
      return result({ pattern, path: root, matches, truncated: matches.length >= max_results });
    } catch (error) { return errorResult(errorMessage(error)); }
  });

  registerExposedTool(server, "eval", {
    description: "Execute a JavaScript or Python snippet in a child process. This is arbitrary code execution and is subject to Toolsmith permissions.",
    inputSchema: { code: z.string().min(1), language: z.enum(["javascript", "python"]).optional().default("javascript"), timeout_ms: z.number().int().min(100).max(30000).optional().default(10000) },
    annotations: { ...writeRisk, openWorldHint: true },
  }, async ({ code, language, timeout_ms }, extra) => {
    try {
      const response = language === "javascript"
        ? await run(process.execPath, ["-e", code], base, timeout_ms, undefined, extra.signal)
        : await run("python3", ["-c", code], base, timeout_ms, undefined, extra.signal);
      return result({ language, exit_code: response.code, stdout: response.stdout, stderr: response.stderr });
    } catch (error) { return errorResult(errorMessage(error)); }
  });

  registerExposedTool(server, "context_notes", {
    description: "Read or replace persistent notes scoped to the current MCP session.",
    inputSchema: { action: z.enum(["read", "replace", "append"]), text: z.string().optional() },
    annotations: writeRisk,
  }, async ({ action, text }, extra) => {
    try {
      const path = statePath("context-notes", extra.sessionId);
      const current = await readState<{ text: string; updated_at: string | null }>(path, { text: "", updated_at: null });
      if (action === "read") return result(current);
      if (typeof text !== "string") return errorResult("'text' is required for replace/append.");
      const next = { text: action === "replace" ? text : [current.text, text].filter(Boolean).join("\n"), updated_at: new Date().toISOString() };
      if (Buffer.byteLength(next.text, "utf8") > 16_384) return errorResult("Context notes exceed the 16 KiB limit.");
      await writeState(path, next);
      return result({ ...next, path });
    } catch (error) { return errorResult(errorMessage(error)); }
  });

  registerExposedTool(server, "todo", {
    description: "Manage a persistent task list scoped to the current MCP session.",
    inputSchema: { action: z.enum(["list", "add", "update", "remove", "clear"]), id: z.string().optional(), title: z.string().optional(), status: z.enum(["pending", "in_progress", "completed"]).optional() },
    annotations: writeRisk,
  }, async ({ action, id, title, status }, extra) => {
    try {
      const path = statePath("todo", extra.sessionId);
      const items = await readState<Array<{ id: string; title: string; status: "pending" | "in_progress" | "completed"; created_at: string; updated_at: string }>>(path, []);
      if (action === "list") return result({ items });
      if (action === "clear") { await writeState(path, []); return result({ items: [] }); }
      if (action === "add") {
        if (!title?.trim()) return errorResult("'title' is required.");
        const item = { id: crypto.randomUUID(), title: title.trim().slice(0, 500), status: status ?? "pending" as const, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        items.push(item); await writeState(path, items); return result({ item, items });
      }
      const index = items.findIndex(item => item.id === id);
      if (index < 0) return errorResult("Todo item not found.");
      if (action === "remove") items.splice(index, 1);
      else {
        if (title !== undefined) items[index]!.title = title.trim().slice(0, 500);
        if (status !== undefined) items[index]!.status = status;
        items[index]!.updated_at = new Date().toISOString();
      }
      await writeState(path, items); return result({ items });
    } catch (error) { return errorResult(errorMessage(error)); }
  });

  registerExposedTool(server, "wait", {
    description: "Wait for a bounded duration; managed background-job polling is not yet supported.",
    inputSchema: { duration_ms: z.number().int().min(0).max(30000).optional().default(1000), process_id: z.number().int().positive().optional() },
    annotations: readOnly,
  }, async ({ duration_ms, process_id }, extra) => {
    if (extra.signal?.aborted) return errorResult("Wait cancelled.");
    if (process_id !== undefined) return errorResult("Polling arbitrary process IDs is not supported; use a managed job handle.");
    await new Promise<void>((resolvePromise, reject) => {
      const cleanup = () => extra.signal?.removeEventListener("abort", abort);
      const timer = setTimeout(() => { cleanup(); resolvePromise(); }, duration_ms);
      const abort = () => { clearTimeout(timer); cleanup(); reject(new Error("Wait cancelled.")); };
      extra.signal?.addEventListener("abort", abort, { once: true });
    }).catch(error => { throw error; });
    return result({ waited_ms: duration_ms });
  });



  registerExposedTool(server, "ast_grep", {
    description: "Search source code using ast-grep structural patterns. Requires the ast-grep CLI (ast-grep or sg) on PATH.",
    inputSchema: { pattern: z.string().min(1), path: z.string().optional(), language: z.string().optional(), max_results: z.number().int().min(1).max(500).optional().default(100) },
    annotations: readOnly,
  }, async ({ pattern, path, language, max_results }, extra) => {
    try {
      const args = ["run", "--pattern", pattern, "--json=compact", "--color", "never"];
      if (language) args.push("--lang", language);
      args.push(workspacePath(path));
      let output;
      try { output = await run("ast-grep", args, base, 15000, undefined, extra.signal); }
      catch (error) { if (!String(error).includes("ENOENT")) throw error; output = await run("sg", args, base, 15000, undefined, extra.signal); }
      if (output.code !== 0) return errorResult(output.stderr || output.stdout || "ast-grep failed.");
      let matches: unknown = output.stdout;
      try { const parsed = JSON.parse(output.stdout); matches = Array.isArray(parsed) ? parsed.slice(0, max_results) : parsed; } catch {}
      return result({ pattern, matches, truncated: output.stdout.length >= 100_000 });
    } catch (error) { return errorResult("ast_grep unavailable or failed: " + errorMessage(error)); }
  });

  registerExposedTool(server, "ast_edit", {
    description: "Apply ast-grep structural rewrites to workspace files. Requires ast-grep CLI; use dry_run first to preview.",
    inputSchema: { pattern: z.string().min(1), rewrite: z.string().min(1), path: z.string().optional(), language: z.string().optional(), dry_run: z.boolean().optional().default(true) },
    annotations: writeRisk,
  }, async ({ pattern, rewrite, path, language, dry_run }, extra) => {
    try {
      const args = ["run", "--pattern", pattern, "--rewrite", rewrite];
      if (language) args.push("--lang", language);
      if (dry_run) args.push("--json=compact");
      else args.push("--update-all");
      let output;
      try { output = await run("ast-grep", args, base, 15000); }
      catch (error) { if (!String(error).includes("ENOENT")) throw error; output = await run("sg", args, base, 15000); }
      if (output.code !== 0) return errorResult(output.stderr || output.stdout || "ast-grep rewrite failed.");
      return result({ dry_run, output: output.stdout, stderr: output.stderr, note: dry_run ? "Preview only; no file changes were requested." : "Review the diff and run tests after rewriting." });
    } catch (error) { return errorResult("ast_edit unavailable or failed: " + errorMessage(error)); }
  });

  registerExposedTool(server, "github", {
    description: "Use the GitHub CLI for repository, issue, pull request, search, and workflow operations.",
    inputSchema: {
      operation: z.enum(["repo_view", "issue_list", "pr_list", "pr_view", "pr_diff", "search_repos", "search_issues", "search_prs", "search_code", "workflow_runs", "auth_status"]),
      repo: z.string().optional(), query: z.string().optional(), number: z.number().int().positive().optional(), limit: z.number().int().min(1).max(50).optional().default(10),
    },
    annotations: { ...readOnly, openWorldHint: true },
  }, async ({ operation, repo, query, number, limit }, extra) => {
    try {
      const args: string[] = [];
      const target = repo ? ["-R", repo] : [];
      switch (operation) {
        case "repo_view": args.push("repo", "view", ...target, "--json", "name,description,url,defaultBranchRef,visibility"); break;
        case "issue_list": args.push("issue", "list", ...target, "--limit", String(limit), "--json", "number,title,state,url,labels"); break;
        case "pr_list": args.push("pr", "list", ...target, "--limit", String(limit), "--json", "number,title,state,url,headRefName,baseRefName"); break;
        case "pr_view": if (!number) return errorResult("'number' is required."); args.push("pr", "view", String(number), ...target, "--json", "number,title,state,url,body,headRefName,baseRefName"); break;
        case "pr_diff": if (!number) return errorResult("'number' is required."); args.push("pr", "diff", String(number), ...target); break;
        case "search_repos": if (!query) return errorResult("'query' is required."); args.push("search", "repos", query, "--limit", String(limit), "--json", "fullName,description,url,stargazersCount"); break;
        case "search_issues": if (!query) return errorResult("'query' is required."); args.push("search", "issues", query, "--limit", String(limit), "--json", "number,title,state,url,repository"); break;
        case "search_prs": if (!query) return errorResult("'query' is required."); args.push("search", "prs", query, "--limit", String(limit), "--json", "number,title,state,url,repository"); break;
        case "search_code": if (!query) return errorResult("'query' is required."); args.push("search", "code", query, "--limit", String(limit), "--json", "path,repository,textMatches"); break;
        case "workflow_runs": args.push("run", "list", ...target, "--limit", String(limit), "--json", "databaseId,name,status,conclusion,url,createdAt,headBranch"); break;
        case "auth_status": args.push("auth", "status"); break;
      }
      const output = await run("gh", args, base, 20000, undefined, extra.signal);
      if (output.code !== 0) return errorResult(output.stderr || output.stdout || "gh exited with code " + output.code);
      return result({ operation, output: output.stdout, stderr: output.stderr });
    } catch (error) { return errorResult("GitHub CLI failed: " + errorMessage(error)); }
  });
}
