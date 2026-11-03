import { setTimeout as delay } from "node:timers/promises";

export async function terminateProcessGroup(pid: number, graceMs = 300) {
  if (process.platform === "win32" || !Number.isInteger(pid) || pid <= 1) return;
  const signalGroup = (signal: NodeJS.Signals) => {
    try { process.kill(-pid, signal); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  };
  if (!signalGroup("SIGTERM")) return;
  await delay(graceMs);
  signalGroup("SIGKILL");
}
