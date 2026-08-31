const API = process.env.NETBENCH_API_URL || 'http://127.0.0.1:3001';

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
