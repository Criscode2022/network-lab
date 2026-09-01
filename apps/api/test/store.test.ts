import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPool, setPool } from '../src/db.ts';
import { findUser, getLab, listLabs, login, register, resetMemory, saveLab } from '../src/store.ts';
import { MemoryPool } from './fake-pool.ts';

describe('store reads from the pool after a memory flush', () => {
  const prev = getPool();
  const mem = new MemoryPool();

  beforeEach(() => {
    setPool(mem);
    mem.users = [];
    mem.labs = [];
    resetMemory();
  });

  afterEach(() => {
    resetMemory();
    setPool(prev);
  });

  it('login SELECTs the user after the in-memory map is cleared', async () => {
    const created = await register('alice@netbench.test', 'correct-horse');
    expect(mem.users).toHaveLength(1);
    resetMemory();
    expect(await findUser(created.id)).toMatchObject({ email: 'alice@netbench.test', guest: false });
    const u = await login('alice@netbench.test', 'correct-horse');
    expect(u.id).toBe(created.id);
  });

  it('listLabs and getLab SELECT after the in-memory map is cleared', async () => {
    const u = await register('bob@netbench.test', 'secret-pass');
    const saved = await saveLab(u.id, {
      schemaVersion: 1,
      id: 'lab-from-disk',
      name: 'Saved office',
      devices: [],
      links: [],
      checks: [],
    });
    expect(mem.labs).toHaveLength(1);
    resetMemory();
    const listed = await listLabs(u.id);
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe('Saved office');
    const got = await getLab(saved.id);
    expect(got?.json.id).toBe('lab-from-disk');
  });

  it('saveLab awaits the write (row is visible on the pool immediately)', async () => {
    const u = await register('cara@netbench.test', 'secret-pass');
    await saveLab(u.id, {
      schemaVersion: 1,
      id: 'awaited-lab',
      name: 'Await me',
      devices: [],
      links: [],
      checks: [],
    });
    expect(mem.labs.some((l) => l.id === 'awaited-lab')).toBe(true);
  });
});
