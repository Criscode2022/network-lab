const API =
  process.env.NETBENCH_API_URL ||
  (process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT
    ? 'https://api-production-caeb.up.railway.app'
    : 'http://127.0.0.1:3001');

export async function nest<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API}/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(process.env.NETBENCH_API_TOKEN ? { authorization: `Bearer ${process.env.NETBENCH_API_TOKEN}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = (await r.json().catch(() => ({}))) as T & { message?: string };
  if (!r.ok) throw new Error(json.message || r.statusText);
  return json;
}

export async function nestGet<T>(path: string): Promise<T> {
  const r = await fetch(`${API}/api${path}`);
  const json = (await r.json().catch(() => ({}))) as T & { message?: string };
  if (!r.ok) throw new Error(json.message || r.statusText);
  return json;
}

/**
 * Mint a one-time Nest confirmToken after Eve HITL has already approved the tool.
 * Never take a token from the model — it will invent "approve" / request ids.
 * Resolves labId as either the Nest session UUID or the engine lab id.
 */
export async function mintConfirm(labId: string, purpose: string): Promise<string> {
  const r = await nest<{ confirmToken: string }>('/eve/tools/confirm', { labId, purpose });
  if (!r.confirmToken) throw new Error(`confirmToken mint failed for labId=${labId}`);
  return r.confirmToken;
}
