import { accessSync, constants, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { workspacePrefs } from "./db/schema";

export type RootCommandRule = {
  command: string;
  args: string[];
  enabled: boolean;
};
type StoredRootConfig = {
  rules: RootCommandRule[];
  encryptedPassword?: string;
};
const KEY = "root-command-config";

function encryptionKey(): Buffer {
  const value =
    process.env.TOOLSMITH_SUDO_ENCRYPTION_KEY ??
    process.env.OMP_SUDO_ENCRYPTION_KEY;
  if (!value || value.length < 32)
    throw new Error(
      "TOOLSMITH_SUDO_ENCRYPTION_KEY (atau OMP_SUDO_ENCRYPTION_KEY lama) harus diatur (minimal 32 karakter) sebelum menyimpan password sudo.",
    );
  return Buffer.from(value, "utf8").subarray(0, 32);
}
function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}
function decrypt(value: string): string {
  const [iv, tag, data] = value.split(".");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
function readStored(): StoredRootConfig {
  const row = db
    .select()
    .from(workspacePrefs)
    .where(eq(workspacePrefs.key, KEY))
    .get();
  const defaultRules = (): RootCommandRule[] => [
    { command: "shutdown", args: ["now"], enabled: false },
    { command: "reboot", args: ["now"], enabled: false },
  ];
  if (!row) {
    try {
      const seeded = { rules: defaultRules() };
      writeStored(seeded);
      return seeded;
    } catch {
      return { rules: [] };
    }
  }
  try {
    const parsed = JSON.parse(row.value) as StoredRootConfig;
    const storedRules = Array.isArray(parsed.rules) ? parsed.rules : [];
    const rules = storedRules.map((rule) => ({
      ...rule,
      command: basename(rule.command),
    }));
    if (
      rules.some((rule, index) => rule.command !== storedRules[index]?.command)
    ) {
      writeStored({
        rules,
        ...(parsed.encryptedPassword
          ? { encryptedPassword: parsed.encryptedPassword }
          : {}),
      });
    }
    const oldDefaults = [
      ["status", "omp-mcp"],
      ["restart", "omp-mcp"],
      ["status", "omp-mcp-browser-relay"],
      ["restart", "omp-mcp-browser-relay"],
      ["status", "ydotoold"],
      ["restart", "ydotoold"],
    ];
    const isOldSeed =
      rules.length === oldDefaults.length &&
      rules.every(
        (rule, index) =>
          basename(rule.command) === "systemctl" &&
          JSON.stringify(rule.args) === JSON.stringify(oldDefaults[index]) &&
          rule.enabled === false,
      );
    if (isOldSeed) {
      const migrated = {
        rules: defaultRules(),
        ...(parsed.encryptedPassword
          ? { encryptedPassword: parsed.encryptedPassword }
          : {}),
      };
      writeStored(migrated);
      return migrated;
    }
    return {
      rules,
      ...(parsed.encryptedPassword
        ? { encryptedPassword: parsed.encryptedPassword }
        : {}),
    };
  } catch {
    return { rules: [] };
  }
}
function writeStored(value: StoredRootConfig) {
  const updatedAt = new Date().toISOString();
  db.insert(workspacePrefs)
    .values({ key: KEY, value: JSON.stringify(value), updatedAt })
    .onConflictDoUpdate({
      target: workspacePrefs.key,
      set: { value: JSON.stringify(value), updatedAt },
    })
    .run();
}
const TRUSTED_COMMAND_DIRS = ["/usr/bin", "/usr/sbin", "/bin", "/sbin"];
const BLOCKED_COMMANDS = new Set([
  "sh",
  "bash",
  "dash",
  "zsh",
  "fish",
  "env",
  "python",
  "python2",
  "python3",
  "perl",
  "ruby",
  "node",
  "php",
  "busybox",
]);
function resolveTrustedCommand(input: string): string {
  if (!input || input.includes("\0") || input.includes(".."))
    throw new Error("Nama command tidak valid.");
  const name = basename(input);
  if (BLOCKED_COMMANDS.has(name) || !/^[a-zA-Z0-9_.+-]+$/.test(name))
    throw new Error(
      "Gunakan nama command sederhana; shell dan interpreter tidak diizinkan.",
    );
  const candidates = isAbsolute(input)
    ? [input]
    : TRUSTED_COMMAND_DIRS.map((dir) => join(dir, name));
  for (const candidate of candidates) {
    try {
      const resolved = realpathSync(candidate);
      const parent = realpathSync(dirname(resolved));
      const candidateParent = realpathSync(dirname(candidate));
      if (!TRUSTED_COMMAND_DIRS.some((dir) => parent === realpathSync(dir)))
        continue;
      if (
        !TRUSTED_COMMAND_DIRS.some(
          (dir) => candidateParent === realpathSync(dir),
        )
      )
        continue;
      const systemctlAlias =
        ["shutdown", "reboot"].includes(name) &&
        basename(resolved) === "systemctl";
      if (basename(resolved) !== name && !systemctlAlias) continue;
      accessSync(resolved, constants.X_OK);
      // Preserve systemd aliases because systemctl behavior depends on argv[0].
      return systemctlAlias ? candidate : resolved;
    } catch {
      /* Try the next trusted system directory. */
    }
  }
  throw new Error(
    `Command '${name}' tidak ditemukan di direktori sistem tepercaya atau tidak executable.`,
  );
}
export function getRootCommandConfig() {
  const value = readStored();
  const key =
    process.env.TOOLSMITH_SUDO_ENCRYPTION_KEY ??
    process.env.OMP_SUDO_ENCRYPTION_KEY;
  return {
    rules: value.rules,
    passwordConfigured: Boolean(value.encryptedPassword),
    encryptionConfigured: Boolean(key && key.length >= 32),
  };
}
export function saveRootCommandConfig(input: {
  rules: RootCommandRule[];
  password?: string;
  clearPassword?: boolean;
}) {
  if (!Array.isArray(input.rules) || input.rules.length > 100)
    throw new Error("Aturan harus berupa array maksimal 100 item.");
  const rules = input.rules.map((rule) => {
    if (
      !rule ||
      typeof rule.command !== "string" ||
      !Array.isArray(rule.args) ||
      rule.args.length > 32 ||
      rule.args.some(
        (arg) =>
          typeof arg !== "string" || arg.includes("\0") || arg.length > 256,
      ) ||
      typeof rule.enabled !== "boolean"
    ) {
      throw new Error(
        "Aturan tidak valid. Gunakan nama command, argumen eksplisit, dan tanpa wildcard.",
      );
    }
    const name = rule.command.trim();
    resolveTrustedCommand(name);
    const command = basename(name);
    return { command, args: [...rule.args], enabled: rule.enabled };
  });
  const current = readStored();
  let encryptedPassword = current.encryptedPassword;
  if (input.clearPassword) encryptedPassword = undefined;
  if (typeof input.password === "string" && input.password.length)
    encryptedPassword = encrypt(input.password);
  writeStored({ rules, ...(encryptedPassword ? { encryptedPassword } : {}) });
  return getRootCommandConfig();
}
export function saveRootPassword(input: {
  password?: string;
  clearPassword?: boolean;
}) {
  const current = readStored();
  let encryptedPassword = current.encryptedPassword;
  if (input.clearPassword) encryptedPassword = undefined;
  if (typeof input.password === "string" && input.password.length > 0) {
    if (input.password.length > 4096)
      throw new Error("Password sudo terlalu panjang.");
    encryptedPassword = encrypt(input.password);
  } else if (!input.clearPassword) {
    throw new Error("Masukkan password sudo baru atau pilih hapus password.");
  }
  writeStored({
    rules: current.rules,
    ...(encryptedPassword ? { encryptedPassword } : {}),
  });
  return getRootCommandConfig();
}

export function isRootCommandWhitelisted(
  command: unknown,
  args: unknown,
): boolean {
  if (
    typeof command !== "string" ||
    !/^[a-zA-Z0-9_.+-]+$/.test(command) ||
    command.includes("..")
  )
    return false;
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string"))
    return false;
  const config = readStored();
  return (
    config.rules.filter(
      (rule) =>
        rule.enabled &&
        basename(rule.command) === command &&
        rule.args.length === args.length &&
        rule.args.every((arg, index) => arg === args[index]),
    ).length === 1
  );
}

export async function executeRootCommand(
  command: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const config = readStored();
  if (!/^[a-zA-Z0-9_.+-]+$/.test(command) || command.includes(".."))
    throw new Error("Gunakan nama command, bukan path executable.");
  if (
    !Array.isArray(args) ||
    args.length > 32 ||
    args.some(
      (arg) =>
        typeof arg !== "string" || arg.length > 256 || arg.includes("\0"),
    )
  )
    throw new Error("Argumen command tidak valid.");
  const matches = config.rules.filter(
    (rule) =>
      rule.enabled &&
      basename(rule.command) === command &&
      rule.args.length === args.length &&
      rule.args.every((arg, index) => arg === args[index]),
  );
  if (matches.length > 1)
    throw new Error(
      "Perintah root ditolak: kombinasi command dan argumen ambigu.",
    );
  const executable = resolveTrustedCommand(
    matches.length === 1 ? matches[0].command : command,
  );
  if (!config.encryptedPassword)
    throw new Error(
      "Password sudo belum dikonfigurasi untuk instance Toolsmith ini.",
    );
  const password = decrypt(config.encryptedPassword);
  if (signal?.aborted)
    throw new Error("Perintah root dibatalkan sebelum dijalankan.");
  return await new Promise((resolve, reject) => {
    const child = spawn(
      "sudo",
      ["-S", "-k", "-p", "", "--", executable, ...args],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8" },
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    let aborted = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (
      error?: Error,
      result?: { exitCode: number | null; stdout: string; stderr: string },
    ) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result!);
    };
    const terminate = () => {
      try {
        child.kill("SIGTERM");
      } catch {}
      forceKillTimer ??= setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, 1_000);
    };
    const abort = () => {
      aborted = true;
      terminate();
    };
    timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, 30_000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < 16000)
        stdout += chunk.toString("utf8").slice(0, 16000 - stdout.length);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 8000)
        stderr += chunk.toString("utf8").slice(0, 8000 - stderr.length);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (aborted) return finish(new Error("Perintah root dibatalkan."));
      if (timedOut)
        return finish(
          new Error("Perintah root melewati batas waktu 30 detik."),
        );
      finish(undefined, {
        exitCode: code,
        stdout,
        stderr: code === 0 ? stderr : stderr || "sudo command failed",
      });
    });
    child.stdin.end(password + "\n");
  });
}
