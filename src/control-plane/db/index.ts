import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";
import { config } from "../../lib/config";

const dataDir = resolve(
  process.env.TOOLSMITH_DATA_DIR ??
    process.env.OMP_DATA_DIR ??
    (config.nodeEnv === "development"
      ? "./data"
      : config.nodeEnv === "test"
        ? "./.test-data"
        : "/var/lib/omp-mcp"),
);

mkdirSync(dataDir, { recursive: true });

export const sqlite = new Database(resolve(dataDir, "control-plane.db"));
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

export const db = drizzle({ client: sqlite, schema });

migrate(db, {
  migrationsFolder: resolve(import.meta.dir, "migrations"),
});
