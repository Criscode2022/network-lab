import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import type { LabJson } from '@netbench/engine';
import { getPool } from './db.ts';

export interface User {
  id: string;
  email: string;
  passwordHash: string | null;
  guest: boolean;
}

export interface SavedLab {
  id: string;
  userId: string | null;
  name: string;
  json: LabJson;
  updatedAt: string;
}

export interface Magic {
  token: string;
  email: string;
  exp: number;
}

const users = new Map<string, User>();
const usersByEmail = new Map<string, User>();
const labs = new Map<string, SavedLab>();
const magics = new Map<string, Magic>();

function cacheUser(user: User): User {
  users.set(user.id, user);
  usersByEmail.set(user.email, user);
  return user;
}

function cacheLab(row: SavedLab): SavedLab {
  labs.set(row.id, row);
  return row;
}

function userFromRow(row: Record<string, unknown>): User {
  return cacheUser({
    id: String(row.id),
    email: String(row.email),
    passwordHash: (row.password_hash as string | null) ?? null,
    guest: Boolean(row.guest),
  });
}

function labFromRow(row: Record<string, unknown>): SavedLab {
  const raw = row.json;
  const json = (typeof raw === 'string' ? JSON.parse(raw) : raw) as LabJson;
  return cacheLab({
    id: String(row.id),
    userId: (row.user_id as string | null) ?? null,
    name: String(row.name),
    json,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? new Date().toISOString()),
  });
}

/** Drop in-process maps so subsequent reads must hit Postgres (or the test pool). */
export function resetMemory(): void {
  users.clear();
  usersByEmail.clear();
  labs.clear();
  magics.clear();
}

export async function findUser(id: string): Promise<User | undefined> {
  const hit = users.get(id);
  if (hit) return hit;
  const pool = getPool();
  if (!pool) return undefined;
  const r = await pool.query('SELECT id, email, password_hash, guest FROM users WHERE id = $1', [id]);
  const row = r.rows[0];
  return row ? userFromRow(row) : undefined;
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const key = email.toLowerCase();
  const hit = usersByEmail.get(key);
  if (hit) return hit;
  const pool = getPool();
  if (!pool) return undefined;
  const r = await pool.query('SELECT id, email, password_hash, guest FROM users WHERE email = $1', [key]);
  const row = r.rows[0];
  return row ? userFromRow(row) : undefined;
}

export async function register(email: string, password: string): Promise<User> {
  const key = email.toLowerCase();
  if (await findUserByEmail(key)) throw new Error('email already registered');
  const user: User = {
    id: randomUUID(),
    email: key,
    passwordHash: await bcrypt.hash(password, 10),
    guest: false,
  };
  cacheUser(user);
  const pool = getPool();
  if (pool) {
    await pool.query(
      'INSERT INTO users (id, email, password_hash, guest) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING',
      [user.id, user.email, user.passwordHash, user.guest],
    );
    const again = await pool.query('SELECT id, email, password_hash, guest FROM users WHERE email = $1', [key]);
    const row = again.rows[0];
    if (row && String(row.id) !== user.id) {
      users.delete(user.id);
      throw new Error('email already registered');
    }
  }
  return user;
}

export async function login(email: string, password: string): Promise<User> {
  const user = await findUserByEmail(email);
  if (!user?.passwordHash) throw new Error('invalid credentials');
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error('invalid credentials');
  return user;
}

export function guestUser(): User {
  const user: User = { id: randomUUID(), email: `guest-${randomUUID().slice(0, 8)}@guest.local`, passwordHash: null, guest: true };
  users.set(user.id, user);
  return user;
}

export function issueMagic(email: string): string {
  const token = randomBytes(24).toString('hex');
  magics.set(token, { token, email: email.toLowerCase(), exp: Date.now() + 15 * 60_000 });
  return token;
}

export async function consumeMagic(token: string): Promise<User> {
  const m = magics.get(token);
  magics.delete(token);
  if (!m || m.exp < Date.now()) throw new Error('invalid or expired magic link');
  return (await findUserByEmail(m.email)) ?? register(m.email, randomBytes(12).toString('hex'));
}

export async function saveLab(userId: string | null, json: LabJson): Promise<SavedLab> {
  const id = json.id || randomUUID();
  const row: SavedLab = {
    id,
    userId,
    name: json.name,
    json: { ...json, id },
    updatedAt: new Date().toISOString(),
  };
  cacheLab(row);
  const pool = getPool();
  if (pool) {
    await pool.query(
      `INSERT INTO labs (id, user_id, name, json, updated_at) VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, json=EXCLUDED.json, user_id=EXCLUDED.user_id, updated_at=now()`,
      [row.id, userId, row.name, JSON.stringify(row.json)],
    );
  }
  return row;
}

export async function listLabs(userId: string): Promise<SavedLab[]> {
  const pool = getPool();
  if (pool) {
    const r = await pool.query(
      'SELECT id, user_id, name, json, updated_at FROM labs WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId],
    );
    return r.rows.map((row) => labFromRow(row));
  }
  return [...labs.values()].filter((l) => l.userId === userId);
}

export async function getLab(id: string): Promise<SavedLab | undefined> {
  const hit = labs.get(id);
  if (hit) return hit;
  const pool = getPool();
  if (!pool) return undefined;
  const r = await pool.query('SELECT id, user_id, name, json, updated_at FROM labs WHERE id = $1', [id]);
  const row = r.rows[0];
  return row ? labFromRow(row) : undefined;
}

export async function deleteLab(id: string, userId: string): Promise<boolean> {
  const l = await getLab(id);
  if (!l || l.userId !== userId) return false;
  labs.delete(id);
  const pool = getPool();
  if (pool) {
    await pool.query('DELETE FROM labs WHERE id = $1 AND user_id = $2', [id, userId]);
  }
  return true;
}
