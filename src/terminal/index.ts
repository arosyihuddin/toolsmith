import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolve, relative, sep } from "node:path";

export type TerminalStatus = "running" | "exited";
export type TerminalScope = "general" | "project";

export type TerminalInfo = {
  id: string;
  title: string;
  cwd: string;
  scope: TerminalScope;
  workspaceRoot?: string;
  status: TerminalStatus;
  createdAt: string;
  updatedAt: string;
  exitCode?: number;
};

type TerminalRecord = TerminalInfo & {
  process: ReturnType<typeof Bun.spawn>;
  pty: Bun.Terminal;
  clients: Set<Bun.ServerWebSocket<{ terminalId: string }>>;
  output: string;
};

const MAX_BUFFER = 256 * 1024;
const TERMINAL_ROOT = resolve(process.env.TOOLSMITH_TERMINAL_ROOT ?? process.env.OMP_TERMINAL_ROOT ?? homedir());

function workspaceCwd(input?: string) {
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

function safeWrite(terminal: Bun.Terminal, data: string) {
  try {
    terminal.write(data);
  } catch {}
}

function trimOutputBuffer(text: string) {
  if (text.length <= MAX_BUFFER) return text;
  const start = text.length - MAX_BUFFER;
  const escape = text.indexOf("\x1b", start);
  return text.slice(escape >= 0 ? escape : start);
}
function stripLeadingWhitespaceLine(text: string) {
  return text.replace(/^[ \t]+\r?\n/, "");
}

class TerminalManager {
  private terminals = new Map<string, TerminalRecord>();

  list(scope?: TerminalScope, workspaceRoot?: string): TerminalInfo[] {
    const normalizedRoot = workspaceRoot === undefined ? undefined : workspaceCwd(workspaceRoot);
    return [...this.terminals.values()]
      .filter((terminal) => scope === undefined || terminal.scope === scope)
      .filter((terminal) => normalizedRoot === undefined || terminal.workspaceRoot === normalizedRoot)
      .map(
        ({ process: _process, clients: _clients, output: _output, ...info }) =>
          info,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string) {
    const terminal = this.terminals.get(id);
    if (!terminal) return undefined;
    const {
      process: _process,
      clients: _clients,
      output: _output,
      ...info
    } = terminal;
    return info;
  }

  create(cwd?: string, title?: string, scope: TerminalScope = "general", workspaceRoot?: string) {
    const target = workspaceCwd(cwd);
    const root = scope === "project" ? workspaceCwd(workspaceRoot) : undefined;
    if (scope === "project" && root) {
      const rel = relative(root, target);
      if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) {
        throw new Error("Project terminal cwd must stay inside its workspace root");
      }
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const decoder = new TextDecoder();
    let record: TerminalRecord | undefined;
    const env = processEnv();
    const shell = env.SHELL?.trim() || "/bin/sh";
    const process = Bun.spawn([shell, "-i"], {
      cwd: target,
      env: {
        ...env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
      detached: true,
      terminal: {
        cols: 120,
        rows: 30,
        data: (_pty, data) => {
          const text = decoder.decode(data, { stream: true });
          if (!record || !text) return;

          // Terminal output must be forwarded immediately, including escape-sequence
          // queries that may not contain a newline. Buffering startup output until a
          // newline can prevent xterm.js from seeing Fish's DA1 query in time; this
          // becomes especially visible when the WebSocket crosses a network tunnel.
          this.broadcast(record, text);
        },
      },
    });

    const terminal: TerminalRecord = {
      id,
      title: title?.trim() || `Terminal ${this.terminals.size + 1}`,
      cwd: target,
      scope,
      ...(root ? { workspaceRoot: root } : {}),
      status: "running",
      createdAt: now,
      updatedAt: now,
      process,
      pty: process.terminal!,
      clients: new Set(),
      output: "",
    };

    this.terminals.set(id, terminal);
    record = terminal;
    void this.watchExit(terminal);
    return this.get(id)!;
  }

  attach(ws: Bun.ServerWebSocket<{ terminalId: string }>, id: string) {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      ws.send(JSON.stringify({ type: "error", message: "Unknown terminal" }));
      ws.close(1008, "Unknown terminal");
      return;
    }
    terminal.clients.add(ws);
    ws.send(
      JSON.stringify({
        type: "snapshot",
        terminal: this.get(id),
        output: stripLeadingWhitespaceLine(terminal.output),
      }),
    );
  }

  detach(ws: Bun.ServerWebSocket<{ terminalId: string }>) {
    const terminal = this.terminals.get(ws.data.terminalId);
    terminal?.clients.delete(ws);
  }

  input(id: string, data: string) {
    const terminal = this.terminals.get(id);
    if (!terminal || terminal.status !== "running") return false;
    safeWrite(terminal.pty, data);
    return true;
  }

  resize(id: string, cols: number, rows: number) {
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 20 ||
      cols > 300 ||
      rows < 5 ||
      rows > 100
    ) {
      return false;
    }
    const terminal = this.terminals.get(id);
    if (!terminal || terminal.status !== "running") return false;
    try {
      terminal.pty.resize(cols, rows);
    } catch {
      return false;
    }
    return true;
  }

  dispose(id: string) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    try {
      terminal.pty.close();
    } catch {}
    this.signalProcessGroup(terminal, "SIGTERM");
    this.terminals.delete(id);
    for (const client of terminal.clients) {
      try {
        client.close(1000, "Terminal disposed");
      } catch {}
    }
    terminal.clients.clear();
    return true;
  }

  async disposeAll(gracePeriodMs = 2_000) {
    const terminals = [...this.terminals.values()];
    if (terminals.length === 0) return;

    for (const terminal of terminals) this.dispose(terminal.id);

    const exited = Promise.all(terminals.map((terminal) => terminal.process.exited.then(() => undefined, () => undefined)));
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise<boolean>((resolve) => {
        graceTimer = setTimeout(() => resolve(false), gracePeriodMs);
      }),
    ]);
    if (graceTimer) clearTimeout(graceTimer);

    if (!graceful) {
      for (const terminal of terminals) {
        if (terminal.process.exitCode !== null) continue;
        this.signalProcessGroup(terminal, "SIGKILL");
      }
    }

    await Promise.all(terminals.map((terminal) => terminal.process.exited.then(() => undefined, () => undefined)));
  }

  private signalProcessGroup(terminal: TerminalRecord, signal: NodeJS.Signals) {
    const pid = terminal.process.pid;
    if (pid === undefined) return;
    try {
      process.kill(-pid, signal);
    } catch {
      try { terminal.process.kill(signal); } catch {}
    }
  }

  private async watchExit(terminal: TerminalRecord) {
    const exitCode = await terminal.process.exited;
    if (!this.terminals.has(terminal.id)) return;
    terminal.status = "exited";
    terminal.exitCode = exitCode;
    terminal.updatedAt = new Date().toISOString();
    this.broadcast(terminal, `\r\n[process exited with code ${exitCode}]\r\n`);
    this.broadcastJson(terminal, { type: "exit", exitCode });
  }

  private broadcast(terminal: TerminalRecord, text: string) {
    terminal.output = trimOutputBuffer(terminal.output + text);
    terminal.updatedAt = new Date().toISOString();
    for (const client of terminal.clients) {
      try {
        client.send(JSON.stringify({ type: "output", data: text }));
      } catch {
        terminal.clients.delete(client);
      }
    }
  }

  private broadcastJson(
    terminal: TerminalRecord,
    message: Record<string, unknown>,
  ) {
    for (const client of terminal.clients) {
      try {
        client.send(JSON.stringify(message));
      } catch {
        terminal.clients.delete(client);
      }
    }
  }
}

function processEnv() {
  const env = { ...Bun.env };
  // Do not leak this Toolsmith server's own listener settings into interactive
  // shells. They would override a workspace's .env when launching Bun again.
  delete env.MCP_TRANSPORT;
  delete env.MCP_HTTP_HOST;
  delete env.MCP_HTTP_PORT;
  delete env.MCP_HTTP_PATH;
  return env;
}

export const terminalManager = new TerminalManager();
