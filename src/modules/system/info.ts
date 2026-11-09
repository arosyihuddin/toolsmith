import { readFile, statfs } from "node:fs/promises";
import os from "node:os";

type CommandResult = { ok: boolean; stdout: string; stderr: string };
type CpuTimeSample = { idle: number; total: number }[];
let previousCpuTimes: CpuTimeSample | undefined;

async function command(commandName: string, args: string[] = []): Promise<CommandResult> {
  try {
    const proc = Bun.spawn([commandName, ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch {
    return { ok: false, stdout: "", stderr: "" };
  }
}

async function commandVersion(name: string): Promise<string | null> {
  const result = await command(name, ["--version"]);
  return result.ok && result.stdout ? result.stdout.split("\n")[0].trim() || null : null;
}

async function readOsRelease(): Promise<Record<string, string>> {
  if (process.platform === "win32" || process.platform === "darwin") return {};
  for (const path of ["/etc/os-release", "/usr/lib/os-release"]) {
    try {
      const values: Record<string, string> = {};
      for (const line of (await readFile(path, "utf8")).split("\n")) {
        const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (!match) continue;
        values[match[1]] = match[2].replace(/^"|"$/g, "");
      }
      return values;
    } catch { /* try next path */ }
  }
  return {};
}

async function getWindowsVersion() {
  if (process.platform !== "win32") return null;
  const result = await command("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    "Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture | ConvertTo-Json -Compress",
  ]);
  if (!result.ok || !result.stdout) return null;
  try { return JSON.parse(result.stdout) as Record<string, string>; } catch { return null; }
}

async function getOsInfo() {
  const release = await readOsRelease();
  const windows = await getWindowsVersion();
  return {
    platform: process.platform,
    architecture: process.arch,
    kernel: os.release(),
    hostname: os.hostname(),
    distribution: windows?.Caption ?? release.NAME ?? (process.platform === "darwin" ? "macOS" : null),
    distribution_id: release.ID ?? (process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : null),
    version: windows?.Version ?? release.VERSION_ID ?? null,
    build: windows?.BuildNumber ?? null,
    architecture_name: windows?.OSArchitecture ?? null,
    pretty_name: release.PRETTY_NAME ?? null,
    codename: release.VERSION_CODENAME ?? null,
  };
}

function getMemoryInfo() {
  const total = os.totalmem();
  const available = os.freemem();
  return { total_bytes: total, available_bytes: available, used_bytes: total - available, usage_percent: Number((((total - available) / total) * 100).toFixed(1)) };
}

async function getDiskInfo(path = process.platform === "win32" ? "C:\\\\" : "/") {
  try {
    const fs = await statfs(path);
    const total = Number(fs.blocks) * Number(fs.bsize);
    const available = Number(fs.bavail) * Number(fs.bsize);
    return { path, total_bytes: total, available_bytes: available, used_bytes: total - available, usage_percent: total ? Number((((total - available) / total) * 100).toFixed(1)) : 0 };
  } catch { return { path, available: false }; }
}

 function getCpuInfo() {
  const cpus = os.cpus();
  const load = os.loadavg();
  const totals = cpus.map((cpu) => {
    const times = cpu.times;
    const idle = times.idle;
    const total = times.user + times.nice + times.sys + times.idle + times.irq;
    return { idle, total };
  });
  const previous = previousCpuTimes;
  previousCpuTimes = totals;
  let usagePercent: number | null = null;
  if (previous?.length === totals.length) {
    const idleDelta = totals.reduce((sum, cpu, index) => sum + Math.max(0, cpu.idle - previous[index].idle), 0);
    const totalDelta = totals.reduce((sum, cpu, index) => sum + Math.max(0, cpu.total - previous[index].total), 0);
    if (totalDelta > 0) usagePercent = Number((Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100))).toFixed(1));
  }
  return { model: cpus[0]?.model ?? null, logical_cores: cpus.length, usage_percent: usagePercent, load_average: { "1m": load[0], "5m": load[1], "15m": load[2] } };
}

async function getGpuInfo() {
  const query = "index,name,driver_version,memory.total,memory.used,memory.free,utilization.gpu,utilization.memory,temperature.gpu,power.draw";
  const nvidia = await command("nvidia-smi", ["--query-gpu=" + query, "--format=csv,noheader,nounits"]);
  if (nvidia.ok) {
    return { available: true, vendor: "nvidia", devices: nvidia.stdout.split("\n").filter(Boolean).map((line) => {
      const v = line.split(",").map((x) => x.trim());
      return { index: Number(v[0]), name: v[1] ?? null, driver_version: v[2] ?? null, memory_total_mib: Number(v[3]), memory_used_mib: Number(v[4]), memory_free_mib: Number(v[5]), utilization_gpu_percent: Number(v[6]), utilization_memory_percent: Number(v[7]), temperature_c: Number(v[8]), power_draw_w: Number(v[9]) };
    }) };
  }
  if (process.platform === "win32") {
    const result = await command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM,VideoProcessor | ConvertTo-Json -Compress"]);
    if (result.ok && result.stdout) {
      try {
        const raw = JSON.parse(result.stdout);
        const devices = (Array.isArray(raw) ? raw : [raw]).map((gpu) => ({ name: gpu.Name ?? null, driver_version: gpu.DriverVersion ?? null, adapter_ram_bytes: gpu.AdapterRAM ?? null, processor: gpu.VideoProcessor ?? null }));
        return { available: devices.length > 0, vendor: "windows", devices };
      } catch { /* fallback below */ }
    }
  }
  if (process.platform === "darwin") {
    const result = await command("system_profiler", ["SPDisplaysDataType", "-json"]);
    if (result.ok && result.stdout) {
      try {
        const data = JSON.parse(result.stdout) as { SPDisplaysDataType?: Array<Record<string, unknown>> };
        const devices = data.SPDisplaysDataType ?? [];
        return { available: devices.length > 0, vendor: "apple", devices };
      } catch { /* fallback below */ }
    }
  }
  return { available: false, vendor: null, devices: [] };
}

function getDesktopInfo() {
  if (process.platform === "win32") return { environment: "Windows", session_type: "interactive", display_server: "windows", gui_available: Boolean(process.env.SESSIONNAME || process.env.USERNAME), accessibility_bus: false };
  if (process.platform === "darwin") return { environment: "macOS", session_type: "interactive", display_server: "quartz", gui_available: true, accessibility_bus: false };
  const sessionType = process.env.XDG_SESSION_TYPE ?? null;
  const desktop = process.env.XDG_CURRENT_DESKTOP ?? process.env.XDG_SESSION_DESKTOP ?? null;
  return { environment: desktop, session_type: sessionType, display_server: sessionType === "wayland" ? "wayland" : sessionType === "x11" ? "x11" : process.env.WAYLAND_DISPLAY ? "wayland" : process.env.DISPLAY ? "x11" : null, gui_available: Boolean(process.env.WAYLAND_DISPLAY || process.env.DISPLAY), accessibility_bus: Boolean(process.env.AT_SPI_BUS_ADDRESS) };
}

async function getDisplayInfo() {
  if (process.platform === "win32") {
    const result = await command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_VideoController | Select-Object Name,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate | ConvertTo-Json -Compress"]);
    if (result.ok && result.stdout) { try { const raw = JSON.parse(result.stdout); return { displays: (Array.isArray(raw) ? raw : [raw]) }; } catch {} }
  }
  if (process.platform === "darwin") {
    const result = await command("system_profiler", ["SPDisplaysDataType", "-json"]);
    if (result.ok && result.stdout) { try { return { displays: JSON.parse(result.stdout).SPDisplaysDataType ?? [] }; } catch {} }
  }
  return { display: process.env.DISPLAY ?? null, wayland_display: process.env.WAYLAND_DISPLAY ?? null, session_type: process.env.XDG_SESSION_TYPE ?? null };
}

async function getRuntimeInfo() {
  const entries = await Promise.all([ ["bun", "bun"], ["node", "node"], ["python", "python3"], ["git", "git"], ["docker", "docker"], ["podman", "podman"], ["go", "go"], ["rustc", "rustc"] ].map(async ([name, cmd]) => [name, await commandVersion(cmd)] as const));
  return Object.fromEntries(entries);
}

function getNetworkInfo() {
  return { interfaces: Object.entries(os.networkInterfaces()).map(([name, addresses]) => ({ name, up: Boolean(addresses?.length), address_count: addresses?.length ?? 0, families: [...new Set((addresses ?? []).map((address) => address.family))] })) };
}

export async function getSystemInfo() {
  const [osInfo, gpu, disk, runtime, display] = await Promise.all([getOsInfo(), getGpuInfo(), getDiskInfo(), getRuntimeInfo(), getDisplayInfo()]);
  return { os: osInfo, cpu: getCpuInfo(), memory: getMemoryInfo(), gpu, disk, desktop: getDesktopInfo(), display, runtime, network: getNetworkInfo() };
}

export async function getHardwareInfo() {
  const [gpu, disk] = await Promise.all([getGpuInfo(), getDiskInfo()]);
  return { cpu: getCpuInfo(), memory: getMemoryInfo(), gpu, disk };
}

export async function getCapabilities() {
  const desktop = getDesktopInfo();
  const gpu = await getGpuInfo();
  const runtime = await getRuntimeInfo();
  return { screenshot: desktop.gui_available, desktop_gui: desktop.gui_available, wayland: desktop.display_server === "wayland", x11: desktop.display_server === "x11", accessibility_tree: desktop.accessibility_bus, clipboard: desktop.gui_available, nvidia_gpu: gpu.vendor === "nvidia", gpu_count: gpu.devices.length, runtimes: Object.fromEntries(Object.entries(runtime).map(([name, version]) => [name, Boolean(version)])) };
}

export { getOsInfo, getCpuInfo, getMemoryInfo, getGpuInfo, getDiskInfo, getDesktopInfo, getDisplayInfo, getRuntimeInfo, getNetworkInfo };
