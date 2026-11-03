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

export type TerminalRecord = TerminalInfo & {
  process: ReturnType<typeof Bun.spawn>;
  pty: Bun.Terminal;
  clients: Set<Bun.ServerWebSocket<{ terminalId: string }>>;
  output: string;
};
