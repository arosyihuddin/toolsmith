#!/usr/bin/env bun
import {
  chmod,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { parse, stringify } from "yaml";

const HOME = homedir();
const ROOT = join(HOME, ".toolsmith");
const APP = join(ROOT, "app");
const BIN = join(ROOT, "bin");
const DATA = join(ROOT, "data");
const WORKSPACE = join(ROOT, "workspace");
const LOGS = join(ROOT, "logs");
const CONFIG = join(ROOT, "config");
const CONFIG_FILE = join(CONFIG, "config.yml");
const LEGACY_ENV_FILE = join(CONFIG, ".env");
const UNIT_DIR = join(HOME, ".config/systemd/user");
const UNIT_FILE = join(UNIT_DIR, "toolsmith.service");
const USER_BIN = join(HOME, ".local/bin");
const LAUNCHER = join(BIN, "toolsmith");
const BUN_BIN = join(BIN, "bun");
const REPOSITORY = "https://github.com/arosyihuddin/toolsmith.git";
const SERVICE = "toolsmith.service";
const args = process.argv.slice(2);
const command = args[0] ?? "help";

function run(
  cmd: string,
  cmdArgs: string[],
  options: { cwd?: string; quiet?: boolean } = {},
) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: options.cwd,
    stdio: options.quiet ? "ignore" : "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      "Command failed: " +
        cmd +
        " " +
        cmdArgs.join(" ") +
        " (exit " +
        result.status +
        ")",
    );
}
function systemctl(...cmdArgs: string[]) {
  run("systemctl", ["--user", ...cmdArgs]);
}
function print(message: string) {
  console.log("[toolsmith] " + message);
}
function ensureLinux() {
  if (process.platform !== "linux")
    throw new Error(
      "User service installation currently supports Linux with systemd.",
    );
  if (!existsSync("/run/systemd/system")) {
    throw new Error(
      "systemd is not running. Toolsmith requires a systemd-based Linux host.",
    );
  }
  const userManager = spawnSync("systemctl", ["--user", "show-environment"], {
    stdio: "ignore",
    env: process.env,
  });
  if (userManager.status !== 0)
    throw new Error(
      'systemd user manager is unavailable. Run install.sh to initialize it, or enable lingering with: sudo loginctl enable-linger "$USER"',
    );
}
async function findAvailablePort(start = 48765): Promise<number> {
  for (let port = start; port < start + 20; port++) {
    const available = await new Promise<boolean>((resolvePort) => {
      const server = createServer();
      server.once("error", () => resolvePort(false));
      server.listen(port, "127.0.0.1", () =>
        server.close(() => resolvePort(true)),
      );
    });
    if (available) return port;
  }
  throw new Error(
    "No available MCP port found in range " + start + "-" + (start + 19),
  );
}
async function writeConfig() {
  if (existsSync(CONFIG_FILE)) return;
  const legacy: Record<string, string> = {};
  if (existsSync(LEGACY_ENV_FILE)) {
    for (const line of (await readFile(LEGACY_ENV_FILE, "utf8")).split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match) legacy[match[1]!] = (match[2] ?? "").replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  const port = Number(legacy.MCP_HTTP_PORT) || await findAvailablePort();
  const config = {
    server: { host: legacy.MCP_HTTP_HOST || "127.0.0.1", port, path: legacy.MCP_HTTP_PATH || "/mcp", transport: legacy.MCP_TRANSPORT || "http" },
    security: {
      api_token: legacy.TOOLSMITH_API_TOKEN || legacy.OMP_API_TOKEN || randomBytes(32).toString("hex"),
      sudo_encryption_key: legacy.TOOLSMITH_SUDO_ENCRYPTION_KEY || legacy.OMP_SUDO_ENCRYPTION_KEY || randomBytes(32).toString("hex"),
    },
    oauth: {
      public_url: legacy.MCP_PUBLIC_URL || "",
      username: legacy.TOOLSMITH_OAUTH_USERNAME || legacy.OMP_OAUTH_USERNAME || "toolsmith",
      password: legacy.TOOLSMITH_OAUTH_PASSWORD || legacy.OMP_OAUTH_PASSWORD || "",
    },
    logging: { level: legacy.LOG_LEVEL || "info" },
  };
  await writeFile(CONFIG_FILE, stringify(config), { mode: 0o600 });
  await chmod(CONFIG_FILE, 0o600);
  if (existsSync(LEGACY_ENV_FILE)) {
    await rm(LEGACY_ENV_FILE, { force: true });
    print("Migrated existing credentials and settings from .env to config.yml.");
  }
}
async function installSource(sourceDir: string) {
  await mkdir(APP, { recursive: true });
  for (const name of ["src", "package.json", "bun.lock", "tsconfig.json"]) {
    const from = join(sourceDir, name);
    if (!existsSync(from))
      throw new Error("Missing " + name + " in source directory " + sourceDir);
    await rm(join(APP, name), { recursive: true, force: true });
    await cp(from, join(APP, name), { recursive: true });
  }
  await writeConfig();
  await rm(join(APP, "dist"), { recursive: true, force: true });
  print("Installing production dependencies...");
  run(BUN_BIN, ["install", "--production", "--frozen-lockfile"], { cwd: APP });
  print("Building Toolsmith...");
  run(BUN_BIN, ["run", "build"], { cwd: APP });
}
async function installLauncher() {
  await mkdir(BIN, { recursive: true });
  await mkdir(USER_BIN, { recursive: true });
  if (resolve(process.execPath) !== resolve(BUN_BIN)) {
    // Replace atomically: the existing Bun binary may still be running the
    // Toolsmith systemd service, so never truncate it in place.
    const temporaryBun = `${BUN_BIN}.tmp-${process.pid}`;
    try {
      await copyFile(process.execPath, temporaryBun);
      await chmod(temporaryBun, 0o755);
      await rename(temporaryBun, BUN_BIN);
    } finally {
      await rm(temporaryBun, { force: true });
    }
  }
  await chmod(BUN_BIN, 0o755);
  const launcher =
    '#!/bin/sh\nexec "$HOME/.toolsmith/bin/bun" "$HOME/.toolsmith/app/src/cli.ts" "$@"\n';
  await writeFile(LAUNCHER, launcher, { mode: 0o755 });
  await chmod(LAUNCHER, 0o755);
  await rm(join(USER_BIN, "toolsmith"), { force: true });
  await symlink(LAUNCHER, join(USER_BIN, "toolsmith"));
}

async function configureUserPath() {
  const shell = process.env.SHELL?.split("/").pop() ?? "";
  let configFile: string | undefined;
  let entry: string;
  let reload: string;

  switch (shell) {
    case "bash":
      configFile = join(HOME, ".bashrc");
      entry = 'export PATH="$HOME/.local/bin:$PATH"';
      reload = "source ~/.bashrc";
      break;
    case "zsh":
      configFile = join(HOME, ".zshrc");
      entry = 'export PATH="$HOME/.local/bin:$PATH"';
      reload = "source ~/.zshrc";
      break;
    case "fish":
      configFile = join(HOME, ".config/fish/config.fish");
      entry = 'fish_add_path "$HOME/.local/bin"';
      reload = "source ~/.config/fish/config.fish";
      break;
    default:
      print(`Could not detect a supported shell (${shell || "unknown"}). Add $HOME/.local/bin to PATH manually.`);
      return;
  }

  await mkdir(join(configFile, ".."), { recursive: true });
  const current = existsSync(configFile) ? await readFile(configFile, "utf8") : "";
  if (!current.includes(entry)) {
    await writeFile(configFile, `${current}${current.endsWith("\n") || !current ? "" : "\n"}${entry}\n`);
    print(`Added ~/.local/bin to PATH in ${configFile.replace(HOME, "~")}.`);
  } else {
    print(`PATH is already configured in ${configFile.replace(HOME, "~")}.`);
  }
  process.env.PATH = `${USER_BIN}:${process.env.PATH ?? ""}`;
  print(`Reload your shell configuration now: ${reload}`);
}
async function writeUnit() {
  await mkdir(UNIT_DIR, { recursive: true });
  const unit =
    "[Unit]\nDescription=Toolsmith MCP Server (user)\nAfter=network.target\n\n[Service]\nType=simple\nWorkingDirectory=" +
    APP +
    "\nEnvironment=TOOLSMITH_CONFIG=" +
    CONFIG_FILE +
    "\nEnvironment=HOME=" +
    HOME +
    "\nEnvironment=NODE_ENV=production\nEnvironment=PATH=" +
    BIN +
    ":/usr/local/bin:/usr/bin:/bin\nExecStart=" +
    BUN_BIN +
    " run dist/index.js\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n";
  await writeFile(UNIT_FILE, unit, { mode: 0o600 });
  systemctl("daemon-reload");
  systemctl("enable", SERVICE);
}
async function bootstrap(sourceDir?: string) {
  ensureLinux();
  for (const dir of [ROOT, BIN, DATA, WORKSPACE, LOGS, CONFIG])
    await mkdir(dir, { recursive: true });
  await installLauncher();
  await configureUserPath();
  const source = sourceDir ? resolve(sourceDir) : process.cwd();
  const isToolsmithSource =
    existsSync(join(source, "src/index.ts")) &&
    existsSync(join(source, "package.json")) &&
    JSON.parse(await readFile(join(source, "package.json"), "utf8")).name ===
      "toolsmith";
  if (isToolsmithSource) {
    await installSource(source);
  } else {
    const temp = join(ROOT, ".source-update");
    await rm(temp, { recursive: true, force: true });
    run("git", ["clone", "--depth", "1", "--branch", "main", REPOSITORY, temp]);
    await installSource(temp);
    await rm(temp, { recursive: true, force: true });
  }
  await writeUnit();
  systemctl("start", SERVICE);
  print("Installed and started.");
  const installedConfig = parse(await readFile(CONFIG_FILE, "utf8")) as { server?: { host?: string; port?: number } };
  const host = installedConfig.server?.host ?? "127.0.0.1";
  const port = installedConfig.server?.port ?? 48765;
  print("MCP endpoint: http://" + host + ":" + port + "/mcp");
  print("Configuration: " + CONFIG_FILE);
  print("Data: " + DATA);
}
async function update() {
  ensureLinux();
  if (!existsSync(APP))
    throw new Error("Toolsmith is not installed. Run: toolsmith install");
  const temp = join(ROOT, ".source-update");
  await rm(temp, { recursive: true, force: true });
  print("Fetching latest Toolsmith source...");
  run("git", ["clone", "--depth", "1", "--branch", "main", REPOSITORY, temp]);
  await installSource(temp);
  await rm(temp, { recursive: true, force: true });
  systemctl("restart", SERVICE);
  print(
    "Updated and restarted. Existing configuration and data were preserved.",
  );
}

async function promptHidden(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error("Password reset requires an interactive terminal.");
  }
  return await new Promise<string>((resolvePrompt, rejectPrompt) => {
    let value = "";
    let settled = false;
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) rejectPrompt(error);
      else resolvePrompt(value);
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") return finish(new Error("Password reset cancelled."));
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " " && char !== "\u007f") value += char;
      }
    };
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function resetAdminPasswordCommand() {
  process.env.NODE_ENV = "production";
  process.env.TOOLSMITH_CONFIG ??= CONFIG_FILE;
  const { sqlite } = await import("./control-plane/db");
  const { resetAdminPassword } = await import("./lib/admin-password");
  const password = await promptHidden("New admin password (min. 8 characters): ");
  const confirmation = await promptHidden("Confirm new password: ");
  if (password !== confirmation) throw new Error("Password confirmation does not match.");
  const username = resetAdminPassword(sqlite, password);
  print("Administrator password updated for '" + username + "'.");
  print("All existing administrator browser sessions have been revoked.");
  print("OAuth access and refresh tokens were not changed.");
}

async function uninstall(purge: boolean) {
  ensureLinux();
  try {
    systemctl("disable", "--now", SERVICE);
  } catch {
    /* service may be absent */
  }
  await rm(UNIT_FILE, { force: true });
  try {
    systemctl("daemon-reload");
  } catch {}
  await rm(join(USER_BIN, "toolsmith"), { force: true });
  if (purge) {
    await rm(ROOT, { recursive: true, force: true });
    print("Uninstalled and removed all ~/.toolsmith data.");
  } else {
    await rm(APP, { recursive: true, force: true });
    await rm(LAUNCHER, { force: true });
    await rm(BUN_BIN, { force: true });
    print(
      "Uninstalled application. Config, data, workspace, and logs were preserved in ~/.toolsmith.",
    );
  }
}
function help() {
  console.log(
    "Toolsmith CLI\n\nUsage:\n  toolsmith install [source-directory]\n  toolsmith update\n  toolsmith start\n  toolsmith stop\n  toolsmith restart\n  toolsmith status\n  toolsmith logs\n  toolsmith reset-password\n  toolsmith uninstall [--purge]\n  toolsmith version\n  toolsmith help\n\nAdmin password reset runs locally in an interactive terminal and revokes existing admin sessions.\nInstall uses ~/.toolsmith and a systemd user service; no sudo required.\nUninstall preserves user data. Use --purge to remove everything.",
  );
}
try {
  switch (command) {
    case "install":
      await bootstrap(args[1]);
      break;
    case "update":
      await update();
      break;
    case "start":
      systemctl("start", SERVICE);
      break;
    case "stop":
      systemctl("stop", SERVICE);
      break;
    case "restart":
      systemctl("restart", SERVICE);
      break;
    case "status":
      systemctl("status", SERVICE);
      break;
    case "logs":
      run("journalctl", ["--user", "-u", SERVICE, "-f"]);
      break;
    case "reset-password":
      await resetAdminPasswordCommand();
      break;
    case "uninstall":
      await uninstall(args.includes("--purge"));
      break;
    case "version": {
      const pkg = JSON.parse(await readFile(join(APP, "package.json"), "utf8"));
      console.log("Toolsmith " + pkg.version);
      break;
    }
    case "help":
    case "--help":
    case "-h":
      help();
      break;
    default:
      help();
      process.exitCode = 1;
  }
} catch (error) {
  console.error(
    "[toolsmith] " + (error instanceof Error ? error.message : String(error)),
  );
  process.exitCode = 1;
}
