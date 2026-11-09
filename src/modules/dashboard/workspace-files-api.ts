import { readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { workspacePath } from "./workspace-api";

async function getGitIgnoredNames(target: string, names: string[]) {
  if (!names.length) return new Set<string>();
  try {
    const proc = Bun.spawn(
      ["git", "-C", target, "check-ignore", "--no-index", "--stdin"],
      {
        stdin: new Blob([names.join("\n") + "\n"]),
        stdout: "pipe",
        stderr: "ignore",
      },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return new Set(output.split("\n").filter(Boolean));
  } catch {
    return new Set<string>();
  }
}

async function getWorkspaceEntries(input: string | null) {
  const { target, relativePath } = workspacePath(input);
  const entries = await readdir(target, { withFileTypes: true });
  const ignoredNames = await getGitIgnoredNames(
    target,
    entries.map((entry) => entry.name),
  );
  const items = (
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = resolve(target, entry.name);
        try {
          const info = await stat(fullPath);
          return {
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            size: entry.isFile() ? info.size : null,
            modified: info.mtime.toISOString(),
            ignored: ignoredNames.has(entry.name),
          };
        } catch {
          return null;
        }
      }),
    )
  ).filter((item): item is NonNullable<typeof item> => item !== null);
  items.sort((a, b) =>
    a.type === b.type
      ? a.name.localeCompare(b.name)
      : a.type === "directory"
        ? -1
        : 1,
  );
  return { path: relativePath, items };
}

export async function handleWorkspaceFilesApi(request: Request, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/workspace") {
    try {
      return Response.json(
        await getWorkspaceEntries(url.searchParams.get("path")),
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error ? error.message : "Unable to read workspace",
        },
        { status: 400 },
      );
    }
  }
  if (url.pathname === "/api/workspace/file" && request.method === "PUT") {
    try {
      const requested = url.searchParams.get("path");
      if (!requested) throw new Error("File path is required");
      const { target } = workspacePath(requested);
      const info = await stat(target);
      if (!info.isFile()) throw new Error("Workspace entry is not a file");
      if (info.size > 512 * 1024)
        throw new Error("File is too large to edit (limit 512 KiB)");
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.startsWith("text/"))
        throw new Error("Only text files can be edited");
      const content = await request.text();
      if (Buffer.byteLength(content, "utf8") > 512 * 1024)
        throw new Error("File content is too large (limit 512 KiB)");
      await writeFile(target, content, "utf8");
      const updated = await stat(target);
      return Response.json(
        {
          path: requested,
          size: updated.size,
          modified: updated.mtime.toISOString(),
          saved: true,
        },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : "Unable to save file",
        },
        { status: 400 },
      );
    }
  }
  if (url.pathname === "/api/workspace/preview") {
    try {
      const requested = url.searchParams.get("path");
      if (!requested) throw new Error("File path is required");
      const { target } = workspacePath(requested);
      const info = await stat(target);
      if (!info.isFile()) throw new Error("Workspace entry is not a file");
      const file = Bun.file(target);
      const contentType = file.type || "application/octet-stream";
      return new Response(file, {
        headers: {
          "cache-control": "private, max-age=60",
          "content-type": contentType,
          "content-length": String(info.size),
          "content-disposition": "inline",
        },
      });
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error ? error.message : "Unable to preview file",
        },
        { status: 400 },
      );
    }
  }
  if (url.pathname === "/api/workspace/file") {
    try {
      const requested = url.searchParams.get("path");
      if (!requested) throw new Error("File path is required");
      const { target } = workspacePath(requested);
      const info = await stat(target);
      if (!info.isFile()) throw new Error("Workspace entry is not a file");
      if (info.size > 512 * 1024)
        throw new Error("File is too large to preview (limit 512 KiB)");
      return Response.json(
        {
          path: requested,
          content: await Bun.file(target).text(),
          size: info.size,
          modified: info.mtime.toISOString(),
        },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : "Unable to read file",
        },
        { status: 400 },
      );
    }
  }
  return null;
}
