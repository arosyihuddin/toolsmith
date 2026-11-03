import { homedir } from "node:os";
import { resolve, relative, sep } from "node:path";

const MAX_BUFFER = 256 * 1024;
const TERMINAL_ROOT = resolve(process.env.TOOLSMITH_TERMINAL_ROOT ?? process.env.OMP_TERMINAL_ROOT ?? homedir());

export function workspaceCwd(input?: string) {
  const root = TERMINAL_ROOT;
  // Absolute workspace paths are intentional (for example, the filesystem root `/`).
  // Keep relative paths scoped to the configured terminal root for backwards compatibility.
  if (input?.startsWith("/")) return resolve(input);
  const target = resolve(root, input ?? ".");
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) {
    throw new Error("Terminal cwd is outside the terminal root");
  }
  return target;
}

export function safeWrite(terminal: Bun.Terminal, data: string) {
  try {
    terminal.write(data);
  } catch {}
}

export function trimOutputBuffer(text: string) {
  if (text.length <= MAX_BUFFER) return text;
  const start = text.length - MAX_BUFFER;
  const escape = text.indexOf("\x1b", start);
  return text.slice(escape >= 0 ? escape : start);
}
export function stripLeadingWhitespaceLine(text: string) {
  return text.replace(/^[ \t]+\r?\n/, "");
}

export function processEnv() {
  const env = { ...Bun.env };
  // Do not leak this Toolsmith server's own listener settings into interactive
  // shells. They would override a workspace's .env when launching Bun again.
  delete env.MCP_TRANSPORT;
  delete env.MCP_HTTP_HOST;
  delete env.MCP_HTTP_PORT;
  delete env.MCP_HTTP_PATH;
  return env;
}
