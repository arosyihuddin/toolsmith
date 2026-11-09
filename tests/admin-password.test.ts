import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes, scryptSync } from "node:crypto";
import { resetAdminPassword } from "../src/modules/auth/admin-password";

describe("resetAdminPassword", () => {
  let database: Database;

  afterEach(() => database?.close());

  test("updates the administrator password and revokes browser sessions", () => {
    database = new Database(":memory:");
    database.exec(`
      CREATE TABLE toolsmith_admin (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT NOT NULL UNIQUE,
        salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE toolsmith_admin_sessions (
        token_hash TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
    `);
    const oldSalt = randomBytes(16);
    database.query("INSERT INTO toolsmith_admin VALUES (1, ?, ?, ?, ?)").run(
      "admin", oldSalt.toString("hex"),
      scryptSync("old-password-123", oldSalt, 64).toString("hex"), 1,
    );
    database.query("INSERT INTO toolsmith_admin_sessions VALUES (?, ?)").run("old-session-hash", 9999999999);

    expect(resetAdminPassword(database, "12345678")).toBe("admin");
    const row = database.query("SELECT salt, password_hash FROM toolsmith_admin WHERE id = 1").get() as {
      salt: string; password_hash: string;
    };
    expect(scryptSync("12345678", Buffer.from(row.salt, "hex"), 64).toString("hex"))
      .toBe(row.password_hash);
    expect(database.query("SELECT COUNT(*) AS count FROM toolsmith_admin_sessions").get())
      .toEqual({ count: 0 });
  });

  test("rejects short passwords without modifying the account", () => {
    database = new Database(":memory:");
    database.exec(`
      CREATE TABLE toolsmith_admin (
        id INTEGER PRIMARY KEY, username TEXT, salt TEXT, password_hash TEXT, created_at INTEGER
      );
      CREATE TABLE toolsmith_admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER);
    `);
    database.query("INSERT INTO toolsmith_admin VALUES (1, 'admin', 'salt', 'hash', 1)").run();
    expect(() => resetAdminPassword(database, "1234567")).toThrow("at least 8 characters");
    expect(database.query("SELECT password_hash FROM toolsmith_admin WHERE id = 1").get())
      .toEqual({ password_hash: "hash" });
  });
});
