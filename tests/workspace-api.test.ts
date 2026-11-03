import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

let handle: (request: Request) => Promise<Response>;
const sandbox = `.omp-test-${process.pid}`;
const dataDir = mkdtempSync(join(tmpdir(), "omp-db-"));

const call = async (method: string, path: string, body?: unknown) => {
  const response = await handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  return { status: response.status, data: (await response.json().catch(() => null)) as any };
};

beforeAll(async () => {
  process.env.TOOLSMITH_DATA_DIR = dataDir;
  process.env.TOOLSMITH_SUDO_ENCRYPTION_KEY = "test-sudo-encryption-key-for-tests-123456";
  ({ handleDashboardRequest: handle } = await import("../src/dashboard"));
  const created = await call("POST", "/api/workspace/create", { path: sandbox, type: "directory" });
  expect(created.status).toBe(201);
});

afterAll(() => {
  rmSync(join(homedir(), sandbox), { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

describe("workspace api", () => {
  test("profile stores display name and visual preferences", async () => {
    const first = await call("GET", "/api/profile");
    expect(first.data.id).toBe("default");
    expect(["accent", "info", "success", "warning", "danger"]).toContain(first.data.avatarColor);
    expect(first.data.displayName).toBeString();
    expect(first.data).not.toHaveProperty("role");
    const updated = await call("PUT", "/api/profile", { avatarColor: "success" });
    expect(updated.data.avatarColor).toBe("success");
    expect((await call("GET", "/api/profile")).data.avatarColor).toBe("success");
  });

  test("profile avatar color is validated against the token palette", async () => {
    expect((await call("PUT", "/api/profile", { avatarColor: "success" })).data.avatarColor).toBe("success");
    const bad = await call("PUT", "/api/profile", { avatarColor: "#ff0000" });
    expect(bad.status).toBe(400);

  });

  test("create, conflict, rename, duplicate, move, stat, delete", async () => {
    const file = `${sandbox}/a.txt`;
    expect((await call("POST", "/api/workspace/create", { path: file, type: "file" })).status).toBe(201);
    expect((await call("POST", "/api/workspace/create", { path: file, type: "file" })).status).toBe(409);
    expect((await call("POST", "/api/workspace/rename", { path: file, newName: "b.txt" })).data.path).toBe(`${sandbox}/b.txt`);
    expect((await call("POST", "/api/workspace/rename", { path: `${sandbox}/b.txt`, newName: "x/y" })).status).toBe(400);
    expect((await call("POST", "/api/workspace/duplicate", { path: `${sandbox}/b.txt` })).data.name).toBe("b copy.txt");
    await call("POST", "/api/workspace/create", { path: `${sandbox}/sub`, type: "directory" });
    expect((await call("POST", "/api/workspace/move", { path: `${sandbox}/b.txt`, destDir: `${sandbox}/sub` })).data.path).toBe(`${sandbox}/sub/b.txt`);
    const info = await call("GET", `/api/workspace/stat?path=${encodeURIComponent(`${sandbox}/sub`)}`);
    expect(info.data.type).toBe("directory");
    expect(info.data.children).toBe(1);
    expect((await call("DELETE", `/api/workspace?path=${encodeURIComponent(`${sandbox}/sub`)}`)).status).toBe(200);
    expect(existsSync(join(homedir(), sandbox, "sub"))).toBe(false);
  });

  test("rejects traversal", async () => {
    expect((await call("POST", "/api/workspace/create", { path: "../../evil", type: "file" })).status).toBe(400);
    expect((await call("GET", "/api/workspace/stat?path=../../etc")).status).toBe(400);
  });

  test("can browse filesystem root without allowing root deletion", async () => {
    const listing = await call("GET", "/api/workspace?path=%2F");
    expect(listing.status).toBe(200);
    expect(listing.data.path).toBe("/");
    expect(Array.isArray(listing.data.items)).toBe(true);
    expect((await call("DELETE", "/api/workspace?path=%2F")).status).toBe(400);
    expect((await call("POST", "/api/workspace/rename", { path: "/", newName: "oops" })).status).toBe(400);
  });

  test("absolute filesystem paths stay absolute across file operations", async () => {
    const rootPath = join(tmpdir(), `omp-absolute-test-${process.pid}`);
    const file = `${rootPath}/a.txt`;
    expect((await call("POST", "/api/workspace/create", { path: rootPath, type: "directory" })).data.path).toBe(rootPath);
    expect((await call("POST", "/api/workspace/create", { path: file, type: "file" })).data.path).toBe(file);
    const renamed = await call("POST", "/api/workspace/rename", { path: file, newName: "b.txt" });
    expect(renamed.data.path).toBe(`${rootPath}/b.txt`);
    expect((await call("DELETE", `/api/workspace?path=${encodeURIComponent(rootPath)}`)).status).toBe(200);
    expect(existsSync(rootPath)).toBe(false);
  });

  test("sudo password is stored encrypted and never returned by the API", async () => {
    const secret = "test-only-sudo-secret";
    const saved = await call("PUT", "/api/root-commands/password", { password: secret });
    expect(saved.status).toBe(200);
    expect(saved.data.passwordConfigured).toBe(true);
    expect(JSON.stringify(saved.data)).not.toContain(secret);
    const config = await call("GET", "/api/root-commands");
    expect(config.data.passwordConfigured).toBe(true);
    expect(JSON.stringify(config.data)).not.toContain(secret);
    expect((await call("PUT", "/api/root-commands/password", { clearPassword: true })).data.passwordConfigured).toBe(false);
  });


  test("pins, favorites, recents, prefs follow renames and deletes", async () => {
    await call("POST", "/api/workspace/create", { path: `${sandbox}/proj`, type: "directory" });
    await call("POST", "/api/workspace/pins", { path: `${sandbox}/proj`, name: "proj" });
    await call("POST", "/api/workspace/favorites", { path: `${sandbox}/proj`, name: "proj", type: "directory" });
    await call("POST", "/api/workspace/recents", { path: `${sandbox}/proj`, name: "proj" });
    expect((await call("PUT", "/api/workspace/prefs", { key: "view", value: "grid" })).data.prefs.view).toBe("grid");
    expect((await call("PUT", "/api/workspace/prefs", { key: "nope", value: "x" })).status).toBe(400);

    await call("POST", "/api/workspace/rename", { path: `${sandbox}/proj`, newName: "proj2" });
    let state = (await call("GET", "/api/workspace/state")).data;
    expect(state.pins.map((p: any) => p.path)).toContain(`${sandbox}/proj2`);
    expect(state.favorites.map((f: any) => f.path)).toContain(`${sandbox}/proj2`);
    expect(state.pins.find((p: any) => p.path === `${sandbox}/proj2`)?.name).toBe("proj2");

    await call("DELETE", `/api/workspace?path=${encodeURIComponent(`${sandbox}/proj2`)}`);
    state = (await call("GET", "/api/workspace/state")).data;
    expect(state.pins.map((p: any) => p.path)).not.toContain(`${sandbox}/proj2`);
    expect(state.favorites.map((f: any) => f.path)).not.toContain(`${sandbox}/proj2`);
    expect(state.recents.map((item: any) => item.path)).not.toContain(`${sandbox}/proj2`);
  });

  test("editor session round-trips", async () => {
    await call("PUT", "/api/workspace/editor-session", { root: sandbox, tabs: [`${sandbox}/a`, `${sandbox}/b`], activePath: `${sandbox}/b` });
    const { data } = await call("GET", `/api/workspace/editor-session?root=${encodeURIComponent(sandbox)}`);
    expect(data.session.tabs).toHaveLength(2);
    expect(data.session.activePath).toBe(`${sandbox}/b`);
  });
  test("reports uncommitted Git changes and before/after file contents", async () => {
    const repoPath = `${sandbox}/gitrepo`;
    const repo = join(homedir(), repoPath);
    mkdirSync(repo, { recursive: true });
    execFileSync("git", ["-C", repo, "init", "-q"]);
    execFileSync("git", ["-C", repo, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
    writeFileSync(join(repo, "tracked.txt"), "before\\n");
    execFileSync("git", ["-C", repo, "add", "tracked.txt"]);
    execFileSync("git", ["-C", repo, "commit", "-qm", "initial"]);
    writeFileSync(join(repo, "tracked.txt"), "after\\n");
    writeFileSync(join(repo, "new.txt"), "new file\\n");

    const status = await call("GET", `/api/workspace/git-status?path=${encodeURIComponent(repoPath)}`);
    expect(status.status).toBe(200);
    const statusData = status.data as { files: { name: string }[] };
    expect(statusData.files.map((file) => file.name)).toContain("tracked.txt");
    expect(statusData.files.map((file) => file.name)).toContain("new.txt");

    const tracked = await call("GET", `/api/workspace/git-diff?path=${encodeURIComponent(`${repoPath}/tracked.txt`)}`);
    expect(tracked.status).toBe(200);
    const trackedData = tracked.data as { before: string; after: string };
    expect(trackedData.before).toBe("before\\n");
    expect(trackedData.after).toBe("after\\n");

    const untracked = await call("GET", `/api/workspace/git-diff?path=${encodeURIComponent(`${repoPath}/new.txt`)}`);
    expect(untracked.status).toBe(200);
    const untrackedData = untracked.data as { before: string; after: string };
    expect(untrackedData.before).toBe("");
    expect(untrackedData.after).toBe("new file\\n");
  });

});
