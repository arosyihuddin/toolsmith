import { afterEach, expect, test } from "bun:test";
import { terminalManager } from "../src/terminal";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const created: string[] = [];

afterEach(async () => {
  await terminalManager.disposeAll(1_000);
});

test("disposeAll removes every managed terminal and waits for shutdown", async () => {
  const first = terminalManager.create("/tmp", "lifecycle-test-1");
  const second = terminalManager.create("/tmp", "lifecycle-test-2");
  created.push(first.id, second.id);

  expect(terminalManager.get(first.id)?.status).toBe("running");
  expect(terminalManager.get(second.id)?.status).toBe("running");

  await terminalManager.disposeAll(1_000);

  expect(terminalManager.get(first.id)).toBeUndefined();
  expect(terminalManager.get(second.id)).toBeUndefined();
  expect(terminalManager.list().filter((terminal) => created.includes(terminal.id))).toHaveLength(0);
});

test("disposing a terminal also terminates its shell descendants", async () => {
  const previousShell = Bun.env.SHELL;
  const pidFile = join(tmpdir(), "toolsmith-terminal-child-" + crypto.randomUUID() + ".pid");
  Bun.env.SHELL = "/bin/sh";
  const terminal = terminalManager.create("/tmp", "descendant-cleanup-test");
  try {
    terminalManager.input(terminal.id, "sleep 30 & echo $! > " + pidFile + "\n");
    let childPid: number | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { childPid = Number((await readFile(pidFile, "utf8")).trim()); if (Number.isInteger(childPid) && childPid > 0) break; } catch {}
      await Bun.sleep(20);
    }
    expect(childPid).toBeGreaterThan(0);
    terminalManager.dispose(terminal.id);
    await Bun.sleep(250);
    let alive = false;
    try { process.kill(childPid!, 0); alive = true; } catch {}
    expect(alive).toBe(false);
  } finally {
    await rm(pidFile, { force: true });
    await terminalManager.disposeAll(1_000);
    if (previousShell === undefined) delete Bun.env.SHELL; else Bun.env.SHELL = previousShell;
  }
});

test("disposeAll is safe when no terminals remain", async () => {
  await expect(terminalManager.disposeAll(100)).resolves.toBeUndefined();
});
