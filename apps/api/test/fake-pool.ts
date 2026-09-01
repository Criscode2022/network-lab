import type { Queryable, QueryResult } from '../src/db.ts';

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  guest: boolean;
}

interface LabRow {
  id: string;
  user_id: string | null;
  name: string;
  json: unknown;
  updated_at: Date;
}

/** In-memory stand-in for Neon so SELECT-after-restart tests run without DATABASE_URL. */
export class MemoryPool implements Queryable {
  users: UserRow[] = [];
  labs: LabRow[] = [];

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (s.startsWith('insert into users')) {
      const [id, email, password_hash, guest] = params as [string, string, string | null, boolean];
      if (this.users.some((u) => u.email === email)) return { rows: [], rowCount: 0 };
      this.users.push({ id, email, password_hash, guest: Boolean(guest) });
      return { rows: [], rowCount: 1 };
    }
    if (s.includes('from users') && s.includes('where email')) {
      const rows = this.users.filter((u) => u.email === params[0]) as unknown as Record<string, unknown>[];
      return { rows, rowCount: rows.length };
    }
    if (s.includes('from users') && s.includes('where id')) {
      const rows = this.users.filter((u) => u.id === params[0]) as unknown as Record<string, unknown>[];
      return { rows, rowCount: rows.length };
    }
    if (s.startsWith('insert into labs')) {
      const [id, user_id, name, json] = params as [string, string | null, string, string];
      const parsed = typeof json === 'string' ? JSON.parse(json) : json;
      const row: LabRow = { id, user_id, name, json: parsed, updated_at: new Date() };
      const i = this.labs.findIndex((l) => l.id === id);
      if (i >= 0) this.labs[i] = row;
      else this.labs.push(row);
      return { rows: [], rowCount: 1 };
    }
    if (s.includes('from labs') && s.includes('where user_id')) {
      const rows = this.labs
        .filter((l) => l.user_id === params[0])
        .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime()) as unknown as Record<string, unknown>[];
      return { rows, rowCount: rows.length };
    }
    if (s.includes('from labs') && s.includes('where id')) {
      const rows = this.labs.filter((l) => l.id === params[0]) as unknown as Record<string, unknown>[];
      return { rows, rowCount: rows.length };
    }
    if (s.startsWith('delete from labs')) {
      const before = this.labs.length;
      this.labs = this.labs.filter((l) => !(l.id === params[0] && l.user_id === params[1]));
      return { rows: [], rowCount: before - this.labs.length };
    }
    if (s.includes('create table') || s.includes('create index')) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`MemoryPool unhandled SQL: ${sql}`);
  }
}
