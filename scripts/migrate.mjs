import { readdir, readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import pg from "pg";

async function migrate() {
  try {
    loadEnvFile();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!process.env.DATABASE_URL) {
    if (process.argv.includes("--if-configured")) return;
    throw new Error("DATABASE_URL is required.");
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(194966147)");
    await client.query("CREATE TABLE IF NOT EXISTS fitness_migration (name text PRIMARY KEY)");
    for (const name of (await readdir("migrations")).filter((name) => /^\d+-.+\.sql$/.test(name)).sort()) {
      if ((await client.query("SELECT 1 FROM fitness_migration WHERE name = $1", [name])).rowCount) continue;
      await client.query(await readFile(`migrations/${name}`, "utf8"));
      await client.query("INSERT INTO fitness_migration (name) VALUES ($1)", [name]);
    }
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
}

migrate().catch(() => {
  console.error("Fitness database migration failed.");
  process.exitCode = 1;
});
