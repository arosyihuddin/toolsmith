import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fsFind, fsGrep } from "../../filesystem/search";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerExposedTool } from "./register";
import { config } from "../../lib/config";
import { errorMessage, errorResult, result } from "./shared";

const safeRead = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const workspacePath = (input?: string) => {
  const base = resolve(config.defaultCwd);
  const target = resolve(base, input || ".");
  return target;
};

export function registerCoreTools(server: McpServer) {
  registerExposedTool(
    server,
    "read",
    {
      description: "Read a UTF-8 text file by path.",
      inputSchema: {
        path: z.string().min(1),
        start_line: z.number().int().min(1).optional(),
        end_line: z.number().int().min(1).optional(),
      },
      annotations: safeRead,
    },
    async ({ path, start_line, end_line }) => {
      try {
        const text = await readFile(workspacePath(path), "utf8");
        const lines = text.split("\n");
        const start = Math.max(1, Number(start_line ?? 1));
        const end = Math.min(lines.length, Number(end_line ?? lines.length));
        return result({
          path,
          start_line: start,
          end_line: end,
          total_lines: lines.length,
          content: lines.slice(start - 1, end).join("\n"),
        });
      } catch (error) {
        return errorResult(errorMessage(error));
      }
    },
  );

  registerExposedTool(
    server,
    "write",
    {
      description:
        "Write UTF-8 text to a file by path. Creates parent directories.",
      inputSchema: { path: z.string().min(1), content: z.string() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ path, content }) => {
      try {
        const target = workspacePath(path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
        return result({ path, bytes_written: Buffer.byteLength(content) });
      } catch (error) {
        return errorResult(errorMessage(error));
      }
    },
  );

  registerExposedTool(
    server,
    "bash",
    {
      description:
        "Run a shell command in the configured workspace. Subject to Toolsmith permission and approval policies.",
      inputSchema: {
        command: z.string().min(1),
        timeout_ms: z
          .number()
          .int()
          .min(100)
          .max(120000)
          .optional()
          .default(30000),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ command, timeout_ms }, extra) => {
      if (extra.signal?.aborted)
        return errorResult("Command aborted before start.");
      let proc: ReturnType<typeof spawn> | undefined;
      let timedOut = false;
      let aborted = false;
      let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const appendCapped = (
        target: Buffer[],
        chunk: Buffer,
        current: number,
        limit: number,
      ) => {
        if (current >= limit) return current;
        const kept = chunk.subarray(0, limit - current);
        if (kept.length) target.push(kept);
        return current + kept.length;
      };
      const terminate = (signal: NodeJS.Signals) => {
        if (!proc) return;
        try {
          if (process.platform !== "win32" && proc.pid)
            process.kill(-proc.pid, signal);
          else proc.kill(signal);
        } catch {
          try {
            proc.kill(signal);
          } catch {}
        }
        if (signal === "SIGTERM") {
          forceKillTimer ??= setTimeout(() => terminate("SIGKILL"), 1_000);
        }
      };
      const abort = () => {
        aborted = true;
        terminate("SIGTERM");
      };
      try {
        if (extra.signal?.aborted)
          return errorResult("Command aborted before start.");
        proc = spawn("bash", ["-lc", command], {
          cwd: workspacePath(),
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        });
        proc.stdout?.on("data", (chunk: Buffer) => {
          stdoutBytes = appendCapped(stdout, chunk, stdoutBytes, 50_000);
        });
        proc.stderr?.on("data", (chunk: Buffer) => {
          stderrBytes = appendCapped(stderr, chunk, stderrBytes, 20_000);
        });
        extra.signal?.addEventListener("abort", abort, { once: true });
        if (extra.signal?.aborted) abort();
        timeout = setTimeout(() => {
          timedOut = true;
          terminate("SIGTERM");
        }, Number(timeout_ms));
        const exitCode = await new Promise<number>((resolveExit, reject) => {
          proc!.once("error", reject);
          proc!.once("close", (code) => resolveExit(code ?? 1));
        });
        return aborted
          ? errorResult("Command aborted.")
          : result({
              exit_code: exitCode,
              timed_out: timedOut,
              aborted: false,
              stdout: Buffer.concat(stdout).toString("utf8"),
              stderr: Buffer.concat(stderr).toString("utf8"),
              output_truncated: stdoutBytes >= 50_000 || stderrBytes >= 20_000,
            });
      } catch (error) {
        terminate("SIGTERM");
        return errorResult(errorMessage(error));
      } finally {
        if (timeout) clearTimeout(timeout);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        extra.signal?.removeEventListener("abort", abort);
      }
    },
  );

  registerExposedTool(
    server,
    "find",
    {
      description: "Find files and directories from the supplied path.",
      inputSchema: {
        pattern: z.string().optional(),
        path: z.string().min(1).optional(),
        type: z.enum(["file", "directory", "both"]).optional().default("both"),
        hidden: z.boolean().optional().default(false),
        max_results: z.number().int().min(1).max(1000).optional().default(100),
        max_depth: z.number().int().min(0).optional(),
      },
      annotations: safeRead,
    },
    async ({ pattern, path, type, hidden, max_results, max_depth }, extra) => {
      try {
        return result(
          await fsFind(
            { pattern, path, type, hidden, max_results, max_depth },
            config.defaultCwd,
            extra.signal,
          ),
        );
      } catch (error) {
        return errorResult(errorMessage(error));
      }
    },
  );

  registerExposedTool(
    server,
    "grep",
    {
      description: "Search file contents from the supplied path using ripgrep.",
      inputSchema: {
        pattern: z.string().min(1),
        path: z.string().min(1).optional(),
        glob: z.string().min(1).optional(),
        hidden: z.boolean().optional().default(false),
        max_results: z.number().int().min(1).max(1000).optional().default(100),
        max_depth: z.number().int().min(0).optional(),
        fixed_strings: z.boolean().optional().default(false),
      },
      annotations: safeRead,
    },
    async (
      { pattern, path, glob, hidden, max_results, max_depth, fixed_strings },
      extra,
    ) => {
      try {
        return result(
          await fsGrep(
            {
              pattern,
              path,
              glob,
              hidden,
              max_results,
              max_depth,
              fixed_strings,
            },
            config.defaultCwd,
            extra.signal,
          ),
        );
      } catch (error) {
        return errorResult(errorMessage(error));
      }
    },
  );

  registerExposedTool(
    server,
    "edit",
    {
      description: "Replace one exact text occurrence in a workspace file.",
      inputSchema: {
        path: z.string().min(1),
        old_text: z.string().min(1),
        new_text: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ path, old_text, new_text }) => {
      try {
        const target = workspacePath(path);
        const text = await readFile(target, "utf8");
        const first = text.indexOf(old_text);
        if (first < 0) throw new Error("old_text was not found in the file.");
        if (text.indexOf(old_text, first + old_text.length) >= 0)
          throw new Error(
            "old_text occurs more than once; use a more specific match.",
          );
        await writeFile(
          target,
          text.slice(0, first) + new_text + text.slice(first + old_text.length),
          "utf8",
        );
        return result({ path, replaced: true });
      } catch (error) {
        return errorResult(errorMessage(error));
      }
    },
  );
}
