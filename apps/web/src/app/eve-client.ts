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

const APPROVE_RE = /approve|allow|yes/i;
const DENY_RE = /cancel|deny|reject|no/i;

export interface EveChatMsg {
  /** `sys` = host note (auto-approval, retry), not model output. */
  role: 'user' | 'eve' | 'sys';
  text: string;
}

const AUTO_KEY = 'nb_eve_auto';
/** Automatic re-sends after a failed turn (so up to 3 attempts). */
const MAX_RETRIES = 2;
const RETRY_DELAYS = [1500, 4000];

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
  /** Approve Eve's tool calls without a click (the host still mints a confirmToken per call). Default on. */
  autoApprove = signal(typeof localStorage === 'undefined' || localStorage.getItem(AUTO_KEY) !== '0');
  /** Retry attempt in progress (1-based) or 0. */
  retrying = signal(0);
  /** Last user message, re-sendable after a failure. */
  lastSent = signal<string | null>(null);
  onLabMutated: (() => void) | null = null;

  private nestSessionId: string | null = null;
  private userId = 'anon';
  private streamAbort: AbortController | null = null;
  private streamIndex = 0;
  private context: () => string = () => '';
  private hitlBatch: EveHitl[] = [];
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  setAutoApprove(on: boolean): void {
    this.autoApprove.set(on);
    try {
      localStorage.setItem(AUTO_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    const pending = this.hitl();
    if (on && pending && (pending.kind === 'tool-approval' || pending.toolName)) this.autoRespond(pending);
  }

  private note(text: string): void {
    this.msgs.update((m) => [...m, { role: 'sys', text }]);
  }

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

  async send(text: string, opts: { retry?: boolean } = {}): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!opts.retry) {
      this.msgs.update((m) => [...m, { role: 'user', text: trimmed }]);
      this.lastSent.set(trimmed);
      this.retries = 0;
      this.retrying.set(0);
      if (this.retryTimer) clearTimeout(this.retryTimer);
    }
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
        return this.send(trimmed, { retry: true });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.fail(msg);
    }
  }

  /** Records a failure and schedules an automatic re-send (max 2), else surfaces the error with a manual Retry. */
  private fail(msg: string): void {
    this.busy.set(false);
    this.error.set(msg);
    const last = this.lastSent();
    if (last && this.retries < MAX_RETRIES) {
      const delay = RETRY_DELAYS[Math.min(this.retries, RETRY_DELAYS.length - 1)];
      this.retries++;
      this.retrying.set(this.retries);
      this.note(`Eve hit an error (${msg}). Retrying ${this.retries}/${MAX_RETRIES} in ${Math.round(delay / 1000)} s…`);
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.retryLast(true);
      }, delay);
      return;
    }
    this.retrying.set(0);
    this.msgs.update((m) => {
      const prev = m[m.length - 1];
      return prev?.role === 'eve' && prev.text === msg ? m : [...m, { role: 'eve', text: msg }];
    });
  }

  /** Re-sends the last user message. A failed durable session is replaced by a fresh one. */
  async retryLast(auto = false): Promise<void> {
    const last = this.lastSent();
    if (!last) return;
    if (!auto) {
      this.retries = 0;
      this.retrying.set(0);
      this.note('Retrying…');
    }
    if (this.error() && /session|failed|not_active|409/i.test(this.error() ?? '')) {
      this.stop();
      this.sessionId.set(null);
      localStorage.removeItem(this.storageKey());
      this.streamIndex = 0;
    }
    await this.send(last, { retry: true });
  }

  private autoRespond(req: EveHitl): void {
    const tool = req.toolName ?? 'the change';
    this.note(`Auto-approved ${tool}.`);
    void this.respond('approve', req.requestId);
  }

  async respond(optionId: string, requestId?: string): Promise<void> {
    const id = this.sessionId();
    const batch = this.hitlBatch.length ? this.hitlBatch : this.hitl() ? [this.hitl()!] : [];
    const rid = requestId ?? batch[0]?.requestId;
    if (!id || !rid) return;
    this.busy.set(true);
    this.error.set(null);
    const approve = APPROVE_RE.test(optionId);
    const responses = batch
      .map((h) => {
        if (h.kind === 'tool-approval' || h.toolName) {
          const oid = this.pickOption(h, approve);
          return { requestId: h.requestId, optionId: oid };
        }
        if (h.requestId === rid) return { requestId: h.requestId, optionId };
        return null;
      })
      .filter((x): x is { requestId: string; optionId: string } => !!x);
    if (!responses.length) responses.push({ requestId: rid, optionId: approve ? 'approve' : 'cancel' });
    try {
      await this.postJson(`/eve/v1/session/${id}`, { inputResponses: responses });
      this.hitl.set(null);
      this.hitlBatch = [];
    } catch (e) {
      this.busy.set(false);
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  private pickOption(h: EveHitl, approve: boolean): string {
    const re = approve ? APPROVE_RE : DENY_RE;
    const fallback = approve ? 'approve' : 'cancel';
    return h.options?.find((o) => re.test(o.id) || re.test(o.label))?.id ?? fallback;
  }

  stop(): void {
    this.streamAbort?.abort();
    this.streamAbort = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
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
      const reqs = data.requests ?? [];
      this.hitlBatch = reqs.map((req) => ({
        requestId: req.requestId,
        kind: req.kind,
        prompt: req.prompt,
        toolName: req.action?.toolName,
        toolInput: req.action?.input,
        options:
          req.options?.length
            ? req.options
            : req.kind === 'tool-approval' || req.action?.toolName
              ? [
                  { id: 'approve', label: 'Approve' },
                  { id: 'cancel', label: 'Cancel' },
                ]
              : undefined,
      }));
      const req = this.hitlBatch[0];
      if (req) {
        this.hitl.set(req);
        // Tool approvals are answered by the host when auto-approve is on; other questions still reach the user.
        if (this.autoApprove() && (req.kind === 'tool-approval' || req.toolName)) {
          this.autoRespond(req);
          return;
        }
      }
      this.busy.set(false);
    }
    if (t === 'input.resolved') {
      this.hitl.set(null);
      this.hitlBatch = [];
    }
    if (t === 'action.result') {
      this.onLabMutated?.();
    }
    if (t === 'session.waiting' || t === 'turn.completed') {
      this.busy.set(false);
      this.retries = 0;
      this.retrying.set(0);
      this.error.set(null);
    }
    if (t === 'step.failed' || t === 'turn.failed' || t === 'session.failed') {
      const rec = data as Record<string, unknown>;
      const err = data.error;
      const nested = typeof err === 'string' ? err : err?.message;
      const raw = nested || (typeof rec['message'] === 'string' ? rec['message'] : '') || 'Eve turn failed';
      const code = typeof rec['code'] === 'string' ? rec['code'] : '';
      const msg = code && !raw.startsWith(code) ? `${code}: ${raw}` : raw;
      if (t === 'step.failed') {
        // eve retries steps itself; surface the message but wait for the turn's verdict.
        this.error.set(msg);
        return;
      }
      if (t === 'session.failed') this.error.set(`session failed: ${msg}`);
      this.fail(t === 'session.failed' ? `session failed: ${msg}` : msg);
    }
  }
}
