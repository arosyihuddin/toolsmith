import {
  cp,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  addFavorite,
  addPin,
  clearRecents,
  getEditorSession,
  getProfile,
  getWorkspaceState,
  purgePaths,
  removeFavorite,
  removePin,
  reorderPins,
  rewritePaths,
  saveEditorSession,
  setPref,
  touchRecent,
  updateProfile,
} from "../../control-plane/workspace";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Relative paths stay home-scoped for compatibility; absolute paths browse the filesystem. */
export function workspacePath(input: string | null) {
  if (typeof input === "string" && input.startsWith("/")) {
    const target = resolve("/", input);
    return { root: "/", target, relativePath: target };
  }
  const root = homedir();
  const target = resolve(root, input ?? ".");
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(sep))
    throw new HttpError(400, "Workspace path is outside the user home directory");
  return { root, target, relativePath: rel || "." };
}

async function runGit(args: string[], cwd: string) {
  const proc = Bun.spawn(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0)
    throw new HttpError(400, stderr.trim() || "Git command failed");
  return stdout;
}

async function gitRepo(input: string | null) {
  const { target } = workspacePath(input);
  const info = await stat(target).catch(() => null);
  const cwd = info
    ? info.isDirectory()
      ? target
      : dirname(target)
    : dirname(target);
  const cwdInfo = await stat(cwd).catch(() => null);
  if (!cwdInfo?.isDirectory())
    throw new HttpError(404, "Workspace path not found");
  const repo = (await runGit(["rev-parse", "--show-toplevel"], cwd)).trim();
  workspacePath(repo);
  return { repo };
}

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

function validateName(name: unknown): string {
  if (typeof name !== "string") throw new HttpError(400, "A name is required");
  const value = name.trim();
  if (!value) throw new HttpError(400, "A name is required");
  if (value === "." || value === "..") throw new HttpError(400, "Invalid name");
  if (value.includes("/") || value.includes("\\") || value.includes("\0"))
    throw new HttpError(400, "Names cannot contain slashes");
  if (value.length > 255) throw new HttpError(400, "Name is too long");
  return value;
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

const requiredPath = (url: URL) => {
  const value = url.searchParams.get("path");
  if (!value) throw new HttpError(400, "A path is required");
  return value;
};

/** `foo.txt` → `foo copy.txt` → `foo copy 2.txt` … */
async function copyName(dir: string, name: string) {
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem} copy${i > 1 ? ` ${i}` : ""}${ext}`;
    if (!(await exists(join(dir, candidate)))) return candidate;
  }
  throw new HttpError(409, "Unable to find a free name for the copy");
}

export async function handleWorkspaceApi(
  request: Request,
  url: URL,
): Promise<Response | null> {
  const { pathname } = url;
  const method = request.method;
  const isOurs =
    pathname === "/api/profile" ||
    (pathname.startsWith("/api/workspace/") &&
      !["/api/workspace/file", "/api/workspace/preview"].includes(pathname)) ||
    (pathname === "/api/workspace" && method === "DELETE");
  if (!isOurs) return null;

  try {
    /* ------------------------------ profile ------------------------------ */
    if (pathname === "/api/profile") {
      if (method === "GET") return json(getProfile());
      if (method === "PUT") return json(updateProfile(await readBody(request)));
    }

    /* ------------------------------- state ------------------------------- */
    if (pathname === "/api/workspace/state" && method === "GET")
      return json(getWorkspaceState());

    if (pathname === "/api/workspace/pins") {
      if (method === "POST") {
        const body = await readBody(request);
        return json({ pins: addPin(body.path, body.name) });
      }
      if (method === "DELETE")
        return json({ pins: removePin(url.searchParams.get("path")) });
    }
    if (pathname === "/api/workspace/pins/order" && method === "PUT") {
      const body = await readBody(request);
      return json({ pins: reorderPins(body.paths) });
    }

    if (pathname === "/api/workspace/favorites") {
      if (method === "POST") {
        const body = await readBody(request);
        return json({
          favorites: addFavorite(body.path, body.name, body.type),
        });
      }
      if (method === "DELETE")
        return json({
          favorites: removeFavorite(url.searchParams.get("path")),
        });
    }

    if (pathname === "/api/workspace/recents") {
      if (method === "POST") {
        const body = await readBody(request);
        return json({ recents: touchRecent(body.path, body.name) });
      }
      if (method === "DELETE") return json({ recents: clearRecents() });
    }

    if (pathname === "/api/workspace/prefs" && method === "PUT") {
      const body = await readBody(request);
      return json({ prefs: setPref(body.key, body.value) });
    }

    if (pathname === "/api/workspace/editor-session") {
      if (method === "GET")
        return json({
          session: getEditorSession(url.searchParams.get("root")),
        });
      if (method === "PUT") {
        const body = await readBody(request);
        return json({
          session: saveEditorSession(body.root, body.tabs, body.activePath),
        });
      }
    }

    /* ------------------------------- git changes ------------------------------- */
    if (pathname === "/api/workspace/git-status" && method === "GET") {
      const { repo } = await gitRepo(requiredPath(url));
      const { root } = workspacePath(".");
      const output = await runGit(
        ["status", "--porcelain=v1", "--untracked-files=all"],
        repo,
      );
      const files = output
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const code = line.slice(0, 2);
          const filePath = line.slice(3);
          return {
            path: requiredPath(url).startsWith("/") ? join(repo, filePath) : relative(root, join(repo, filePath)),
            name: basename(filePath),
            status: code,
            kind: code.includes("?")
              ? "untracked"
              : code.includes("A")
                ? "added"
                : code.includes("D")
                  ? "deleted"
                  : "modified",
          };
        });
      return json({ repo: requiredPath(url).startsWith("/") ? repo : relative(root, repo), files });
    }

    if (pathname === "/api/workspace/git-diff" && method === "GET") {
      const requested = requiredPath(url);
      const { target, relativePath } = workspacePath(requested);
      const { repo } = await gitRepo(requested);
      const rel = relative(repo, target);
      if (
        !rel ||
        rel === ".." ||
        rel.startsWith(`..${sep}`) ||
        rel.startsWith(sep)
      )
        throw new HttpError(400, "File is outside the Git repository");
      const statusOutput = await runGit(
        ["status", "--porcelain=v1", "--untracked-files=all", "--", rel],
        repo,
      );
      if (!statusOutput.trim())
        throw new HttpError(404, "File has no uncommitted changes");
      const beforeResult = Bun.spawn(
        ["git", "-C", repo, "show", `HEAD:${rel}`],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [beforeText, beforeCode] = await Promise.all([
        new Response(beforeResult.stdout).text(),
        beforeResult.exited,
      ]);
      const before = beforeCode === 0 ? beforeText : "";
      const info = await stat(target).catch(() => null);
      const after = info?.isFile() ? await Bun.file(target).text() : "";
      return json({ path: relativePath, before, after });
    }

    /* ---------------------------- file operations ---------------------------- */
    if (pathname === "/api/workspace" && method === "DELETE") {
      const requested = url.searchParams.get("path");
      if (!requested || requested === "." || requested === "/")
        throw new HttpError(400, "A workspace item is required");
      const { target, relativePath } = workspacePath(requested);
      if (relativePath === "." || target === "/")
        throw new HttpError(400, "A workspace root cannot be deleted");
      const info = await stat(target).catch(() => {
        throw new HttpError(404, "Item not found");
      });
      await rm(target, { recursive: info.isDirectory(), force: false });
      purgePaths(relativePath);
      return json({ deleted: true });
    }

    if (pathname === "/api/workspace/create" && method === "POST") {
      const body = await readBody(request);
      const type =
        body.type === "directory"
          ? "directory"
          : body.type === "file"
            ? "file"
            : null;
      if (!type) throw new HttpError(400, "type must be 'file' or 'directory'");
      const { target, relativePath } = workspacePath(
        typeof body.path === "string" ? body.path : null,
      );
      if (relativePath === "." || target === "/") throw new HttpError(400, "A child path is required");
      validateName(basename(target));
      if (await exists(target))
        throw new HttpError(409, `“${basename(target)}” already exists`);
      const parent = await stat(dirname(target)).catch(() => null);
      if (!parent?.isDirectory())
        throw new HttpError(404, "Parent folder does not exist");
      if (type === "directory") await mkdir(target);
      else await writeFile(target, "", { flag: "wx" });
      return json({ path: relativePath, type }, 201);
    }

    if (pathname === "/api/workspace/rename" && method === "POST") {
      const body = await readBody(request);
      const newName = validateName(body.newName);
      const { target, relativePath, root } = workspacePath(
        typeof body.path === "string" ? body.path : null,
      );
      if (relativePath === "." || target === "/")
        throw new HttpError(400, "A workspace root cannot be renamed");
      if (!(await exists(target))) throw new HttpError(404, "Item not found");
      const next = join(dirname(target), newName);
      if (next === target) return json({ path: relativePath, name: newName });
      if (await exists(next))
        throw new HttpError(409, `“${newName}” already exists`);
      await rename(target, next);
      const nextRel = root === "/" ? next : relative(root, next);
      rewritePaths(relativePath, nextRel);
      return json({ path: nextRel, name: newName });
    }

    if (pathname === "/api/workspace/duplicate" && method === "POST") {
      const body = await readBody(request);
      const { target, relativePath, root } = workspacePath(
        typeof body.path === "string" ? body.path : null,
      );
      if (relativePath === "." || target === "/")
        throw new HttpError(400, "A workspace root cannot be duplicated");
      const info = await stat(target).catch(() => {
        throw new HttpError(404, "Item not found");
      });
      const name = await copyName(dirname(target), basename(target));
      const next = join(dirname(target), name);
      await cp(target, next, {
        recursive: info.isDirectory(),
        errorOnExist: true,
        force: false,
      });
      return json({ path: root === "/" ? next : relative(root, next), name }, 201);
    }

    if (pathname === "/api/workspace/move" && method === "POST") {
      const body = await readBody(request);
      const { target, relativePath, root } = workspacePath(
        typeof body.path === "string" ? body.path : null,
      );
      const dest = workspacePath(
        typeof body.destDir === "string" ? body.destDir : ".",
      );
      if (relativePath === "." || target === "/")
        throw new HttpError(400, "A workspace root cannot be moved");
      if (!(await exists(target))) throw new HttpError(404, "Item not found");
      const destInfo = await stat(dest.target).catch(() => null);
      if (!destInfo?.isDirectory())
        throw new HttpError(404, "Destination folder does not exist");
      if (dest.target === target || dest.target.startsWith(target + sep))
        throw new HttpError(400, "A folder cannot be moved into itself");
      const next = join(dest.target, basename(target));
      if (next === target) return json({ path: relativePath });
      if (await exists(next))
        throw new HttpError(
          409,
          `“${basename(target)}” already exists in the destination`,
        );
      await rename(target, next);
      const nextRel = root === "/" ? next : relative(root, next);
      rewritePaths(relativePath, nextRel);
      return json({ path: nextRel });
    }

    if (pathname === "/api/workspace/stat" && method === "GET") {
      const { target, relativePath } = workspacePath(requiredPath(url));
      const info = await stat(target).catch(() => {
        throw new HttpError(404, "Item not found");
      });
      const isDir = info.isDirectory();
      return json({
        path: relativePath,
        name: relativePath === "." ? "Home" : basename(target),
        type: isDir ? "directory" : "file",
        size: isDir ? null : info.size,
        created: (info.birthtime.getTime() > 0
          ? info.birthtime
          : info.ctime
        ).toISOString(),
        modified: info.mtime.toISOString(),
        mode: (info.mode & 0o777).toString(8).padStart(3, "0"),
        ...(isDir
          ? { children: (await readdir(target).catch(() => [])).length }
          : {}),
      });
    }

    if (pathname === "/api/workspace/download" && method === "GET") {
      const { target } = workspacePath(requiredPath(url));
      const info = await stat(target).catch(() => {
        throw new HttpError(404, "File not found");
      });
      if (!info.isFile())
        throw new HttpError(400, "Only files can be downloaded");
      const name = basename(target).replace(/["\r\n]/g, "_");
      return new Response(Bun.file(target), {
        headers: {
          "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(basename(target))}`,
          "cache-control": "no-store",
        },
      });
    }
  } catch (error) {
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    return json(
      { error: error instanceof Error ? error.message : "Request failed" },
      400,
    );
  }

  return null;
}
