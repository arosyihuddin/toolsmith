import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../src/control-plane/db/schema";

const migrationFolder = resolve(import.meta.dir, "../src/control-plane/db/migrations");
const migrationSql = readFileSync(join(migrationFolder, "0000_init.sql"), "utf8");
const journal = JSON.parse(readFileSync(join(migrationFolder, "meta/_journal.json"), "utf8")) as {
  entries: Array<{ when: number }>;
};

function withDatabase(run: (sqlite: Database) => void) {
  const directory = mkdtempSync(join(tmpdir(), "toolsmith-migrations-"));
  const sqlite = new Database(join(directory, "control-plane.db"));
  try {
    run(sqlite);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("applies the consolidated initial migration to a fresh database", () => {
  withDatabase((sqlite) => {
    migrate(drizzle({ client: sqlite, schema }), { migrationsFolder: migrationFolder });

    const tables = (sqlite
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>)
      .map((row) => row.name);

    expect(tables).toContain("oauth_clients");
    expect(tables).toContain("oauth_codes");
    expect(tables).toContain("oauth_tokens");
    expect(tables).toContain("tool_call_logs");
    expect(tables).toContain("tool_permission_groups");
    expect(tables).toContain("workspace_recents");
    expect(sqlite.query("SELECT COUNT(*) AS count FROM tool_permission_groups").get()).toEqual({ count: 3 });
    expect(sqlite.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: 1 });
  });
});

test("re-applies the baseline safely to an existing database without overwriting settings", () => {
  withDatabase((sqlite) => {
    sqlite.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric);");
    for (const statement of migrationSql.split("--> statement-breakpoint")) {
      if (statement.trim()) sqlite.exec(statement);
    }

    sqlite.query("UPDATE tool_permission_groups SET permission = ? WHERE section = ?").run("blocked", "read_only");
    sqlite
      .query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run("previous-migration-history", journal.entries[0]!.when - 1);

    migrate(drizzle({ client: sqlite, schema }), { migrationsFolder: migrationFolder });

    expect(sqlite.query("SELECT permission FROM tool_permission_groups WHERE section = ?").get("read_only")).toEqual({ permission: "blocked" });
    expect(sqlite.query("SELECT COUNT(*) AS count FROM tool_permission_groups").get()).toEqual({ count: 3 });
    expect(sqlite.query("SELECT COUNT(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: 2 });
  });
});
