/**
 * Cree la table submissions et les index si la base est vide ou incomplete.
 * Usage: depuis le dossier backend -> npm run db:init
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "..", "src", "schema.sql");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL manquant. Copiez backend/.env.example vers backend/.env et configurez-la.");
    process.exit(1);
  }

  const sql = fs.readFileSync(schemaPath, "utf8");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    for (const stmt of statements) {
      await client.query(stmt);
    }
    console.log("OK: schema applique (table submissions + index).");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
