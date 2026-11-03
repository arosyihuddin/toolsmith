import { access, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

interface CommandOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

async function runCommand(command: string[], options: CommandOptions): Promise<string> {
  const binary = command[0];
  if (!binary || !Bun.which(binary)) {
    throw new Error(`${binary ?? "search command"} is not installed`);
  }

  const child = Bun.spawn(command, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    detached: process.platform !== "win32",
  });

  let aborted = false;
  let timedOut = false;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const terminate = (signal: "SIGTERM" | "SIGKILL") => {
    try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
    catch { try { child.kill(signal); } catch {} }
    if (signal === "SIGTERM") forceKillTimer ??= setTimeout(() => terminate("SIGKILL"), 1_000);
  };
  const abort = () => {
    aborted = true;
    terminate("SIGTERM");
  };
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    terminate("SIGTERM");
  }, options.timeoutMs);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    if (aborted) throw new Error("Search aborted");
    if (timedOut) throw new Error(`${binary} timed out after ${options.timeoutMs}ms`);
    if (exitCode !== 0) {
      const message = stderr.trim();
      throw new Error(message || `${binary} exited with code ${exitCode}`);
    }

    return stdout;
  } finally {
    clearTimeout(timeout);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    options.signal?.removeEventListener("abort", abort);
  }
}

async function ensurePath(path: string, cwd: string): Promise<void> {
  try {
    await access(path.startsWith("/") ? path : `${cwd}/${path}`);
  } catch {
    throw new Error(`Path not found: ${path}`);
  }
}

export interface FsFindInput {
  pattern?: string;
  path?: string;
  type?: "file" | "directory" | "both";
  hidden?: boolean;
  max_results?: number;
  max_depth?: number;
}

export interface FsGrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  hidden?: boolean;
  max_results?: number;
  max_depth?: number;
  fixed_strings?: boolean;
}

async function fsFindFallback(
  searchPath: string,
  cwd: string,
  input: FsFindInput,
  maxResults: number,
  signal?: AbortSignal,
): Promise<string[]> {
  const root = resolve(cwd, searchPath);
  const deadline = Date.now() + 10_000;
  let matcher: RegExp | null = null;
  if (input.pattern) {
    try { matcher = new RegExp(input.pattern, "i"); }
    catch { throw new Error("pattern must be a valid regular expression when fd is unavailable"); }
  }
  const results: string[] = [];
  async function walk(directory: string, depth: number): Promise<void> {
    if (signal?.aborted) throw new Error("Search aborted");
    if (Date.now() > deadline) throw new Error("Search timed out after 10000ms");
    if (results.length >= maxResults || (input.max_depth !== undefined && depth >= input.max_depth)) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && ["EACCES", "EPERM"].includes(String(error.code))) return;
      throw error;
    }
    for (const entry of entries) {
      if (signal?.aborted) throw new Error("Search aborted");
      if (Date.now() > deadline) throw new Error("Search timed out after 10000ms");
      if (results.length >= maxResults) break;
      if (!input.hidden && entry.name.startsWith(".")) continue;
      const fullPath = join(directory, entry.name);
      const isDirectory = entry.isDirectory();
      if (input.type === "file" && isDirectory) {
        if (input.max_depth === undefined || depth + 1 < input.max_depth) await walk(fullPath, depth + 1);
        continue;
      }
      if (input.type === "directory" && !isDirectory) continue;
      const matchPath = relative(root, fullPath);
      if (!matcher || matcher.test(entry.name) || matcher.test(matchPath)) results.push(fullPath);
      if (isDirectory && (input.max_depth === undefined || depth + 1 < input.max_depth)) await walk(fullPath, depth + 1);
    }
  }
  await walk(root, 0);
  return results;
}

export async function fsFind(
  input: FsFindInput,
  cwd: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const searchPath = input.path || cwd;
  await ensurePath(searchPath, cwd);

  const maxResults = Math.min(Math.max(Math.floor(input.max_results ?? 100), 1), 1000);
  if (input.max_depth !== undefined && (!Number.isInteger(input.max_depth) || input.max_depth < 0)) {
    throw new Error("max_depth must be a non-negative integer");
  }

  let results: string[];
  if (Bun.which("fd")) {
    const args = ["fd", "--color", "never", "--max-results", String(maxResults)];
    if (input.hidden) args.push("--hidden");
    if (input.type === "file") args.push("--type", "f");
    else if (input.type === "directory") args.push("--type", "d");
    if (input.max_depth !== undefined) args.push("--max-depth", String(input.max_depth));
    if (input.pattern) args.push(input.pattern);
    args.push(searchPath);
    const stdout = await runCommand(args, { cwd, signal, timeoutMs: 10_000 });
    results = stdout.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, maxResults);
  } else {
    results = await fsFindFallback(searchPath, cwd, input, maxResults, signal);
  }

  return {
    results,
    count: results.length,
    truncated: results.length >= maxResults,
  };
}

export async function fsGrep(
  input: FsGrepInput,
  cwd: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!input.pattern.trim()) throw new Error("pattern must be non-empty");

  const searchPath = input.path || cwd;
  await ensurePath(searchPath, cwd);

  const maxResults = Math.min(Math.max(Math.floor(input.max_results ?? 100), 1), 1000);
  const args = ["rg", "--color", "never", "--line-number", "--max-count", String(maxResults)];

  if (input.hidden) args.push("--hidden");
  if (input.fixed_strings) args.push("--fixed-strings");
  if (input.glob) args.push("--glob", input.glob);
  if (input.max_depth !== undefined) {
    if (!Number.isInteger(input.max_depth) || input.max_depth < 0) {
      throw new Error("max_depth must be a non-negative integer");
    }
    args.push("--max-depth", String(input.max_depth));
  }

  args.push(input.pattern, searchPath);

  const stdout = await runCommand(args, { cwd, signal, timeoutMs: 10_000 }).catch((error) => {
    if (error instanceof Error && error.message.includes("exited with code 1")) return "";
    throw error;
  });
  const matches = stdout.split("\n").filter(Boolean);

  return {
    matches,
    count: matches.length,
    truncated: matches.length >= maxResults,
  };
}
