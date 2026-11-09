import { describe, expect, test } from "bun:test";
import { getProcessSnapshots, registerManagedProcess, stopManagedProcess } from "../src/modules/process";
import { handleProcessesApi } from "../src/modules/dashboard/processes-api";

describe("managed process registry", () => {
  test("tracks a process lifecycle without exposing stop callbacks", async () => {
    const handle = registerManagedProcess({
      pid: process.pid,
      source: "bash",
      kind: "command",
      label: "Test command",
      stop: () => {},
    });
    const running = await getProcessSnapshots();
    const current = running.find((item) => item.id === handle.id);
    expect(current?.status).toBe("running");
    expect(current?.stoppable).toBe(true);
    expect(current).not.toHaveProperty("stop");
    handle.finish(0);
    const completed = await getProcessSnapshots();
    const finished = completed.find((item) => item.id === handle.id);
    expect(finished?.status).toBe("exited");
    expect(finished?.exitCode).toBe(0);
    expect(finished?.stoppable).toBe(false);
  });

  test("serves process snapshots through the dashboard API", async () => {
    const handle = registerManagedProcess({
      pid: process.pid,
      source: "eval",
      kind: "command",
      label: "API test",
    });
    const response = await handleProcessesApi(
      new Request("http://localhost/api/processes"),
      new URL("http://localhost/api/processes"),
    );
    expect(response?.status).toBe(200);
    const body = await response!.json() as { processes: Array<{ id: string; label: string }>; scope: string };
    expect(body.scope).toBe("toolsmith-managed");
    expect(body.processes.some((item) => item.id === handle.id && item.label === "API test")).toBe(true);
    handle.finish(0);
  });

  test("stops a registered managed process through its owner", async () => {
    let stopped = false;
    const handle = registerManagedProcess({
      pid: process.pid,
      source: "terminal",
      kind: "terminal",
      label: "Test terminal",
      stop: () => { stopped = true; handle.finish(1); }
    });
    const result = await stopManagedProcess(handle.id);
    expect(result.ok).toBe(true);
    expect(stopped).toBe(true);
    const snapshot = (await getProcessSnapshots()).find((item) => item.id === handle.id);
    expect(snapshot?.status).toBe("stopped");
  });
});
