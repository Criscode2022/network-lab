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

/** Mint a one-time Nest confirmToken after Eve HITL has already approved the tool. */
export async function mintConfirm(labId: string, purpose: string): Promise<string> {
  const r = await nest<{ confirmToken: string }>(`/sessions/${labId}/confirm`, { purpose });
  return r.confirmToken;
}
