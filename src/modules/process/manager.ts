import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ManagedProcessSnapshot, RegisterProcessInput } from "./types";
import { emitDashboardEvent } from "../dashboard/events";
interface ProcessRecord extends ManagedProcessSnapshot { stop?: () => Promise<void> | void; stopRequested?: boolean; }
const records = new Map<string, ProcessRecord>();
const MAX_HISTORY = 200;
const cpuSamples = new Map<number, { seconds: number; at: number }>();
async function readMetrics(pid: number) {
 if (process.platform !== "linux") return {};
 try {
  const [status, stat] = await Promise.all([readFile("/proc/" + pid + "/status", "utf8"), readFile("/proc/" + pid + "/stat", "utf8")]);
  const rss = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
  const close = stat.lastIndexOf(")");
  const fields = stat.slice(close + 2).split(/\s+/);
  const cpuTimeSeconds = (Number(fields[11] || 0) + Number(fields[12] || 0)) / 100;
  const now = Date.now();
  const previous = cpuSamples.get(pid);
  cpuSamples.set(pid, { seconds: cpuTimeSeconds, at: now });
  const cpuPercent = previous && now > previous.at
    ? Math.max(0, ((cpuTimeSeconds - previous.seconds) / ((now - previous.at) / 1000)) * 100)
    : undefined;
  return {
    ...(rss ? { memoryRssBytes: Number(rss[1]) * 1024 } : {}),
    ...(cpuPercent !== undefined ? { cpuPercent } : {}),
    cpuTimeSeconds,
    processName: stat.slice(stat.indexOf("(") + 1, close),
  };
 } catch { return {}; }
}
function snapshot(record: ProcessRecord): ManagedProcessSnapshot { const { stop: _stop, ...safe } = record; return safe; }
function publish() { emitDashboardEvent({ type: "process.updated", data: { processes: listProcesses() } }); }
export function listProcesses(): ManagedProcessSnapshot[] { return [...records.values()].sort((a,b) => b.startedAt.localeCompare(a.startedAt)).map(snapshot); }
export async function getProcessSnapshots(): Promise<ManagedProcessSnapshot[]> {
 const items = await Promise.all([...records.values()].map(async record => ({ ...snapshot(record), ...(record.status === "running" || record.status === "stopping" ? await readMetrics(record.pid) : {}) })));
 return items.sort((a,b) => b.startedAt.localeCompare(a.startedAt));
}
export function registerManagedProcess(input: RegisterProcessInput) {
 const id = randomUUID();
 const record: ProcessRecord = { id, pid: input.pid, source: input.source, kind: input.kind, label: input.label.slice(0,160), ...(input.cwd ? { cwd: input.cwd } : {}), status: "running", startedAt: new Date().toISOString(), stoppable: Boolean(input.stop), ...(input.stop ? { stop: input.stop } : {}) };
 records.set(id, record); pruneHistory(); publish(); let finished = false;
 return { id, finish(exitCode = 0) { if (finished) return; finished = true; record.status = record.stopRequested ? "stopped" : exitCode === 0 ? "exited" : "failed"; record.exitCode = exitCode; record.endedAt = new Date().toISOString(); record.stoppable = false; record.stop = undefined; cpuSamples.delete(record.pid); publish(); }, setStop(stop: (() => Promise<void> | void) | undefined) { record.stop = stop; record.stoppable = Boolean(stop); } };
}
function pruneHistory() { const completed = [...records.values()].filter(r => r.status === "exited" || r.status === "stopped" || r.status === "failed").sort((a,b) => (a.endedAt || "").localeCompare(b.endedAt || "")); while (records.size > MAX_HISTORY && completed.length) records.delete(completed.shift()!.id); }
export async function stopManagedProcess(id: string) {
 const record = records.get(id);
 if (!record) return { ok: false as const, reason: "not_found" as const };
 if (record.status !== "running" || !record.stop) return { ok: false as const, reason: "not_stoppable" as const };
 record.status = "stopping"; record.stopRequested = true; publish();
 try { await record.stop(); if (record.status === "stopping") { record.status = "stopped"; record.endedAt = new Date().toISOString(); record.stoppable = false; record.stop = undefined; } publish(); return { ok: true as const, process: snapshot(record) }; }
 catch (error) { record.status = "running"; record.stopRequested = false; publish(); throw error; }
}
