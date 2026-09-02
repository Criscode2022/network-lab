const API =
  process.env.NETBENCH_API_URL ||
  (process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT
    ? 'https://api-production-caeb.up.railway.app'
    : 'http://127.0.0.1:3001');

/** Retries per Nest call on network errors, 429 and 5xx (so 3 attempts in total). Override with EVE_NEST_RETRIES. */
const RETRIES = Number.isFinite(Number(process.env.EVE_NEST_RETRIES)) ? Math.max(0, Number(process.env.EVE_NEST_RETRIES)) : 2;
const BACKOFF_MS = [1500, 4000];

class NestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function retryable(e: unknown): boolean {
  if (e instanceof NestError) return e.status === 429 || e.status >= 500;
  // fetch() network failure (ECONNREFUSED, DNS, reset) surfaces as a TypeError.
  return e instanceof TypeError || (e instanceof Error && /fetch failed|ECONN|ETIMEDOUT|socket/i.test(e.message));
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= RETRIES || !retryable(e)) throw e;
      const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      console.warn(`[eve] ${label} failed (${e instanceof Error ? e.message : String(e)}); retry ${attempt + 1}/${RETRIES} in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      attempt++;
    }
  }
}

async function parse<T>(r: Response): Promise<T> {
  const json = (await r.json().catch(() => ({}))) as T & { message?: string | string[] };
  if (!r.ok) {
    const msg = Array.isArray(json.message) ? json.message.join(', ') : json.message;
    throw new NestError(msg || r.statusText || `HTTP ${r.status}`, r.status);
  }
  return json;
}

export async function nest<T>(path: string, body: unknown): Promise<T> {
  return withRetry(`POST ${path}`, async () => {
    const r = await fetch(`${API}/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(process.env.NETBENCH_API_TOKEN ? { authorization: `Bearer ${process.env.NETBENCH_API_TOKEN}` } : {}) },
      body: JSON.stringify(body),
    });
    return parse<T>(r);
  });
}

export async function nestGet<T>(path: string): Promise<T> {
  return withRetry(`GET ${path}`, async () => parse<T>(await fetch(`${API}/api${path}`)));
}

/**
 * Mint a one-time Nest confirmToken for a mutating tool. The host mints it; never take a token from the model
 * — it will invent "approve" / request ids. Resolves labId as either the Nest session UUID or the engine lab id.
 */
export async function mintConfirm(labId: string, purpose: string): Promise<string> {
  let r: { confirmToken?: string };
  try {
    r = await nest<{ confirmToken?: string }>('/eve/tools/confirm', { labId, purpose });
  } catch (e) {
    const status = e instanceof NestError ? e.status : 0;
    const detail = e instanceof Error ? e.message : String(e);
    const hint =
      status === 404
        ? ' The lab session id is stale: re-read labSessionId from the newest [NetBench context] block and call the tool again with that exact value.'
        : status === 429
          ? ' Rate limited — wait for the number of seconds stated, then retry once.'
          : status === 0
            ? ` The NetBench API at ${API} is unreachable from the Eve host; tell the user the API is down (this is not a lab problem).`
            : '';
    throw new Error(`confirm for ${purpose} rejected (HTTP ${status || 'network'}): ${detail}.${hint}`);
  }
  if (!r.confirmToken) throw new Error(`confirmToken mint failed for labId=${labId}`);
  return r.confirmToken;
}
