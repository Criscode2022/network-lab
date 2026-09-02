import { randomUUID } from 'node:crypto';

export const API =
  process.env.NETBENCH_API_URL ||
  (process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT
    ? 'https://api-production-caeb.up.railway.app'
    : 'http://127.0.0.1:3001');

/** Retries per Nest call on network errors, timeouts, 429 and 5xx (so 3 attempts in total). Override with EVE_NEST_RETRIES. */
export const RETRIES = Number.isFinite(Number(process.env.EVE_NEST_RETRIES)) ? Math.max(0, Number(process.env.EVE_NEST_RETRIES)) : 2;
/** Per-attempt timeout. Lab builds converge synchronously on the API, so keep this generous. */
export const TIMEOUT_MS = Number(process.env.EVE_NEST_TIMEOUT_MS) > 0 ? Number(process.env.EVE_NEST_TIMEOUT_MS) : 25_000;
const BACKOFF_MS = [1000, 3000, 8000];
const MAX_RETRY_AFTER_MS = 30_000;

export type NestErrorKind =
  | 'network' // fetch failed: DNS, refused, reset
  | 'timeout' // no response within TIMEOUT_MS
  | 'rate-limit' // 429 from SimService.rateLimit
  | 'stale-session' // 404 from EveToolsController.session (lab expired / API restarted)
  | 'route-missing' // 404 "Cannot POST /api/…": the deployed API predates this route
  | 'forbidden' // 401/403 (bad token, consumed confirmToken)
  | 'bad-request' // 400/422: the lab/patch/commands were rejected
  | 'server' // 5xx
  | 'http';

export class NestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: NestErrorKind,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'NestError';
  }
}

const RETRYABLE: ReadonlySet<NestErrorKind> = new Set(['network', 'timeout', 'rate-limit', 'server']);

export const isRetryable = (e: unknown): boolean => e instanceof NestError && RETRYABLE.has(e.kind) && e.status !== 501;

/**
 * An API whose /api/health has no eveTools flag predates this agent: no /eve/tools/confirm route and no labKey session
 * resolution, so every mutation 404s and the session the UI names looks "not found". One fix, on the operator's side.
 */
const OUTDATED_API_HINT = `The NetBench API at ${API} is running an older build than this Eve agent (its /api/health has no eveTools flag): it lacks /api/eve/tools/confirm and cannot resolve the lab session the UI sends. This is a single deployment problem — the operator must redeploy apps/api from main (afterwards /api/health shows eveTools: true). Reloading the lab will not help; tell the user exactly that and do not retry.`;

/** One-line, model-facing guidance per failure kind. Appended to every NestError message so tools need no extra handling. */
function hint(kind: NestErrorKind, detail: string, retryAfterMs?: number): string {
  switch (kind) {
    case 'route-missing':
      return `The NetBench API at ${API} has no such route: either it is an older build (redeploy apps/api) or NETBENCH_API_URL on the Eve host points at the wrong service. This is a deployment problem, not a lab problem — call api_status once, tell the user exactly that and do not retry.`;
    case 'stale-session':
      return 'The lab session id is stale: re-read labSessionId from the newest [NetBench context] block and call the tool again with that exact value. If it still fails, the user must reload the lab in the UI.';
    case 'rate-limit':
      return `Rate limited — wait ${Math.ceil((retryAfterMs ?? 10_000) / 1000)}s, then retry once.`;
    case 'network':
    case 'timeout':
      return `The NetBench API at ${API} is ${kind === 'timeout' ? 'not answering in time' : 'unreachable'} from the Eve host after ${RETRIES + 1} attempts. This is not a lab problem: tell the user the API is down and to retry in a minute; use api_status to check.`;
    case 'forbidden':
      return /confirm/i.test(detail)
        ? 'The one-time confirmToken was rejected (already used or expired). Call the tool again — a fresh token is minted automatically; never pass confirmToken yourself.'
        : 'The API rejected the credentials of the Eve host (NETBENCH_API_TOKEN). Tell the user; do not retry.';
    case 'bad-request':
      return 'The API rejected the request content. Fix the lab JSON / patch / command lines named in the message and try again.';
    case 'server':
      return 'The NetBench API hit an internal error. Retry once; if it persists tell the user it is an API problem, not a lab problem.';
    default:
      return '';
  }
}

function parseRetryAfter(r: Response, message: string): number | undefined {
  const h = r.headers.get('retry-after');
  if (h) {
    const secs = Number(h);
    if (Number.isFinite(secs)) return Math.min(Math.max(secs, 1) * 1000, MAX_RETRY_AFTER_MS);
    const at = Date.parse(h);
    if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 1000), MAX_RETRY_AFTER_MS);
  }
  const m = /retry in (\d+)\s*s/i.exec(message);
  return m ? Math.min(Number(m[1]) * 1000, MAX_RETRY_AFTER_MS) : undefined;
}

function classify(status: number, message: string): NestErrorKind {
  if (status === 404) return /^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(message) ? 'route-missing' : 'stale-session';
  if (status === 429) return 'rate-limit';
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 400 || status === 422) return 'bad-request';
  if (status >= 500) return 'server';
  return 'http';
}

async function parse<T>(r: Response): Promise<T> {
  const json = (await r.json().catch(() => ({}))) as T & { message?: string | string[] };
  if (!r.ok) {
    const raw = Array.isArray(json.message) ? json.message.join(', ') : json.message;
    const detail = raw || r.statusText || `HTTP ${r.status}`;
    const kind = classify(r.status, detail);
    const retryAfterMs = kind === 'rate-limit' || r.status === 503 ? parseRetryAfter(r, detail) : undefined;
    let guidance = hint(kind, detail, retryAfterMs);
    if (kind === 'route-missing' || kind === 'stale-session') {
      // Both 404 flavours are what an outdated API produces; one memoised health probe tells them apart from a real stale id.
      const h = await apiHealth().catch(() => undefined);
      if (h?.ok && h.eveTools !== true) guidance = OUTDATED_API_HINT;
    }
    throw new NestError(`HTTP ${r.status} — ${detail}. ${guidance}`.trim(), r.status, kind, retryAfterMs);
  }
  return json;
}

function toNestError(e: unknown): NestError {
  if (e instanceof NestError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.name : '';
  if (name === 'TimeoutError' || name === 'AbortError' || /timed? ?out/i.test(msg)) {
    return new NestError(`request timed out after ${TIMEOUT_MS}ms. ${hint('timeout', msg)}`, 0, 'timeout');
  }
  // fetch() network failure (ECONNREFUSED, DNS, reset) surfaces as a TypeError.
  if (e instanceof TypeError || /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(msg)) {
    return new NestError(`${msg}. ${hint('network', msg)}`, 0, 'network');
  }
  return new NestError(msg, 0, 'http');
}

const jitter = (ms: number) => Math.round(ms * (0.75 + Math.random() * 0.5));

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (raw) {
      const e = toNestError(raw);
      if (attempt >= RETRIES || !isRetryable(e)) throw e;
      const wait = e.retryAfterMs ?? jitter(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!);
      console.warn(`[eve] ${label} failed (${e.kind}: ${e.message.split('. ')[0]}); retry ${attempt + 1}/${RETRIES} in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(process.env.NETBENCH_API_TOKEN ? { authorization: `Bearer ${process.env.NETBENCH_API_TOKEN}` } : {}),
    ...extra,
  };
}

export interface NestOptions {
  /**
   * Makes the POST safe to retry: the API replays the first response for the same key instead of applying twice
   * (a timed-out attempt may have succeeded server-side). Use newIdempotencyKey().
   */
  idempotencyKey?: string;
  timeoutMs?: number;
}

export const newIdempotencyKey = (purpose: string): string => `${purpose}-${randomUUID()}`;

export async function nest<T>(path: string, body: unknown, opts: NestOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const payload = opts.idempotencyKey && body && typeof body === 'object' ? { ...(body as object), idempotencyKey: opts.idempotencyKey } : body;
  return withRetry(`POST ${path}`, async () => {
    const r = await fetch(`${API}/api${path}`, {
      method: 'POST',
      headers: headers(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return parse<T>(r);
  });
}

export async function nestGet<T>(path: string, timeoutMs = TIMEOUT_MS): Promise<T> {
  return withRetry(`GET ${path}`, async () =>
    parse<T>(await fetch(`${API}/api${path}`, { headers: headers(), signal: AbortSignal.timeout(timeoutMs) })),
  );
}

export interface ApiHealth {
  ok: boolean;
  api: string;
  status: number;
  latencyMs: number;
  version?: string;
  eveTools?: boolean;
  detail: string;
  checkedAt: number;
}

let healthCache: ApiHealth | undefined;

/** Single, short GET /api/health (no retries); memoised for a few seconds so error paths can call it freely. */
export async function apiHealth(force = false): Promise<ApiHealth> {
  if (!force && healthCache && Date.now() - healthCache.checkedAt < 5000) return healthCache;
  const started = Date.now();
  let h: ApiHealth;
  try {
    const r = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(5000) });
    const body = (await r.json().catch(() => ({}))) as { ok?: boolean; version?: string; eveTools?: boolean; message?: string };
    h = {
      ok: r.ok && body.ok === true,
      api: API,
      status: r.status,
      latencyMs: Date.now() - started,
      version: body.version,
      eveTools: body.eveTools,
      detail: !r.ok
        ? `HTTP ${r.status} ${body.message ?? r.statusText}`
        : body.ok === true
          ? body.eveTools === true
            ? 'healthy'
            : 'healthy but an older build than this Eve agent (no eveTools flag): /eve/tools/confirm and labKey session resolution are missing — redeploy apps/api from main'
          : `${API} answered /api/health without ok:true — NETBENCH_API_URL points at something that is not the NetBench API`,
      checkedAt: Date.now(),
    };
  } catch (e) {
    const err = toNestError(e);
    h = { ok: false, api: API, status: 0, latencyMs: Date.now() - started, detail: `${err.kind}: ${err.message.split('. ')[0]}`, checkedAt: Date.now() };
  }
  healthCache = h;
  return h;
}

/**
 * Mint a one-time Nest confirmToken for a mutating tool. The host mints it; never take a token from the model
 * — it will invent "approve" / request ids. Resolves labId as the Nest session UUID, the engine lab id or the labKey.
 */
export async function mintConfirm(labId: string, purpose: string): Promise<string> {
  let r: { confirmToken?: string };
  try {
    r = await nest<{ confirmToken?: string }>('/eve/tools/confirm', { labId, purpose });
  } catch (raw) {
    const e = toNestError(raw);
    let extra = '';
    if (e.kind === 'network' || e.kind === 'timeout') {
      const h = await apiHealth(true);
      extra = h.ok ? ' (health probe now succeeds — the outage may be transient, retry once)' : ` (health probe: ${h.detail})`;
    }
    throw new NestError(`Could not authorise ${purpose}: ${e.message}${extra}`, e.status, e.kind, e.retryAfterMs);
  }
  if (!r.confirmToken) throw new NestError(`confirmToken mint returned no token for labId=${labId}`, 0, 'http');
  return r.confirmToken;
}
