import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import type { LabJson } from '@netbench/engine';
import { pool } from './db.ts';

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

export function findUser(id: string): User | undefined {
  return users.get(id);
}

export function findUserByEmail(email: string): User | undefined {
  return usersByEmail.get(email.toLowerCase());
}

export async function register(email: string, password: string): Promise<User> {
  const key = email.toLowerCase();
  if (usersByEmail.has(key)) throw new Error('email already registered');
  const user: User = {
    id: randomUUID(),
    email: key,
    passwordHash: await bcrypt.hash(password, 10),
    guest: false,
  };
  users.set(user.id, user);
  usersByEmail.set(key, user);
  if (pool) {
    await pool.query(
      'INSERT INTO users (id, email, password_hash, guest) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING',
      [user.id, user.email, user.passwordHash, user.guest],
    );
  }
  return user;
}

export async function login(email: string, password: string): Promise<User> {
  const user = findUserByEmail(email);
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
  return findUserByEmail(m.email) ?? register(m.email, randomBytes(12).toString('hex'));
}

export function saveLab(userId: string | null, json: LabJson): SavedLab {
  const row: SavedLab = {
    id: json.id || randomUUID(),
    userId,
    name: json.name,
    json: { ...json, id: json.id || randomUUID() },
    updatedAt: new Date().toISOString(),
  };
  row.json.id = row.id;
  labs.set(row.id, row);
  if (pool) {
    void pool.query(
      `INSERT INTO labs (id, user_id, name, json, updated_at) VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, json=EXCLUDED.json, updated_at=now()`,
      [row.id, userId, row.name, JSON.stringify(row.json)],
    );
  }
  return row;
}

export function listLabs(userId: string): SavedLab[] {
  return [...labs.values()].filter((l) => l.userId === userId);
}

export function getLab(id: string): SavedLab | undefined {
  return labs.get(id);
}

export function deleteLab(id: string, userId: string): boolean {
  const l = labs.get(id);
  if (!l || l.userId !== userId) return false;
  labs.delete(id);
  return true;
}
