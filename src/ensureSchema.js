import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "schema.sql");

/**
 * Applique schema.sql (CREATE TABLE / index IF NOT EXISTS).
 * Desactiver : SKIP_AUTO_SCHEMA=1 dans .env (ex. production avec migrations gerees a part).
 */
export async function ensureSchema() {
  if (process.env.SKIP_AUTO_SCHEMA === "1") {
    console.log("SKIP_AUTO_SCHEMA=1 : pas d'application automatique du schema.");
    return;
  }

  const sql = fs.readFileSync(schemaPath, "utf8");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  const client = await pool.connect();
  try {
    for (const stmt of statements) {
      await client.query(stmt);
    }
  } finally {
    client.release();
  }

  console.log("Base OK : table submissions et index verifies / crees.");
}
