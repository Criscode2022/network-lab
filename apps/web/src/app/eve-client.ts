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
  description?: string;
  style?: string;
}

/** `question` = the model asked the user (never auto-answered); `tool-approval` / `session-limit` = host can answer. */
export type EveHitlKind = 'question' | 'tool-approval' | 'session-limit' | string;

export interface EveHitl {
  requestId: string;
  kind: EveHitlKind;
  prompt: string;
  toolName?: string;
  toolInput?: unknown;
  options?: EveOption[];
  /** The user may answer with free text (questions only). */
  allowFreeform: boolean;
}

const APPROVE_RE = /approve|allow|yes|continue|ok/i;
const DENY_RE = /cancel|deny|reject|stop|no/i;

export interface EveChatMsg {
  /** `sys` = host note (auto-approval, retry), not model output. */
  role: 'user' | 'eve' | 'sys';
  text: string;
}

const AUTO_KEY = 'nb_eve_auto';
/** Automatic re-sends after a failed turn (so up to 4 attempts). */
export const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 12_000];
/** Stream reconnects (with backoff) before giving up on a live turn. */
const MAX_STREAM_RECONNECTS = 6;
const STREAM_BACKOFF = [1000, 2000, 4000, 8000, 12_000, 15_000];
/** Codes eve uses when the model call itself failed; the host rotates models, so a re-send is worth it. */
const MODEL_FAILURE_RE = /MODEL|PROVIDER|GATEWAY|UPSTREAM|TIMEOUT|RATE|429|5\d\d/i;

interface EveEvent {
  type: string;
  meta?: { id?: string; at?: string };
  data?: {
    message?: string | null;
    messageSoFar?: string;
    messageDelta?: string;
    requests?: {
      requestId: string;
      kind: string;
      prompt: string;
      allowFreeform?: boolean;
      options?: EveOption[];
      action?: { toolName?: string; input?: unknown };
    }[];
    finishReason?: string;
    code?: string;
    error?: string | { message?: string };
    result?: { toolName?: string; isError?: boolean };
    status?: string;
  } & Record<string, unknown>;
}

type InputResponse = { requestId: string; optionId?: string; text?: string };

@Injectable({ providedIn: 'root' })
export class EveClient {
  readonly host = EVE_HOST;
  sessionId = signal<string | null>(null);
  msgs = signal<EveChatMsg[]>([]);
  /** The request the user must answer (always a question or a manual approval); the next one follows automatically. */
  hitl = signal<EveHitl | null>(null);
  /** Requests still waiting on the user, including `hitl()`. */
  pendingCount = signal(0);
  busy = signal(false);
  error = signal<string | null>(null);
  /** Approve Eve's tool calls without a click (the host still mints a confirmToken per call). Default on. */
  autoApprove = signal(typeof localStorage === 'undefined' || localStorage.getItem(AUTO_KEY) !== '0');
  /** Retry attempt in progress (1-based) or 0. */
  retrying = signal(0);
  readonly maxRetries = MAX_RETRIES;
  /** Epoch ms of the next automatic retry, for a countdown. */
  retryAt = signal<number | null>(null);
  /** Stream reconnect attempt in progress (1-based) or 0. */
  reconnecting = signal(0);
  /** Last user message, re-sendable after a failure. */
  lastSent = signal<string | null>(null);
  onLabMutated: (() => void) | null = null;

  private nestSessionId: string | null = null;
  private userId = 'anon';
  private streamAbort: AbortController | null = null;
  private streamIndex = 0;
  private streamReconnects = 0;
  private context: () => string = () => '';
  /** Requests waiting on the user, in arrival order. */
  private queue: EveHitl[] = [];
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** step.failed seen in the current turn with no assistant text after it → the turn "completed" empty. */
  private stepFailure: string | null = null;
  private sawTextThisTurn = false;
  /** Recent event ids, so a reconnect that overlaps already-handled events is harmless. */
  private seenIds: string[] = [];
  private seenSet = new Set<string>();

  setAutoApprove(on: boolean): void {
    this.autoApprove.set(on);
    try {
      localStorage.setItem(AUTO_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (on) this.flushAuto();
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

  private forgetSession(): void {
    this.stop();
    this.sessionId.set(null);
    this.streamIndex = 0;
    this.queue = [];
    this.hitl.set(null);
    this.pendingCount.set(0);
    try {
      localStorage.removeItem(this.storageKey());
      localStorage.removeItem(this.storageKey() + ':idx');
    } catch {
      /* ignore */
    }
  }

  private wrap(text: string): string {
    return `${this.context()}\n\n${text}`;
  }

  async send(text: string, opts: { retry?: boolean; fresh?: boolean } = {}): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!opts.retry) {
      this.msgs.update((m) => [...m, { role: 'user', text: trimmed }]);
      this.lastSent.set(trimmed);
      this.retries = 0;
      this.retrying.set(0);
      this.retryAt.set(null);
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.busy.set(true);
    this.error.set(null);
    this.stepFailure = null;
    this.sawTextThisTurn = false;
    try {
      let id = this.sessionId();
      if (!id) {
        const created = await this.postJson('/eve/v1/session', { message: this.wrap(trimmed) });
        id = String(created.sessionId ?? '');
        if (!id) throw new Error('Eve did not return a sessionId');
        this.sessionId.set(id);
        this.streamIndex = 0;
        this.streamReconnects = 0;
        this.persist();
        this.openStream();
        return;
      }
      this.openStream();
      const r = await this.postJson(`/eve/v1/session/${id}`, { message: this.wrap(trimmed) });
      if (r.status === 409 || r.status === 404 || r.status === 410 || r.code === 'session_not_active') {
        // The durable session is gone (reset, expired, host storage changed): start a fresh one, once.
        if (opts.fresh) throw new Error('Eve session is no longer active and a fresh one could not be started');
        this.forgetSession();
        this.note('Eve session expired — starting a new one.');
        return this.send(trimmed, { retry: true, fresh: true });
      }
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
    }
  }

  /** Records a failure and schedules an automatic re-send with backoff, else surfaces the error with a manual Retry. */
  private fail(msg: string): void {
    this.busy.set(false);
    this.error.set(msg);
    const last = this.lastSent();
    if (last && this.retries < MAX_RETRIES) {
      const base = RETRY_DELAYS[Math.min(this.retries, RETRY_DELAYS.length - 1)];
      const hinted = /retry in (\d+)\s*s/i.exec(msg);
      const delay = hinted ? Math.min(Number(hinted[1]) * 1000, 30_000) : Math.round(base * (0.8 + Math.random() * 0.4));
      this.retries++;
      this.retrying.set(this.retries);
      this.retryAt.set(Date.now() + delay);
      const why = MODEL_FAILURE_RE.test(msg) ? 'Eve’s model call failed; the host switches model and retries' : `Eve hit an error (${msg}). Retrying`;
      this.note(`${why} ${this.retries}/${MAX_RETRIES} in ${Math.round(delay / 1000)} s…`);
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.retryLast(true);
      }, delay);
      return;
    }
    this.retrying.set(0);
    this.retryAt.set(null);
    this.msgs.update((m) => {
      const prev = m[m.length - 1];
      return prev?.role === 'eve' && prev.text === msg ? m : [...m, { role: 'eve', text: msg }];
    });
  }

  /**
   * Re-sends the last user message into the same durable session (history and the host's model rotation survive).
   * Only a session that eve itself declared dead is replaced.
   */
  async retryLast(auto = false): Promise<void> {
    const last = this.lastSent();
    if (!last) return;
    if (!auto) {
      this.retries = 0;
      this.retrying.set(0);
      this.retryAt.set(null);
      this.note('Retrying…');
    }
    const err = this.error() ?? '';
    if (/session failed|session_not_active|no longer active|not found|\b(404|409|410)\b/i.test(err)) this.forgetSession();
    await this.send(last, { retry: true });
  }

  /** Answer the current request with an option id (buttons). */
  async respond(optionId: string, requestId?: string): Promise<void> {
    const target = requestId ? this.queue.find((h) => h.requestId === requestId) ?? this.hitl() : this.hitl();
    if (!target) return;
    const approve = APPROVE_RE.test(optionId) && !DENY_RE.test(optionId);
    const oid = target.options?.some((o) => o.id === optionId) ? optionId : this.pickOption(target, approve);
    await this.submit([{ requestId: target.requestId, optionId: oid }]);
  }

  /** Answer the current question with free text; falls back to a matching option, else a normal follow-up message. */
  async answer(text: string): Promise<void> {
    const h = this.hitl();
    const t = text.trim();
    if (!h || !t) return;
    const match = h.options?.find((o) => o.id.toLowerCase() === t.toLowerCase() || o.label.toLowerCase() === t.toLowerCase());
    const byIndex = /^\d+$/.test(t) && h.options?.[Number(t) - 1];
    this.msgs.update((m) => [...m, { role: 'user', text: t }]);
    if (match || byIndex) {
      await this.submit([{ requestId: h.requestId, optionId: (match ?? (byIndex as EveOption)).id }]);
      return;
    }
    if (h.allowFreeform || !h.options?.length) {
      await this.submit([{ requestId: h.requestId, text: t }]);
      return;
    }
    // Options-only question answered with unrelated text: eve treats a message as a follow-up and keeps the question pending.
    await this.send(t, { retry: true });
  }

  /** Posts answers; the answered requests leave the queue up front so the card never flashes an auto-answered item. */
  private async submit(responses: InputResponse[]): Promise<void> {
    const id = this.sessionId();
    if (!id || !responses.length) return;
    const answered = new Set(responses.map((r) => r.requestId));
    const taken = this.queue.filter((h) => answered.has(h.requestId));
    this.queue = this.queue.filter((h) => !answered.has(h.requestId));
    // Busy again unless another question still waits for the user.
    this.busy.set(this.queue.length === 0);
    this.showNext();
    this.error.set(null);
    try {
      await this.postJson(`/eve/v1/session/${id}`, { inputResponses: responses });
      // The parked turn resumes now; `session.waiting` may already have cleared busy before the answer landed.
      if (!this.queue.length) this.busy.set(true);
    } catch (e) {
      this.queue = [...taken, ...this.queue];
      this.showNext();
      this.busy.set(false);
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  private pickOption(h: EveHitl, approve: boolean): string {
    const re = approve ? APPROVE_RE : DENY_RE;
    const fallback = approve ? 'approve' : 'cancel';
    return h.options?.find((o) => re.test(o.id) || re.test(o.label))?.id ?? fallback;
  }

  private showNext(): void {
    this.hitl.set(this.queue[0] ?? null);
    this.pendingCount.set(this.queue.length);
    if (!this.queue.length) return;
    this.busy.set(false);
  }

  /** Everything that is not a question is answered by the host; questions wait for the user. */
  private isAuto(h: EveHitl): boolean {
    if (h.kind === 'question') return false;
    if (h.kind === 'session-limit') return true;
    return this.autoApprove();
  }

  private flushAuto(): void {
    const auto = this.queue.filter((h) => this.isAuto(h));
    if (!auto.length) return;
    const responses = auto.map((h) => ({ requestId: h.requestId, optionId: this.pickOption(h, true) }));
    for (const h of auto) {
      this.note(h.kind === 'session-limit' ? 'Session token budget renewed automatically.' : `Auto-approved ${h.toolName ?? 'the change'}.`);
    }
    void this.submit(responses);
  }

  stop(): void {
    this.streamAbort?.abort();
    this.streamAbort = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.reconnecting.set(0);
  }

  private async postJson(path: string, body: unknown): Promise<{ ok?: boolean; sessionId?: string; code?: string; error?: string; status: number }> {
    const r = await fetch(`${this.host}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      sessionId?: string;
      code?: string;
      error?: string;
      message?: string;
    };
    if (!r.ok && ![404, 409, 410].includes(r.status)) {
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
    void this.consumeStream(id, this.streamIndex, ac)
      .then(() => this.onStreamEnded(id, ac, null))
      .catch((e) => this.onStreamEnded(id, ac, e));
  }

  /** The follow stream ended. While a turn is live that is a drop, so reconnect from the cursor with backoff. */
  private onStreamEnded(id: string, ac: AbortController, err: unknown): void {
    if (ac.signal.aborted || this.sessionId() !== id) return;
    const msg = err instanceof Error ? err.message : err ? String(err) : '';
    if (/HTTP (404|409|410)/.test(msg)) {
      this.reconnecting.set(0);
      this.fail(`Eve session is no longer active (${msg})`);
      return;
    }
    if (!this.busy() && !err) return;
    if (this.streamReconnects >= MAX_STREAM_RECONNECTS) {
      this.reconnecting.set(0);
      this.fail(msg || 'Lost the connection to Eve');
      return;
    }
    const delay = STREAM_BACKOFF[Math.min(this.streamReconnects, STREAM_BACKOFF.length - 1)];
    this.streamReconnects++;
    this.reconnecting.set(this.streamReconnects);
    setTimeout(() => {
      if (this.streamAbort === ac && this.sessionId() === id) this.openStream();
    }, delay);
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
        if (line) {
          let ev: EveEvent | null = null;
          try {
            ev = JSON.parse(line) as EveEvent;
          } catch {
            ev = null;
          }
          if (ev) this.onEvent(ev);
        }
        nl = buf.indexOf('\n');
      }
      if (done) break;
    }
  }

  private remember(id: string | undefined): boolean {
    if (!id) return true;
    if (this.seenSet.has(id)) return false;
    this.seenSet.add(id);
    this.seenIds.push(id);
    if (this.seenIds.length > 500) this.seenSet.delete(this.seenIds.shift()!);
    return true;
  }

  private onEvent(ev: EveEvent): void {
    this.streamIndex += 1;
    this.persist();
    // A healthy event means the stream is live again.
    this.streamReconnects = 0;
    if (this.reconnecting()) this.reconnecting.set(0);
    if (!this.remember(ev.meta?.id)) return;
    const t = ev.type;
    const data = ev.data ?? {};
    if (t === 'turn.started') {
      this.stepFailure = null;
      this.sawTextThisTurn = false;
    }
    if (t === 'message.appended' || t === 'message.completed') {
      const text = typeof data.messageSoFar === 'string' ? data.messageSoFar : typeof data.message === 'string' ? data.message : '';
      if (text) this.sawTextThisTurn = true;
      this.msgs.update((m) => {
        const copy = m.slice();
        const last = copy[copy.length - 1];
        if (last?.role === 'eve' && (t === 'message.appended' || last.text === '' || text.startsWith(last.text))) {
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
      const incoming: EveHitl[] = reqs.map((req) => ({
        requestId: req.requestId,
        kind: req.kind,
        prompt: req.prompt,
        toolName: req.action?.toolName,
        toolInput: req.action?.input,
        allowFreeform: req.allowFreeform === true,
        options:
          req.options?.length
            ? req.options
            : req.kind === 'question'
              ? undefined
              : [
                  { id: 'approve', label: 'Approve' },
                  { id: 'cancel', label: 'Cancel' },
                ],
      }));
      const known = new Set(this.queue.map((h) => h.requestId));
      this.queue.push(...incoming.filter((h) => !known.has(h.requestId)));
      this.flushAuto();
      this.showNext();
    }
    if (t === 'input.resolved') {
      // Authoritative: eve settled the batch (answered here, in another tab, or by a follow-up message).
      this.queue = [];
      this.showNext();
    }
    if (t === 'action.result') {
      this.sawTextThisTurn = true;
      const tool = data.result?.toolName ?? '';
      if (/apply_|build_lab/.test(tool) || !tool) this.onLabMutated?.();
    }
    if (t === 'session.waiting' || t === 'turn.completed') {
      if (this.stepFailure && !this.sawTextThisTurn && this.busy()) {
        // eve ends a turn silently after a terminal model failure; treat it as failed so the re-send kicks in.
        const msg = this.stepFailure;
        this.stepFailure = null;
        this.fail(msg);
        return;
      }
      this.stepFailure = null;
      this.busy.set(false);
      this.retries = 0;
      this.retrying.set(0);
      this.retryAt.set(null);
      this.error.set(null);
    }
    if (t === 'turn.cancelled') {
      this.busy.set(false);
    }
    if (t === 'step.failed' || t === 'turn.failed' || t === 'session.failed') {
      const rec = data as Record<string, unknown>;
      const err = data.error;
      const nested = typeof err === 'string' ? err : err?.message;
      const raw = nested || (typeof rec['message'] === 'string' ? rec['message'] : '') || 'Eve turn failed';
      const code = typeof rec['code'] === 'string' ? rec['code'] : '';
      const msg = code && !raw.startsWith(code) ? `${code}: ${raw}` : raw;
      if (t === 'step.failed') {
        // eve may retry the step itself or end the turn; remember the message and wait for the turn's verdict.
        this.stepFailure = msg;
        this.error.set(msg);
        return;
      }
      if (t === 'session.failed') {
        this.forgetSession();
        this.fail(`session failed: ${msg}`);
        return;
      }
      this.fail(msg);
    }
  }
}
