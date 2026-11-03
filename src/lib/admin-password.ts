import { randomBytes, scryptSync } from "node:crypto";
import type { Database } from "bun:sqlite";

export function resetAdminPassword(database: Database, password: string): string {
  if (password.length < 12) throw new Error("Password must contain at least 12 characters.");
  const salt = randomBytes(16);
  const passwordHash = scryptSync(password, salt, 64).toString("hex");
  const admin = database.query("SELECT username FROM toolsmith_admin WHERE id = 1").get() as { username: string } | null;
  if (!admin) throw new Error("Toolsmith administrator is not configured yet.");
  const reset = database.transaction(() => {
    database.query("UPDATE toolsmith_admin SET salt = ?, password_hash = ? WHERE id = 1").run(salt.toString("hex"), passwordHash);
    database.query("DELETE FROM toolsmith_admin_sessions").run();
  });
  reset();
  return admin.username;
}
