import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fsFind, fsGrep } from "../src/filesystem/search";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("filesystem find", () => {
  test("rejects an already-aborted external search without leaving a child process", async () => {
    if (!Bun.which("rg")) return;
    const root = await mkdtemp(join(tmpdir(), "omp-fs-abort-"));
    directories.push(root);
    await writeFile(join(root, "sample.txt"), "search me");
    const controller = new AbortController();
    controller.abort();

    await expect(fsGrep({ pattern: "search", path: root }, root, controller.signal)).rejects.toThrow("Search aborted");
  });

  test("cancels when the signal fires while path validation is pending", async () => {
    if (!Bun.which("rg")) return;
    const root = await mkdtemp(join(tmpdir(), "omp-fs-race-"));
    directories.push(root);
    await writeFile(join(root, "sample.txt"), "search me");
    const controller = new AbortController();
    const pending = fsGrep({ pattern: "search", path: root }, root, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("Search aborted");
  });

  test("searches files without requiring fd and respects hidden-file settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "omp-fs-find-"));
    directories.push(root);
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "visible.txt"), "visible");
    await writeFile(join(root, ".hidden.txt"), "hidden");
    await writeFile(join(root, "nested", "inside.txt"), "nested");

    const visible = await fsFind({ pattern: "\\.txt$", path: root, type: "file" }, root) as { results: string[] };
    expect(visible.results).toContain(join(root, "visible.txt"));
    expect(visible.results).toContain(join(root, "nested", "inside.txt"));
    expect(visible.results).not.toContain(join(root, ".hidden.txt"));

    const withHidden = await fsFind({ pattern: "\\.txt$", path: root, type: "file", hidden: true }, root) as { results: string[] };
    expect(withHidden.results).toContain(join(root, ".hidden.txt"));
  });
});
