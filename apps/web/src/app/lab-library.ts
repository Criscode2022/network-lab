import { Injectable, inject, signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Api, type LabJson, type SavedLab } from './api';

const LIST_CACHE_TTL_MS = 60_000;
const LOCAL_LABS_KEY = 'nb_my_labs';

type LocalLibrary = { v: 1; labs: SavedLab[] };

/** Curriculum labs use `lab-*`. User copies use `nb-*` (or any other non-curriculum id). */
export function isCustomLabId(id: string | undefined | null): boolean {
  return !!id && !id.startsWith('lab-');
}

export function newCustomLabId(name?: string): string {
  const slug =
    (name ?? 'lab')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 20) || 'lab';
  return `nb-${slug}-${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36).slice(-4)}`;
}

export function labBlurb(lab: SavedLab | LabJson | null | undefined): string {
  if (!lab) return '';
  const json = 'json' in lab ? lab.json : lab;
  return (json.description || json.goal || '').trim();
}

function asSaved(json: LabJson, userId: string | null, updatedAt = new Date().toISOString()): SavedLab {
  const id = json.id || newCustomLabId(json.name);
  return { id, userId, name: json.name, json: { ...json, id }, updatedAt };
}

function isSavedLab(row: unknown): row is SavedLab {
  if (!row || typeof row !== 'object') return false;
  const r = row as SavedLab;
  return typeof r.id === 'string' && typeof r.name === 'string' && !!r.json && typeof r.json === 'object';
}

/**
 * Named custom labs: browser-local for guests, GET /labs for signed-in users.
 * TTL + in-flight dedup apply only to the account list.
 */
@Injectable({ providedIn: 'root' })
export class LabLibrary {
  private readonly api = inject(Api);

  private readonly itemsSubject = new BehaviorSubject<SavedLab[]>([]);
  public readonly items$ = this.itemsSubject.asObservable();
  public readonly items = signal<SavedLab[]>([]);

  private cachedItems: SavedLab[] | null = null;
  private cacheFetchedAt = 0;
  private fetchInFlight: Promise<SavedLab[]> | null = null;

  public invalidateCache(): void {
    this.cachedItems = null;
    this.cacheFetchedAt = 0;
  }

  private isCacheFresh(): boolean {
    return this.cachedItems !== null && Date.now() - this.cacheFetchedAt < LIST_CACHE_TTL_MS;
  }

  private setCachedItems(items: SavedLab[]): void {
    this.cachedItems = items;
    this.cacheFetchedAt = Date.now();
    this.itemsSubject.next(items);
    this.items.set(items);
  }

  public async getAll(forceRefresh = false): Promise<SavedLab[]> {
    if (this.api.guest()) {
      const items = this.readLocal();
      this.setCachedItems(items);
      return items;
    }

    if (!forceRefresh && this.isCacheFresh()) {
      return this.cachedItems!;
    }

    if (!forceRefresh && this.fetchInFlight) {
      return this.fetchInFlight;
    }

    this.fetchInFlight = this.fetchAllFromApi().finally(() => {
      this.fetchInFlight = null;
    });

    return this.fetchInFlight;
  }

  public getById(id: string): SavedLab | undefined {
    return (
      this.itemsSubject.value.find((item) => item.id === id) ??
      this.cachedItems?.find((item) => item.id === id) ??
      this.readLocal().find((item) => item.id === id)
    );
  }

  public owns(id: string | undefined | null): boolean {
    return !!id && !!this.getById(id);
  }

  public async save(json: LabJson): Promise<SavedLab> {
    if (this.api.guest()) {
      const row = asSaved(json, null);
      const next = [row, ...this.readLocal().filter((item) => item.id !== row.id)];
      this.writeLocal(next);
      this.setCachedItems(next);
      return row;
    }

    const row = await this.api.saveLabAs({ ...json, id: json.id || newCustomLabId(json.name) });
    const prev = this.cachedItems ?? this.itemsSubject.value;
    this.setCachedItems([row, ...prev.filter((item) => item.id !== row.id)]);
    return row;
  }

  public async delete(id: string): Promise<void> {
    if (this.api.guest()) {
      const next = this.readLocal().filter((item) => item.id !== id);
      this.writeLocal(next);
      this.setCachedItems(next);
      return;
    }

    await this.api.deleteLab(id);
    this.setCachedItems((this.cachedItems ?? this.itemsSubject.value).filter((item) => item.id !== id));
  }

  /** After login/register: upload browser labs that are not curriculum ids. */
  public async promoteLocal(): Promise<number> {
    if (this.api.guest()) return 0;

    const seen = new Set<string>();
    const toUpload: LabJson[] = [];
    const push = (json: LabJson | null | undefined) => {
      if (!json?.id || !isCustomLabId(json.id) || seen.has(json.id)) return;
      seen.add(json.id);
      toUpload.push(json);
    };

    for (const row of this.readLocal()) push(row.json);
    push(this.api.readGuestLab());

    let n = 0;
    for (const json of toUpload) {
      try {
        await this.api.saveLabAs(json);
        n++;
      } catch {
        /* one failure should not block the rest */
      }
    }

    this.invalidateCache();
    await this.getAll(true);
    return n;
  }

  private async fetchAllFromApi(): Promise<SavedLab[]> {
    try {
      const rows = (await this.api.listLabs()).labs;
      this.setCachedItems(rows);
      return rows;
    } catch {
      const local = this.readLocal();
      this.setCachedItems(local);
      return local;
    }
  }

  private readLocal(): SavedLab[] {
    try {
      const raw = localStorage.getItem(LOCAL_LABS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as LocalLibrary;
        if (parsed?.v === 1 && Array.isArray(parsed.labs)) {
          return parsed.labs.filter(isSavedLab).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        }
      }
    } catch {
      /* ignore */
    }
    return this.seedFromGuest();
  }

  private seedFromGuest(): SavedLab[] {
    const guest = this.api.readGuestLab();
    if (!guest || !isCustomLabId(guest.id) || !guest.name) return [];
    const row = asSaved(guest, null);
    this.writeLocal([row]);
    return [row];
  }

  private writeLocal(labs: SavedLab[]): void {
    try {
      const snap: LocalLibrary = { v: 1, labs };
      localStorage.setItem(LOCAL_LABS_KEY, JSON.stringify(snap));
    } catch {
      /* quota / private mode */
    }
  }
}
