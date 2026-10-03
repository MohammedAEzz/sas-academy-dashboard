import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createNeonAdapter } from "../api/_lib/db.js";

export function splitSql(sql) {
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return withoutComments.split(";").map((statement) => statement.trim()).filter(Boolean);
}

export async function migrate(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  const appliedRows = await db.query("SELECT version FROM schema_migrations");
  const applied = new Set(appliedRows.rows.map((row) => row.version));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    await db.transaction(async (tx) => {
      for (const statement of splitSql(sql)) await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
    });
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const db = createNeonAdapter(connectionString);
  try {
    await migrate(db);
    console.log("Migrations applied");
  } catch (error) {
    console.error("migration_failed", error?.code || error?.name || "Error");
    process.exit(1);
  } finally {
    await db.close();
  }
}
