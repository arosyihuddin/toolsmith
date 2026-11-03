import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const file = process.env.SETUP_ENV_FILE;
if (!file) throw new Error("SETUP_ENV_FILE is required");
const values: Record<string, string> = {
  TOOLSMITH_API_TOKEN: process.env.TOOLSMITH_SETUP_API_TOKEN || randomBytes(32).toString("hex"),
  TOOLSMITH_SUDO_ENCRYPTION_KEY: process.env.TOOLSMITH_SETUP_SUDO_KEY || randomBytes(32).toString("hex"),
  MCP_PUBLIC_URL: process.env.TOOLSMITH_SETUP_OAUTH_URL || "",
  TOOLSMITH_OAUTH_USERNAME: process.env.TOOLSMITH_SETUP_OAUTH_USER || "toolsmith",
  TOOLSMITH_OAUTH_PASSWORD: process.env.TOOLSMITH_SETUP_OAUTH_PASSWORD || "",
};
const old = await readFile(file, "utf8");
const lines = old.split(/\r?\n/).filter((line) => {
  const match = line.match(/^([A-Z0-9_]+)=/);
  if (!match || !(match[1] in values)) return true;
  return false;
});
if (values.MCP_PUBLIC_URL) {
  const url = new URL(values.MCP_PUBLIC_URL);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("MCP_PUBLIC_URL must be an HTTPS origin without a path, query, or fragment.");
  }
}
for (const [key, value] of Object.entries(values)) {
  if (key === "TOOLSMITH_API_TOKEN" || key === "TOOLSMITH_SUDO_ENCRYPTION_KEY" || key === "MCP_PUBLIC_URL") lines.push(`${key}=${value}`);
  else lines.push(`${key}=${JSON.stringify(value).replaceAll("$", "\\$").replaceAll("`", "\\`")}`);
}
await writeFile(file, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o640 });
