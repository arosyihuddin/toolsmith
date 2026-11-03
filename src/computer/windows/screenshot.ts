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

export async function takeWindowsScreenshot(outputPath?: string) {
  const target = outputPath ?? tempPath();
  const script = `$bmp = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Location,[System.Drawing.Point]::Empty,$bmp.Size); $bmp.Save('${target.replaceAll("'", "''")}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()`;
  const result = await run("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-STA", "-Command",
    "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; " + script,
  ]);
  if (result.code !== 0) throw new Error(result.stderr || "PowerShell screenshot failed");
  const bytes = await readFile(target);
  if (!outputPath) await unlink(target).catch(() => undefined);
  return {
    mime_type: "image/png",
    size_bytes: bytes.byteLength,
    path: outputPath ?? null,
    data_base64: bytes.toString("base64"),
  };
}