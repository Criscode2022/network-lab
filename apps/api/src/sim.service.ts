import { Injectable } from '@nestjs/common';
import {
  BUILTIN_LABS,
  dualStackOfficeLab,
  Engine,
  listCommands,
  validatePatch,
  type DeviceKind,
  type LabJson,
  type LabPatch,
} from '@netbench/engine';
import { randomBytes, randomUUID } from 'node:crypto';

export interface Session {
  id: string;
  userId: string;
  guest: boolean;
  engine: Engine;
  createdAt: number;
  calls: number[];
  highlights: string[];
}

interface Confirm {
  token: string;
  sessionId: string;
  purpose: string;
  exp: number;
}

@Injectable()
export class SimService {
  readonly sessions = new Map<string, Session>();
  private confirms = new Map<string, Confirm>();

  builtins(): LabJson[] {
    return BUILTIN_LABS;
  }

  create(lab: LabJson, userId: string, guest: boolean): Session {
    const engine = Engine.fromLab(lab);
    const s: Session = {
      id: randomUUID(),
      userId,
      guest,
      engine,
      createdAt: Date.now(),
      calls: [],
      highlights: [],
    };
    this.sessions.set(s.id, s);
    return s;
  }

  get(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw Object.assign(new Error('session not found'), { status: 404 });
    return s;
  }

  rateLimit(s: Session): void {
    const now = Date.now();
    s.calls = s.calls.filter((t) => now - t < 60_000);
    if (s.calls.length >= 60) {
      throw Object.assign(new Error('rate limit: 60 tool/CLI calls per minute'), { status: 429 });
    }
    s.calls.push(now);
  }

  mintConfirm(sessionId: string, purpose: string): string {
    const token = randomBytes(16).toString('hex');
    this.confirms.set(token, { token, sessionId, purpose, exp: Date.now() + 5 * 60_000 });
    return token;
  }

  consumeConfirm(sessionId: string, purpose: string, token: string | undefined): void {
    if (!token) throw Object.assign(new Error('confirmToken required'), { status: 403 });
    const c = this.confirms.get(token);
    this.confirms.delete(token);
    if (!c || c.sessionId !== sessionId || c.purpose !== purpose || c.exp < Date.now()) {
      throw Object.assign(new Error('invalid or expired confirmToken'), { status: 403 });
    }
  }

  commands(kind: string) {
    return listCommands(kind as DeviceKind);
  }

  buildOffice(): LabJson {
    return dualStackOfficeLab();
  }

  applyPatch(s: Session, raw: unknown): ReturnType<Engine['applyPatch']> {
    const v = validatePatch(raw);
    if (!v.ok) throw Object.assign(new Error(v.error), { status: 400 });
    const r = s.engine.applyPatch(v.patch);
    if (!r.ok) throw Object.assign(new Error(r.error ?? 'patch failed'), { status: 400 });
    return r;
  }

  applyConfig(s: Session, deviceId: string, commands: string[]) {
    const outputs: { line: string; output: string; error?: boolean }[] = [];
    for (const line of commands) {
      const r = s.engine.exec(deviceId, line);
      outputs.push({ line, output: r.output, error: r.error });
      if (r.error) break;
    }
    s.engine.converge();
    return { outputs, runningConfig: s.engine.runningConfig(s.engine.dev(deviceId)), state: s.engine.getState() };
  }
}

export type { LabPatch };
