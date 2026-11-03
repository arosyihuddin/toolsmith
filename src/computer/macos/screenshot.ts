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

export async function takeMacScreenshot(outputPath?: string) {
  const target = outputPath ?? tempPath();
  const result = await run("screencapture", ["-x", target]);
  if (result.code !== 0) throw new Error(result.stderr || "screencapture failed");
  const bytes = await readFile(target);
  if (!outputPath) await unlink(target).catch(() => undefined);
  return {
    mime_type: "image/png",
    size_bytes: bytes.byteLength,
    path: outputPath ?? null,
    data_base64: bytes.toString("base64"),
  };
}