import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  BUILTIN_LABS,
  dualStackOfficeLab,
  Engine,
  labFromSpec,
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
  /** Stable per-browser key the UI sends on open; Eve tools may address the lab by it across API restarts. */
  labKey?: string;
}

/** Tool/CLI calls per minute per session (NB_RATE_LIMIT to override). */
const RATE_LIMIT = Number(process.env.NB_RATE_LIMIT) > 0 ? Number(process.env.NB_RATE_LIMIT) : 120;

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

  create(lab: LabJson, userId: string, guest: boolean, labKey?: string): Session {
    const engine = Engine.fromLab(lab);
    const s: Session = {
      id: randomUUID(),
      userId,
      guest,
      engine,
      createdAt: Date.now(),
      calls: [],
      highlights: [],
      ...(labKey ? { labKey } : {}),
    };
    this.sessions.set(s.id, s);
    return s;
  }

  get(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new HttpException('session not found', HttpStatus.NOT_FOUND);
    return s;
  }

  /** Session id, engine lab id or browser labKey → session (newest wins for a labKey). */
  resolve(ref: string): Session | undefined {
    const direct = this.sessions.get(ref);
    if (direct) return direct;
    let best: Session | undefined;
    for (const s of this.sessions.values()) {
      if (s.labKey === ref || s.engine.id === ref) {
        if (!best || s.createdAt > best.createdAt) best = s;
      }
    }
    return best;
  }

  rateLimit(s: Session): void {
    const now = Date.now();
    s.calls = s.calls.filter((t) => now - t < 60_000);
    if (s.calls.length >= RATE_LIMIT) {
      const retryIn = Math.ceil((60_000 - (now - s.calls[0])) / 1000);
      throw new HttpException(`rate limit: ${RATE_LIMIT} tool/CLI calls per minute — retry in ${retryIn}s`, HttpStatus.TOO_MANY_REQUESTS);
    }
    s.calls.push(now);
  }

  mintConfirm(sessionId: string, purpose: string): string {
    const token = randomBytes(16).toString('hex');
    this.confirms.set(token, { token, sessionId, purpose, exp: Date.now() + 5 * 60_000 });
    return token;
  }

  consumeConfirm(sessionId: string, purpose: string, token: string | undefined): void {
    if (!token) throw new HttpException('confirmToken required', HttpStatus.FORBIDDEN);
    const c = this.confirms.get(token);
    this.confirms.delete(token);
    if (!c || c.sessionId !== sessionId || c.purpose !== purpose || c.exp < Date.now()) {
      throw new HttpException('invalid or expired confirmToken', HttpStatus.FORBIDDEN);
    }
  }

  commands(kind: string) {
    return listCommands(kind as DeviceKind);
  }

  buildOffice(): LabJson {
    return dualStackOfficeLab();
  }

  buildFromSpec(spec: string): LabJson {
    return labFromSpec(spec);
  }

  applyPatch(s: Session, raw: unknown): ReturnType<Engine['applyPatch']> {
    const v = validatePatch(raw);
    if (!v.ok) throw new HttpException(v.error, HttpStatus.BAD_REQUEST);
    const r = s.engine.applyPatch(v.patch);
    if (!r.ok) throw new HttpException(r.error ?? 'patch failed', HttpStatus.BAD_REQUEST);
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
