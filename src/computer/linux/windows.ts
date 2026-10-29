export interface DesktopWindow {
  id: string;
  app: string;
  title: string;
  pid: number | null;
  workspace: string | null;
  monitor: number | null;
  focused: boolean;
  visible: boolean;
  floating: boolean;
  fullscreen: boolean;
}

export interface ActiveWindow {
  id: string;
  app: string;
  title: string;
  pid: number | null;
}


async function run(command: string, args: string[] = []) {
  const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(stderr.trim() || `${command} failed`);
  return stdout;
}

type HyprlandClient = {
  address?: string;
  class?: string;
  title?: string;
  pid?: number;
  workspace?: { name?: string };
  monitor?: number;
  mapped?: boolean;
  floating?: boolean;
  fullscreen?: number;
};

type HyprlandActiveWindow = HyprlandClient & { address?: string };

function toDesktopWindow(client: HyprlandClient, activeId: string | null): DesktopWindow {
  return {
    id: client.address ?? "",
    app: client.class ?? "",
    title: client.title ?? "",
    pid: client.pid ?? null,
    workspace: client.workspace?.name ?? null,
    monitor: client.monitor ?? null,
    focused: client.address === activeId,
    visible: client.mapped ?? false,
    floating: client.floating ?? false,
    fullscreen: (client.fullscreen ?? 0) !== 0,
  };
}

export async function getLinuxActiveWindow(): Promise<ActiveWindow | null> {
  const raw = await run("hyprctl", ["activewindow", "-j"]);
  const window = JSON.parse(raw) as HyprlandActiveWindow;
  if (!window.address) return null;
  return {
    id: window.address,
    app: window.class ?? "",
    title: window.title ?? "",
    pid: window.pid ?? null,
  };
}

export async function listLinuxWindows(): Promise<DesktopWindow[]> {
  const [clientsRaw, active] = await Promise.all([
    run("hyprctl", ["clients", "-j"]),
    getLinuxActiveWindow(),
  ]);
  const clients = JSON.parse(clientsRaw) as HyprlandClient[];
  return clients.map((client) => toDesktopWindow(client, active?.id ?? null));
}

export async function focusLinuxWindow(id: string): Promise<void> {
  await run("hyprctl", ["dispatch", "focuswindow", `address:${id}`]);
}

export async function closeLinuxWindow(id: string): Promise<void> {
  await run("hyprctl", ["dispatch", "closewindow", `address:${id}`]);
}

export async function moveLinuxWindow(id: string, workspace: string): Promise<void> {
  await run("hyprctl", ["dispatch", "movetoworkspacesilent", `${workspace},address:${id}`]);
}
