import { randomUUID } from "node:crypto";
import { registerManagedProcess } from "../process";

export type TunnelState = "starting" | "running" | "stopping" | "stopped" | "error";
export interface ManagedTunnel {
  id: string;
  target: string;
  state: TunnelState;
  createdAt: string;
  updatedAt: string;
  publicUrl?: string;
  error?: string;
  logs: string[];
}
interface TunnelProcess extends ManagedTunnel { process?: Bun.Subprocess; processHandle?: ReturnType<typeof registerManagedProcess> }

const MAX_LOG_LINES = 300;
const tunnels = new Map<string, TunnelProcess>();
const eventClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const eventEncoder = new TextEncoder();

function snapshot(record: TunnelProcess): ManagedTunnel {
  const { process: _process, processHandle: _processHandle, ...safe } = record;
  return { ...safe, logs: [...safe.logs] };
}

export function listTunnels(): ManagedTunnel[] {
  return [...tunnels.values()].map(snapshot).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function getTunnel(id: string): ManagedTunnel | null {
  const record = tunnels.get(id);
  return record ? snapshot(record) : null;
}
export function getTunnelLogs(id: string): string[] | null {
  const record = tunnels.get(id);
  return record ? [...record.logs] : null;
}

function publishTunnels() {
  const payload = eventEncoder.encode(`event: tunnels\ndata: ${JSON.stringify({ tunnels: listTunnels() })}\n\n`);
  for (const client of eventClients) {
    try { client.enqueue(payload); } catch { eventClients.delete(client); }
  }
}

function tunnelEventsResponse() {
  let client: ReadableStreamDefaultController<Uint8Array> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      client = controller;
      eventClients.add(controller);
      controller.enqueue(eventEncoder.encode(`event: tunnels\ndata: ${JSON.stringify({ tunnels: listTunnels() })}\n\n`));
      heartbeat = setInterval(() => {
        try { controller.enqueue(eventEncoder.encode(": keep-alive\n\n")); }
        catch { eventClients.delete(controller); clearInterval(heartbeat); }
      }, 20000);
    },
    cancel() { if (client) eventClients.delete(client); clearInterval(heartbeat); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-store, must-revalidate", connection: "keep-alive", "x-accel-buffering": "no" } });
}

function validateTarget(input: unknown): string {
  if (typeof input !== "string" || input.length > 2048) throw new Error("Target URL must be a valid loopback HTTP(S) URL.");
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Target URL must be a valid loopback HTTP(S) URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP and HTTPS targets are supported.");
  if (url.username || url.password || url.search || url.hash) throw new Error("Credentials, query strings, and fragments are not allowed.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") throw new Error("Tunnel targets must use localhost, 127.0.0.1, or ::1.");
  return url.toString();
}

function appendLog(record: TunnelProcess, line: string) {
  record.logs.push(line.slice(0, 2000));
  if (record.logs.length > MAX_LOG_LINES) record.logs.splice(0, record.logs.length - MAX_LOG_LINES);
  record.updatedAt = new Date().toISOString();
  const match = line.match(/https:\/\/[-\w]+\.trycloudflare\.com/);
  if (match) {
    record.publicUrl = match[0];
    if (record.state === "starting") record.state = "running";
  }
  publishTunnels();
}

export async function startTunnel(input: unknown): Promise<ManagedTunnel> {
  const target = validateTarget(input);
  const existing = [...tunnels.values()].find((item) => item.target === target && (item.state === "starting" || item.state === "running"));
  if (existing) return snapshot(existing);
  const now = new Date().toISOString();
  const record: TunnelProcess = { id: randomUUID(), target, state: "starting", createdAt: now, updatedAt: now, logs: [] };
  tunnels.set(record.id, record);
  try {
    const child = Bun.spawn(["cloudflared", "tunnel", "--no-autoupdate", "--url", target], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    record.process = child;
    record.processHandle = registerManagedProcess({ pid: child.pid, source: "tunnel", kind: "service", label: "cloudflared tunnel", cwd: process.cwd(), stop: async () => { await stopTunnel(record.id); } });
    publishTunnels();
    const consume = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          pending += decoder.decode(chunk.value, { stream: true });
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? "";
          for (const line of lines) if (line.trim()) appendLog(record, line);
        }
        if (pending.trim()) appendLog(record, pending);
      } catch (error) {
        appendLog(record, `Log stream error: ${error instanceof Error ? error.message : String(error)}`);
      } finally { reader.releaseLock(); }
    };
    void Promise.all([consume(child.stdout), consume(child.stderr)]);
    void child.exited.then((code) => {
      record.process = undefined;
      record.processHandle?.finish(code);
      record.processHandle = undefined;
      record.updatedAt = new Date().toISOString();
      if (record.state === "stopping") record.state = "stopped";
      else if (code === 0) record.state = "stopped";
      else {
        record.state = "error";
        record.error = `cloudflared exited with code ${code}`;
      }
      appendLog(record, `Process exited with code ${code}`);
      publishTunnels();
    });
    return snapshot(record);
  } catch (error) {
    record.state = "error";
    record.error = error instanceof Error ? error.message : String(error);
    appendLog(record, record.error);
    publishTunnels();
    return snapshot(record);
  }
}

export async function stopTunnel(id: string): Promise<ManagedTunnel | null> {
  const record = tunnels.get(id);
  if (!record) return null;
  const child = record.process;
  if (!child || record.state === "stopped" || record.state === "error") return snapshot(record);
  record.state = "stopping";
  record.updatedAt = new Date().toISOString();
  publishTunnels();
  try {
    child.kill("SIGTERM");
    await Promise.race([child.exited.then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
    if (record.process) {
      try { child.kill("SIGKILL"); } catch {}
      await child.exited;
    }
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
    record.state = "error";
  }
  publishTunnels();
  return snapshot(record);
}

export async function stopAllTunnels(): Promise<void> {
  await Promise.all([...tunnels.keys()].map((id) => stopTunnel(id)));
}


function cloudflaredStatus() {
  const executable = Bun.which("cloudflared");
  if (!executable) return { installed: false, path: null, version: null, available: true };
  let version: string | null = null;
  try {
    const result = Bun.spawnSync([executable, "--version"], { stdout: "pipe", stderr: "pipe", timeout: 3000 });
    const output = new TextDecoder().decode(result.stdout).trim() || new TextDecoder().decode(result.stderr).trim();
    if (result.exitCode === 0 && output) version = output.split("\n")[0];
  } catch {}
  return { installed: true, path: executable, version, available: true };
}

export async function handleTunnelApi(request: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/tunnels")) return null;
  const noStore = { "cache-control": "no-store" };
  if (url.pathname === "/api/tunnels/status" && request.method === "GET") return Response.json(cloudflaredStatus(), { headers: noStore });
  if (url.pathname === "/api/tunnels/events" && request.method === "GET") return tunnelEventsResponse();
  if (url.pathname === "/api/tunnels" && request.method === "GET") return Response.json({ tunnels: listTunnels() }, { headers: noStore });
  if (url.pathname === "/api/tunnels" && request.method === "POST") {
    try {
      const body = await request.json() as { target?: unknown };
      const tunnel = await startTunnel(body.target);
      return Response.json({ tunnel }, { status: tunnel.state === "error" ? 500 : 201, headers: noStore });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Unable to start tunnel" }, { status: 400, headers: noStore });
    }
  }
  const match = url.pathname.match(/^\/api\/tunnels\/([\w-]+)(?:\/(logs|stop))?$/);
  if (match) {
    const [, id, action] = match;
    if (action === "logs" && request.method === "GET") {
      const logs = getTunnelLogs(id);
      return logs ? Response.json({ id, logs }, { headers: noStore }) : Response.json({ error: "Tunnel not found" }, { status: 404, headers: noStore });
    }
    if ((action === "stop" || !action) && (request.method === "POST" || request.method === "DELETE")) {
      const tunnel = await stopTunnel(id);
      return tunnel ? Response.json({ tunnel }, { headers: noStore }) : Response.json({ error: "Tunnel not found" }, { status: 404, headers: noStore });
    }
    if (!action && request.method === "GET") {
      const tunnel = getTunnel(id);
      return tunnel ? Response.json({ tunnel }, { headers: noStore }) : Response.json({ error: "Tunnel not found" }, { status: 404, headers: noStore });
    }
  }
  return Response.json({ error: "Method or tunnel endpoint not found" }, { status: 405, headers: noStore });
}
