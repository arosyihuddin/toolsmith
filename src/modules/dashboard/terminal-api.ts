import { terminalManager } from "../terminal";

export async function handleTerminalApi(request: Request, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/terminals" && request.method === "GET") {
    const scopeParam = url.searchParams.get("scope");
    const scope =
      scopeParam === "project" || scopeParam === "general"
        ? scopeParam
        : undefined;
    const workspaceRoot = url.searchParams.get("workspaceRoot") ?? undefined;
    try {
      return Response.json(
        { terminals: terminalManager.list(scope, workspaceRoot) },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error ? error.message : "Unable to list terminals",
        },
        { status: 400 },
      );
    }
  }

  if (url.pathname === "/api/terminals" && request.method === "POST") {
    try {
      const body = (await request.json().catch(() => ({}))) as {
        cwd?: string;
        title?: string;
        scope?: "general" | "project";
        workspaceRoot?: string;
      };
      const scope = body.scope === "project" ? "project" : "general";
      if (scope === "project" && !body.workspaceRoot) {
        throw new Error("Project terminal requires a workspace root");
      }
      return Response.json(
        {
          terminal: terminalManager.create(
            body.cwd,
            body.title,
            scope,
            body.workspaceRoot,
          ),
        },
        { status: 201 },
      );
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unable to create terminal",
        },
        { status: 400 },
      );
    }
  }

  const terminalMatch = url.pathname.match(/^\/api\/terminals\/([^/]+)$/);
  if (terminalMatch && request.method === "DELETE") {
    return terminalManager.dispose(decodeURIComponent(terminalMatch[1]))
      ? Response.json({ disposed: true })
      : Response.json({ error: "Unknown terminal" }, { status: 404 });
  }

  return null;
}
