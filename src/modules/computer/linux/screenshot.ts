import { readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function run(command: string, args: string[] = []) {
  const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

function tempPath() {
  return path.join(os.tmpdir(), `toolsmith-screenshot-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
}

export async function takeLinuxScreenshot(outputPath?: string) {
  const target = outputPath ?? tempPath();
  const commands: [string, string[]][] = [
    ["grim", [target]],
    ["gnome-screenshot", ["-f", target]],
    ["scrot", [target]],
    ["import", ["-window", "root", target]],
  ];

  let lastError = "No supported screenshot command found";
  for (const [command, args] of commands) {
    try {
      const result = await run(command, args);
      if (result.code === 0) {
        const bytes = await readFile(target);
        if (!outputPath) await unlink(target).catch(() => undefined);
        return {
          mime_type: "image/png",
          size_bytes: bytes.byteLength,
          path: outputPath ?? null,
          data_base64: bytes.toString("base64"),
        };
      }
      lastError = result.stderr || `${command} failed`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError);
}