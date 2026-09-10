import { Injectable, inject, signal } from '@angular/core';
import { Api, type LabJson } from './api';

const MAX = 40;

function cloneLab(lab: LabJson): LabJson {
  return structuredClone(lab);
}

/** Topology + device config that undo should treat as the lab. */
function fingerprint(lab: LabJson): string {
  const devices = [...lab.devices]
    .map((d) => ({
      name: d.name,
      kind: d.kind,
      switchProfile: d.switchProfile ?? '',
      x: d.x,
      y: d.y,
      startup: d.startup ?? [],
      post: d.post ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const links = [...lab.links]
    .map((l) => ({ a: l.a, b: l.b, cable: l.cable ?? 'ethernet' }))
    .sort((a, b) => `${a.a}|${a.b}`.localeCompare(`${b.a}|${b.b}`));
  return JSON.stringify({ devices, links });
}

@Injectable({ providedIn: 'root' })
export class LabHistory {
  private readonly api = inject(Api);

  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  readonly busy = signal(false);

  private past: LabJson[] = [];
  private future: LabJson[] = [];
  private baseline: LabJson | null = null;
  private pendingBefore: LabJson | null = null;
  private applying = false;
  private depth = 0;
  private chain: Promise<void> = Promise.resolve();

  /** Call after opening a different lab (clears stacks). */
  async seed(): Promise<void> {
    if (this.applying) return;
    const snap = await this.capture(true);
    if (this.applying || this.past.length || this.future.length) return;
    this.pendingBefore = null;
    this.baseline = snap;
    this.sync();
  }

  /** Serialise mutations so rapid edits each get their own undo step. */
  around<T>(fn: () => Promise<T>): Promise<T> {
    if (this.applying) return fn();
    const run = this.chain.then(async () => {
      this.depth++;
      if (this.depth === 1) await this.begin();
      try {
        const result = await fn();
        if (this.depth === 1) await this.commit();
        return result;
      } catch (err) {
        if (this.depth === 1) this.pendingBefore = null;
        throw err;
      } finally {
        this.depth--;
      }
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async undo(): Promise<boolean> {
    const prev = this.past.pop();
    if (!prev) return false;
    const current = this.baseline ?? (await this.capture());
    if (current) this.future.push(current);
    await this.apply(prev);
    return true;
  }

  async redo(): Promise<boolean> {
    const next = this.future.pop();
    if (!next) return false;
    const current = this.baseline ?? (await this.capture());
    if (current) this.past.push(current);
    await this.apply(next);
    return true;
  }

  private async begin(): Promise<void> {
    if (!this.baseline) this.baseline = await this.capture();
    this.pendingBefore = this.baseline ? cloneLab(this.baseline) : null;
  }

  private async commit(): Promise<void> {
    const after = await this.capture(true);
    if (!after) {
      this.pendingBefore = null;
      return;
    }
    const before = this.pendingBefore;
    this.pendingBefore = null;
    if (before && fingerprint(before) !== fingerprint(after)) {
      this.past.push(before);
      if (this.past.length > MAX) this.past.shift();
      this.future = [];
    }
    this.baseline = after;
    this.sync();
  }

  private async apply(lab: LabJson): Promise<void> {
    this.applying = true;
    this.busy.set(true);
    try {
      await this.api.open(undefined, lab);
      this.baseline = cloneLab(lab);
      this.sync();
    } finally {
      this.applying = false;
      this.busy.set(false);
    }
  }

  private async capture(fresh = false): Promise<LabJson | null> {
    if (!fresh) {
      const cached = this.api.peekLab();
      if (cached) return cloneLab(cached);
    }
    const snap = await this.api.snapshot();
    return snap ? cloneLab(snap) : null;
  }

  private sync(): void {
    this.canUndo.set(this.past.length > 0);
    this.canRedo.set(this.future.length > 0);
  }
}
