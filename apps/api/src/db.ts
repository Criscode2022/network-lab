import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
}

export interface Queryable {
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>;
}

const url = process.env.DATABASE_URL;
let pool: Queryable | null = url ? new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } }) : null;

export function getPool(): Queryable | null {
  return pool;
}

/** Test helper: swap the backing store (Neon pool or an in-memory fake). */
export function setPool(next: Queryable | null): void {
  pool = next;
}

export async function initDb(): Promise<void> {
  const p = getPool();
  if (!p) return;
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '../../../sql/schema.sql');
  const sql = readFileSync(schemaPath, 'utf8');
  await p.query(sql);
  console.log('Neon/Postgres schema ensured');
}
