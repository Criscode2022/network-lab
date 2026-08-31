import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = process.env.DATABASE_URL;
export const pool = url ? new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } }) : null;

export async function initDb(): Promise<void> {
  if (!pool) return;
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '../../../sql/schema.sql');
  const sql = readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  console.log('Neon/Postgres schema ensured');
}
