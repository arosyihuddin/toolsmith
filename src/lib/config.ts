import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const userRoot = join(homedir(), ".toolsmith");
const nodeEnv = process.env.NODE_ENV;
if (!nodeEnv) {
  throw new Error("NODE_ENV is required. Start with `bun run dev` for development or `bun run start` for production.");
}
if (nodeEnv !== "development" && nodeEnv !== "production" && nodeEnv !== "test") {
  throw new Error(`Invalid NODE_ENV: ${nodeEnv}. Expected development, production, or test.`);
}
export const configFilePath = process.env.TOOLSMITH_CONFIG ?? (nodeEnv === "production" ? join(userRoot, "config", "config.yml") : resolve(import.meta.dir, "../../config.yml"));
type UserConfig = { server?: { host?: string; port?: number; path?: string; transport?: "stdio" | "http" | "both" }; security?: { api_token?: string; sudo_encryption_key?: string }; oauth?: { public_url?: string; username?: string; password?: string }; logging?: { level?: string; directory?: string } };
function loadUserConfig(): UserConfig {
  if (!existsSync(configFilePath)) return {};
  let value: unknown;
  try { value = parse(readFileSync(configFilePath, "utf8")); } catch (error) { throw new Error("Unable to parse Toolsmith config at " + configFilePath + ": " + String(error)); }
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Toolsmith config at " + configFilePath + ": expected a YAML mapping.");
  return value as UserConfig;
}
const userConfig = loadUserConfig();
const setDefault = (key: string, value: unknown) => { if (process.env[key] === undefined && value !== undefined && value !== null) process.env[key] = String(value); };
setDefault("MCP_TRANSPORT", userConfig.server?.transport);
setDefault("MCP_HTTP_HOST", userConfig.server?.host);
setDefault("MCP_HTTP_PORT", userConfig.server?.port);
setDefault("MCP_HTTP_PATH", userConfig.server?.path);
setDefault("TOOLSMITH_API_TOKEN", userConfig.security?.api_token);
setDefault("TOOLSMITH_SUDO_ENCRYPTION_KEY", userConfig.security?.sudo_encryption_key);
setDefault("MCP_PUBLIC_URL", userConfig.oauth?.public_url);
setDefault("TOOLSMITH_OAUTH_USERNAME", userConfig.oauth?.username);
setDefault("TOOLSMITH_OAUTH_PASSWORD", userConfig.oauth?.password);
setDefault("LOG_LEVEL", userConfig.logging?.level);
setDefault("TOOLSMITH_LOG_DIR", userConfig.logging?.directory);
if (existsSync(configFilePath) && nodeEnv === "production") { setDefault("TOOLSMITH_DATA_DIR", join(userRoot, "data")); setDefault("TOOLSMITH_TERMINAL_ROOT", join(userRoot, "workspace")); }
const transport = process.env.MCP_TRANSPORT ?? "http";
if (transport !== "stdio" && transport !== "http" && transport !== "both") throw new Error("Invalid MCP_TRANSPORT: " + transport + ". Expected stdio, http, or both.");
export const config = { nodeEnv, logLevel: process.env.LOG_LEVEL ?? "info", logDirectory: process.env.TOOLSMITH_LOG_DIR ? resolve(process.env.TOOLSMITH_LOG_DIR) : undefined, defaultCwd: process.env.TOOLSMITH_DEFAULT_CWD ?? (nodeEnv === "development" || nodeEnv === "test" ? process.cwd() : join(userRoot, "workspace")), transport, httpHost: process.env.MCP_HTTP_HOST ?? "127.0.0.1", httpPort: Number(process.env.MCP_HTTP_PORT ?? "48765"), httpPath: process.env.MCP_HTTP_PATH ?? "/mcp" } as const;
