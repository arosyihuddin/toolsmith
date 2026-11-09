export type ManagedProcessSource = "bash" | "eval" | "sudo" | "terminal" | "tunnel";
export type ManagedProcessKind = "command" | "terminal" | "service";
export type ManagedProcessStatus = "running" | "stopping" | "stopped" | "exited" | "failed";
export interface ManagedProcessSnapshot { id: string; pid: number; source: ManagedProcessSource; kind: ManagedProcessKind; label: string; cwd?: string; status: ManagedProcessStatus; startedAt: string; endedAt?: string; exitCode?: number; memoryRssBytes?: number; cpuTimeSeconds?: number; cpuPercent?: number; processName?: string; stoppable: boolean; }
export interface RegisterProcessInput { pid: number; source: ManagedProcessSource; kind: ManagedProcessKind; label: string; cwd?: string; stop?: () => Promise<void> | void; }
