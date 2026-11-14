import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { resolveWorkingDirectory } from "../src/lib/working-directory";

let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

test("keeps an existing absolute working directory absolute", async () => {
  expect(await resolveWorkingDirectory(process.cwd())).toBe(process.cwd());
});

test("resolves relative paths from the home directory when they exist there", async () => {
  temporaryDirectory = await mkdtemp(join(homedir(), "toolsmith-cwd-resolution-"));
  expect(await resolveWorkingDirectory(basename(temporaryDirectory))).toBe(temporaryDirectory);
});

test("reports a clear error when the directory does not exist", async () => {
  await expect(resolveWorkingDirectory("toolsmith-cwd-path-that-does-not-exist-123456"))
    .rejects.toThrow("Working directory does not exist or is not a directory");
});
