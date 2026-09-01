import { Injectable, signal } from '@angular/core';

const LOCAL =
  typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

/** Browser talks to the Vercel Eve host in production, not the Railway Nest proxy. */
export const EVE_HOST = LOCAL
  ? 'http://127.0.0.1:4010'
  : 'https://netbench-eve-criscode2022s-projects.vercel.app';

export interface EveOption {
  id: string;
  label: string;
  style?: string;
}

export interface EveHitl {
  requestId: string;
  kind: string;
  prompt: string;
  toolName?: string;
  toolInput?: unknown;
  options?: EveOption[];
}

export interface EveChatMsg {
  role: 'user' | 'eve';
  text: string;
}

interface EveEvent {
  type: string;
  data?: {
    message?: string;
    requests?: {
      requestId: string;
      kind: string;
      prompt: string;
      options?: EveOption[];
      action?: { toolName?: string; input?: unknown };
    }[];
    finishReason?: string;
    error?: string | { message?: string };
  } & Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class EveClient {
  readonly host = EVE_HOST;
  sessionId = signal<string | null>(null);
  msgs = signal<EveChatMsg[]>([]);
  hitl = signal<EveHitl | null>(null);
  busy = signal(false);
  error = signal<string | null>(null);
  onLabMutated: (() => void) | null = null;

  private nestSessionId: string | null = null;
  private userId = 'anon';
  private streamAbort: AbortController | null = null;
  private streamIndex = 0;
  private context: () => string = () => '';

  bind(opts: { nestSessionId: string; userId: string; context: () => string }): void {
    this.nestSessionId = opts.nestSessionId;
    this.userId = opts.userId || 'anon';
    this.context = opts.context;
    const stored = localStorage.getItem(this.storageKey());
    if (stored && stored !== this.sessionId()) {
      this.sessionId.set(stored);
      this.streamIndex = Number(localStorage.getItem(this.storageKey() + ':idx') || '0') || 0;
      this.openStream();
    }
  }

  private storageKey(): string {
    return `nb_eve:${this.userId}:${this.nestSessionId}`;
  }

  private persist(): void {
    const id = this.sessionId();
    if (id) {
      localStorage.setItem(this.storageKey(), id);
      localStorage.setItem(this.storageKey() + ':idx', String(this.streamIndex));
    }
  }

  private wrap(text: string): string {
    return `${this.context()}\n\n${text}`;
  }

  async send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.msgs.update((m) => [...m, { role: 'user', text: trimmed }]);
    this.busy.set(true);
    this.error.set(null);
    try {
      let id = this.sessionId();
      if (!id) {
        const created = await this.postJson('/eve/v1/session', { message: this.wrap(trimmed) });
        id = String(created.sessionId ?? '');
        if (!id) throw new Error('Eve did not return a sessionId');
        this.sessionId.set(id);
        this.streamIndex = 0;
        this.persist();
        this.openStream();
        return;
      }
      this.openStream();
      const r = await this.postJson(`/eve/v1/session/${id}`, { message: this.wrap(trimmed) });
      if (r.status === 409 || r.code === 'session_not_active') {
        this.sessionId.set(null);
        localStorage.removeItem(this.storageKey());
        this.msgs.update((m) => m.slice(0, -1));
        return this.send(trimmed);
      }
    } catch (e) {
      this.busy.set(false);
      const msg = e instanceof Error ? e.message : String(e);
      this.error.set(msg);
      this.msgs.update((m) => [...m, { role: 'eve', text: msg }]);
    }
  }

  async respond(optionId: string, requestId?: string): Promise<void> {
    const id = this.sessionId();
    const hitl = this.hitl();
    const rid = requestId ?? hitl?.requestId;
    if (!id || !rid) return;
    this.busy.set(true);
    try {
      await this.postJson(`/eve/v1/session/${id}`, { inputResponses: [{ requestId: rid, optionId }] });
      this.hitl.set(null);
    } catch (e) {
      this.busy.set(false);
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  stop(): void {
    this.streamAbort?.abort();
    this.streamAbort = null;
  }

  private async postJson(path: string, body: unknown): Promise<{ ok?: boolean; sessionId?: string; code?: string; error?: string; status: number }> {
    const r = await fetch(`${this.host}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      sessionId?: string;
      code?: string;
      error?: string;
      message?: string;
    };
    if (!r.ok && r.status !== 409) {
      throw new Error(json.message || json.error || `Eve HTTP ${r.status}`);
    }
    return { ...json, status: r.status };
  }

  private openStream(): void {
    const id = this.sessionId();
    if (!id) return;
    this.streamAbort?.abort();
    const ac = new AbortController();
    this.streamAbort = ac;
    const start = this.streamIndex;
    void this.consumeStream(id, start, ac).catch((e) => {
      if (ac.signal.aborted) return;
      this.error.set(e instanceof Error ? e.message : String(e));
      this.busy.set(false);
    });
  }

  private async consumeStream(id: string, startIndex: number, ac: AbortController): Promise<void> {
    const r = await fetch(`${this.host}/eve/v1/session/${id}/stream?startIndex=${startIndex}`, { signal: ac.signal });
    if (!r.ok || !r.body) {
      throw new Error(`Eve stream HTTP ${r.status}`);
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (!ac.signal.aborted) {
      const { done, value } = await reader.read();
      buf += dec.decode(value ?? new Uint8Array(), { stream: !done });
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) this.onEvent(JSON.parse(line) as EveEvent);
        nl = buf.indexOf('\n');
      }
      if (done) break;
    }
  }

  private onEvent(ev: EveEvent): void {
    this.streamIndex += 1;
    this.persist();
    const t = ev.type;
    const data = ev.data ?? {};
    if (t === 'message.appended' || t === 'message.completed') {
      const text = typeof data.message === 'string' ? data.message : '';
      this.msgs.update((m) => {
        const copy = m.slice();
        const last = copy[copy.length - 1];
        if (last?.role === 'eve' && (t === 'message.appended' || last.text === '')) {
          copy[copy.length - 1] = { role: 'eve', text };
          return copy;
        }
        if (t === 'message.appended') return [...copy, { role: 'eve', text }];
        if (text) return [...copy, { role: 'eve', text }];
        return copy;
      });
    }
    if (t === 'input.requested') {
      const req = data.requests?.[0];
      if (req) {
        this.hitl.set({
          requestId: req.requestId,
          kind: req.kind,
          prompt: req.prompt,
          toolName: req.action?.toolName,
          toolInput: req.action?.input,
          options: req.options,
        });
      }
      this.busy.set(false);
    }
    if (t === 'input.resolved') {
      this.hitl.set(null);
    }
    if (t === 'action.result') {
      this.onLabMutated?.();
    }
    if (t === 'session.waiting' || t === 'turn.completed') {
      this.busy.set(false);
    }
    if (t === 'step.failed' || t === 'turn.failed' || t === 'session.failed') {
      this.busy.set(false);
      const rec = data as Record<string, unknown>;
      const err = data.error;
      const nested = typeof err === 'string' ? err : err?.message;
      const raw = nested || (typeof rec['message'] === 'string' ? rec['message'] : '') || 'Eve turn failed';
      const code = typeof rec['code'] === 'string' ? rec['code'] : '';
      const msg = code && !raw.startsWith(code) ? `${code}: ${raw}` : raw;
      this.error.set(msg);
      if (t === 'turn.failed' || t === 'session.failed') {
        this.msgs.update((m) => {
          const last = m[m.length - 1];
          if (last?.role === 'eve' && last.text === msg) return m;
          return [...m, { role: 'eve', text: msg }];
        });
      }
    }
  }
}
