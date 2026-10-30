import { getProcessSnapshots, stopManagedProcess } from "../process";
export async function handleProcessesApi(request: Request, url: URL): Promise<Response | null> {
 if (url.pathname === "/api/processes" && request.method === "GET") return Response.json({ processes: await getProcessSnapshots(), scope: "toolsmith-managed" }, { headers: { "cache-control": "no-store" } });
 const match = url.pathname.match(/^\/api\/processes\/([^/]+)$/);
 if (match && request.method === "DELETE") {
  try { const result = await stopManagedProcess(decodeURIComponent(match[1])); if (!result.ok) return Response.json({ error: result.reason === "not_found" ? "Process not found" : "Process cannot be stopped" }, { status: result.reason === "not_found" ? 404 : 409 }); return Response.json({ stopped: true, process: result.process }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to stop process" }, { status: 500 }); }
 }
 return null;
}
