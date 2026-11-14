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
const INSTALL_METADATA = join(ROOT, "install.json");
const LEGACY_ENV_FILE = join(CONFIG, ".env");
const UNIT_DIR = join(HOME, ".config/systemd/user");
const UNIT_FILE = join(UNIT_DIR, "toolsmith.service");
const USER_BIN = join(HOME, ".local/bin");
const LAUNCHER = join(BIN, "toolsmith");
const BUN_BIN = join(BIN, "bun");
const REPOSITORY = "https://github.com/arosyihuddin/toolsmith-mcp.git";
const RELEASE_API = "https://api.github.com/repos/arosyihuddin/toolsmith-mcp/releases/latest";
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
      api_token: legacy.TOOLSMITH_API_TOKEN || randomBytes(32).toString("hex"),
      sudo_encryption_key: legacy.TOOLSMITH_SUDO_ENCRYPTION_KEY || randomBytes(32).toString("hex"),
      setup_token: randomBytes(32).toString("base64url"),
    },
    oauth: {
      public_url: legacy.MCP_PUBLIC_URL || "",
      username: legacy.TOOLSMITH_OAUTH_USERNAME || "toolsmith",
      password: legacy.TOOLSMITH_OAUTH_PASSWORD || "",
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
  for (const name of ["src", "package.json", "bun.lock", "tsconfig.json", "vite.config.ts"]) {
    const from = join(sourceDir, name);
    if (!existsSync(from))
      throw new Error("Missing " + name + " in source directory " + sourceDir);
    await rm(join(APP, name), { recursive: true, force: true });
    await cp(from, join(APP, name), { recursive: true });
  }
  await writeConfig();
  await rm(join(APP, "dist"), { recursive: true, force: true });
  print("Installing build dependencies...");
  run(BUN_BIN, ["install", "--frozen-lockfile"], { cwd: APP });
  print("Building Toolsmith...");
  run(BUN_BIN, ["run", "build"], { cwd: APP });
  print("Pruning development dependencies...");
  run(BUN_BIN, ["install", "--production", "--frozen-lockfile"], { cwd: APP });
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

  switch (shell) {
    case "bash":
      configFile = join(HOME, ".bashrc");
      entry = 'export PATH="$HOME/.local/bin:$PATH"';
      break;
    case "zsh":
      configFile = join(HOME, ".zshrc");
      entry = 'export PATH="$HOME/.local/bin:$PATH"';
      break;
    case "fish":
      configFile = join(HOME, ".config/fish/config.fish");
      entry = 'fish_add_path "$HOME/.local/bin"';
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
    "\nEnvironment=TOOLSMITH_DATA_DIR=" +
    DATA +
    "\nEnvironment=NODE_ENV=production\nEnvironment=PATH=" +
    BIN +
    ":/usr/local/bin:/usr/bin:/bin\nExecStart=" +
    BUN_BIN +
    " run dist/index.js\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n";
  await writeFile(UNIT_FILE, unit, { mode: 0o600 });
  systemctl("daemon-reload");
  systemctl("enable", SERVICE);
}
async function cloneSource(channel: "stable" | "nightly", destination: string) {
  await rm(destination, { recursive: true, force: true });
  let ref = "main";
  let version: string | undefined;
  if (channel === "stable") {
    print("Checking latest stable GitHub Release...");
    const response = await fetch(RELEASE_API, {
      headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Unable to fetch latest stable release (GitHub API: ${response.status}).`);
    const release = await response.json() as { tag_name?: string; draft?: boolean; prerelease?: boolean };
    if (!release.tag_name || release.draft || release.prerelease || !/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(release.tag_name)) {
      throw new Error("GitHub returned an invalid or non-stable release tag.");
    }
    ref = release.tag_name;
    version = ref.replace(/^v/, "");
    print(`Downloading stable release ${ref}...`);
  } else {
    print("Fetching latest source from branch main (nightly)...");
  }
  run("git", ["clone", "--depth", "1", "--branch", ref, REPOSITORY, destination]);
  if (version) {
    const sourcePackage = JSON.parse(await readFile(join(destination, "package.json"), "utf8")) as { version?: string };
    if (sourcePackage.version !== version) throw new Error(`Release tag ${ref} does not match package version ${sourcePackage.version ?? "unknown"}.`);
  }
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: destination, encoding: "utf8" });
  if (revision.error || revision.status !== 0) throw revision.error ?? new Error("Unable to read source revision.");
  const commit = revision.stdout.trim();
  return { channel, ...(version ? { version } : {}), commit, ref };
}

async function writeInstallMetadata(metadata: { channel: string; version: string; commit: string; ref: string }) {
  await writeFile(INSTALL_METADATA, JSON.stringify({ ...metadata, updatedAt: new Date().toISOString() }, null, 2) + "\n", { mode: 0o600 });
}

async function readInstallMetadata() {
  try {
    return JSON.parse(await readFile(INSTALL_METADATA, "utf8")) as { channel?: string; version?: string; commit?: string; ref?: string };
  } catch {
    return undefined;
  }
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
  const temp = join(ROOT, ".source-update");
  let metadata: { channel: string; version: string; commit: string; ref: string };
  if (isToolsmithSource) {
    const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" });
    metadata = { channel: "local", version: JSON.parse(await readFile(join(source, "package.json"), "utf8")).version, commit: revision.status === 0 ? revision.stdout.trim() : "unknown", ref: "local" };
    await installSource(source);
  } else {
    const sourceMetadata = await cloneSource("stable", temp);
    await installSource(temp);
    metadata = { ...sourceMetadata, version: JSON.parse(await readFile(join(APP, "package.json"), "utf8")).version };
    await rm(temp, { recursive: true, force: true });
  }
  await writeInstallMetadata(metadata);
  await writeUnit();
  systemctl("start", SERVICE);
  const installedConfig = parse(await readFile(CONFIG_FILE, "utf8")) as { server?: { host?: string; port?: number } };
  const host = installedConfig.server?.host ?? "127.0.0.1";
  const port = installedConfig.server?.port ?? 48765;
  print("");
  print("Installation completed successfully.");
  print("");
  print("Service: Toolsmith is installed, enabled, and running.");
  print("MCP endpoint: http://" + host + ":" + port + "/mcp");
  print("Configuration: " + CONFIG_FILE);
  print("Data: " + DATA);
  const setupConfig = parse(await readFile(CONFIG_FILE, "utf8")) as { security?: { setup_token?: string } };
  const setupHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  print("");
  print("NEXT STEP: Activate the Toolsmith CLI in your current shell");
  print("  Run:");
  print("    source ~/.config/fish/config.fish");
  print("  Or use the full executable path:");
  print("    " + join(USER_BIN, "toolsmith") + " status");
  if (setupConfig.security?.setup_token) {
    print("");
    print("THEN: Complete initial administrator setup");
    print("  1. Open this URL in your browser:");
    print("     http://" + setupHost + ":" + port + "/");
    print("  2. Enter this one-time setup token on the setup page:");
    print("     " + setupConfig.security.setup_token);
    print("  3. Create your administrator username and password.");
    print("  The setup token is removed after the initial setup succeeds.");
  } else {
    print("");
    print("Initial administrator setup is already completed or not required.");
  }
  print("");
  print("Installation finished.");
  print("Then run: toolsmith status");
}
async function update(channel: "stable" | "nightly") {
  ensureLinux();
  if (!existsSync(APP))
    throw new Error("Toolsmith is not installed. Run: toolsmith install");
  const temp = join(ROOT, ".source-update");
  const sourceMetadata = await cloneSource(channel, temp);
  try {
    await installSource(temp);
    const version = JSON.parse(await readFile(join(APP, "package.json"), "utf8")).version as string;
    await writeInstallMetadata({ ...sourceMetadata, version });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  systemctl("restart", SERVICE);
  print(`Updated to ${channel === "stable" ? "stable release " + sourceMetadata.ref : "nightly " + sourceMetadata.commit.slice(0, 7)} and restarted.`);
  print("Existing configuration and data were preserved.");
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
  const { resetAdminPassword } = await import("./modules/auth/admin-password");
  const password = await promptHidden("New admin password (min. 8 characters): ");
  const confirmation = await promptHidden("Confirm new password: ");
  if (password !== confirmation) throw new Error("Password confirmation does not match.");
  const username = resetAdminPassword(sqlite, password);
  print("Administrator password updated for '" + username + "'.");
  print("All existing administrator browser sessions have been revoked.");
  print("OAuth access and refresh tokens were not changed.");
}
async function setupTokenCommand() {
  process.env.NODE_ENV = "production";
  process.env.TOOLSMITH_DATA_DIR ??= DATA;
  if (!existsSync(CONFIG_FILE)) throw new Error("Toolsmith is not installed. Run: toolsmith install");
  // Load the production database only after its environment and config path are set.
  const { sqlite } = await import("./control-plane/db");
  if (sqlite.query("SELECT id FROM toolsmith_admin WHERE id = 1").get()) {
    throw new Error("Initial setup is already completed. Setup token cannot be generated.");
  }
  const raw = await readFile(CONFIG_FILE, "utf8");
  const parsed = parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Toolsmith config is invalid.");
  }
  const config = parsed as Record<string, unknown>;
  const securityValue = config.security;
  const security =
    securityValue && typeof securityValue === "object" && !Array.isArray(securityValue)
      ? (securityValue as Record<string, unknown>)
      : {};
  security.setup_token = randomBytes(32).toString("base64url");
  config.security = security;
  const temp = CONFIG_FILE + ".tmp";
  await writeFile(temp, stringify(config), { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, CONFIG_FILE);
  await chmod(CONFIG_FILE, 0o600);
  print("Initial setup token (keep it private): " + String(security.setup_token));
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
    "Toolsmith CLI\n\nUsage:\n  toolsmith install [source-directory]\n  toolsmith update [--nightly]\n  toolsmith start\n  toolsmith stop\n  toolsmith restart\n  toolsmith status\n  toolsmith logs\n  toolsmith setup-token\n  toolsmith reset-password\n  toolsmith uninstall [--purge]\n  toolsmith version\n  toolsmith help\n\nThe setup-token command generates a one-time token when initial setup needs to be completed.\nAdmin password reset runs locally in an interactive terminal and revokes existing admin sessions.\nInstall uses ~/.toolsmith and a systemd user service; no sudo required.",
  );
}
try {
  switch (command) {
    case "install":
      await bootstrap(args[1]);
      break;
    case "update":
      if (args.slice(1).some((arg) => arg !== "--nightly")) throw new Error("Usage: toolsmith update [--nightly]");
      if (args.slice(1).filter((arg) => arg === "--nightly").length > 1) throw new Error("Usage: toolsmith update [--nightly]");
      await update(args.includes("--nightly") ? "nightly" : "stable");
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
    case "status": {
      const metadata = await readInstallMetadata();
      const pkg = JSON.parse(await readFile(join(APP, "package.json"), "utf8")) as { version: string };
      console.log(`Toolsmith ${pkg.version} (${metadata?.channel ?? "unknown"})`);
      if (metadata?.commit) console.log(`Commit: ${metadata.commit.slice(0, 7)}`);
      systemctl("status", SERVICE);
      break;
    }
    case "logs":
      run("journalctl", ["--user", "-u", SERVICE, "-f"]);
      break;
    case "setup-token":
      await setupTokenCommand();
      break;
    case "reset-password":
      await resetAdminPasswordCommand();
      break;
    case "uninstall":
      await uninstall(args.includes("--purge"));
      break;
    case "version": {
      const pkg = JSON.parse(await readFile(join(APP, "package.json"), "utf8")) as { version: string };
      const metadata = await readInstallMetadata();
      console.log(`Toolsmith ${pkg.version} (${metadata?.channel ?? "unknown"})`);
      if (metadata?.commit) console.log(`Commit: ${metadata.commit.slice(0, 7)}`);
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
