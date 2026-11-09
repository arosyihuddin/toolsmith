export interface DesktopApp {
  id: string;
  name: string;
  exec: string | null;
  desktop_file: string;
  categories: string[];
  terminal: boolean;
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

const applicationDirs = [
  "/usr/share/applications",
  "/usr/local/share/applications",
  `${process.env.HOME ?? ""}/.local/share/applications`,
].filter(Boolean);

function parseDesktopFile(path: string, content: string): DesktopApp | null {
  const entry = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    entry.set(line.slice(0, index), line.slice(index + 1));
  }

  if (entry.get("Type") !== "Application" || entry.get("NoDisplay") === "true") return null;

  const name = entry.get("Name");
  if (!name) return null;

  const fileName = path.split("/").pop() ?? path;
  return {
    id: fileName.replace(/\.desktop$/, ""),
    name,
    exec: entry.get("Exec") ?? null,
    desktop_file: path,
    categories: (entry.get("Categories") ?? "").split(";").filter(Boolean),
    terminal: entry.get("Terminal") === "true",
  };
}

export interface ListAppsOptions {
  query?: string;
  limit?: number;
}

export async function listLinuxApps(options: ListAppsOptions = {}): Promise<DesktopApp[]> {
  const apps = new Map<string, DesktopApp>();

  for (const directory of applicationDirs) {
    let files: string[];
    try {
      const output = await run("find", [directory, "-maxdepth", "1", "-type", "f", "-name", "*.desktop"]);
      files = output.split(/\r?\n/).filter(Boolean);
    } catch {
      continue;
    }

    for (const path of files) {
      try {
        const content = await Bun.file(path).text();
        const app = parseDesktopFile(path, content);
        if (app && !apps.has(app.id)) apps.set(app.id, app);
      } catch {
        // Ignore unreadable or malformed desktop entries.
      }
    }
  }

  const query = options.query?.trim().toLocaleLowerCase();
  const filtered = [...apps.values()]
    .filter((app) => !query || app.name.toLocaleLowerCase().includes(query) || app.id.toLocaleLowerCase().includes(query) || app.exec?.toLocaleLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));

  return options.limit === undefined ? filtered : filtered.slice(0, options.limit);
}
