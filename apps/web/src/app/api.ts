import { Injectable, signal } from '@angular/core';

const API =
  typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? '/api'
    : 'https://api-production-caeb.up.railway.app/api';

export interface IfaceState {
  name: string;
  mac: string;
  adminUp: boolean;
  operUp: boolean;
  ipv4?: { ip: string; prefix: number };
  ipv6: { ip: string; prefix: number }[];
  mode: string;
  accessVlan: number;
  isRadio?: boolean;
  zone?: string;
}

export interface DeviceState {
  id: string;
  name: string;
  hostname: string;
  kind: string;
  x: number;
  y: number;
  associatedSsid?: string;
  ifaces: IfaceState[];
  runningConfig: string;
  ospfNeighbors?: { routerId: string; state: string }[];
}

export interface LinkState {
  id: string;
  kind: 'copper' | 'radio';
  ssid?: string;
  a: { device: string; iface: string; deviceId: string };
  b: { device: string; iface: string; deviceId: string };
}

export interface PacketEvent {
  id: string;
  t: number;
  from: { device: string; iface: string };
  to?: { device: string; iface: string };
  srcMac: string;
  dstMac: string;
  vlan?: number;
  ssid?: string;
  srcIp?: string;
  dstIp?: string;
  proto: string;
  ttl?: number;
  reason: string;
  drop?: boolean;
  simulated?: boolean;
}

export interface LabState {
  id: string;
  name: string;
  goal: string;
  description?: string;
  differsNote: string;
  warnings: string[];
  devices: DeviceState[];
  links: LinkState[];
  packets: PacketEvent[];
  checks: unknown[];
  lastCheck: { ok: boolean; results: { reason: string; ok: boolean }[] } | null;
  highlightIds: string[];
}

export const PALETTE: { kind: string; label: string; hint: string }[] = [
  { kind: 'workstation', label: 'Workstation', hint: 'eth0 + wlan0' },
  { kind: 'server', label: 'Server', hint: 'Linux' },
  { kind: 'switch', label: 'L2 Switch', hint: '8×Gi' },
  { kind: 'router', label: 'Router', hint: '4-port edge' },
  { kind: 'firewall', label: 'Firewall', hint: 'stateful' },
  { kind: 'ap', label: 'Access Point', hint: 'uplink + radio' },
  { kind: 'wlc', label: 'WLC', hint: 'capwap-lite' },
  { kind: 'cloud', label: 'Internet', hint: 'cloud stub' },
];

@Injectable({ providedIn: 'root' })
export class Api {
  token = signal<string | null>(localStorage.getItem('nb_token'));
  guest = signal(true);
  sessionId = signal<string | null>(null);
  state = signal<LabState | null>(null);
  warning = signal<string | null>(null);

  private headers(): HeadersInit {
    const t = this.token();
    return { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) };
  }

  async json<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(`${API}${path}`, { ...init, headers: { ...this.headers(), ...(init?.headers ?? {}) } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((body as { message?: string }).message || r.statusText);
    return body as T;
  }

  async startGuest(): Promise<void> {
    const r = await this.json<{ token: string; warning?: string; user: { guest: boolean } }>('/auth/guest', { method: 'POST', body: '{}' });
    this.token.set(r.token);
    localStorage.setItem('nb_token', r.token);
    this.guest.set(true);
    this.warning.set(r.warning ?? 'Guest session — reload loses unsaved labs. Sign in to save.');
  }

  async login(email: string, password: string): Promise<void> {
    const r = await this.json<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    this.token.set(r.token);
    localStorage.setItem('nb_token', r.token);
    this.guest.set(false);
    this.warning.set(null);
  }

  async register(email: string, password: string): Promise<void> {
    const r = await this.json<{ token: string }>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
    this.token.set(r.token);
    localStorage.setItem('nb_token', r.token);
    this.guest.set(false);
    this.warning.set(null);
  }

  builtins() {
    return this.json<{ labs: { id: string; name: string; goal: string }[] }>('/labs/builtin');
  }

  async open(labId?: string, lab?: unknown): Promise<void> {
    if (!this.token()) await this.startGuest();
    const r = await this.json<{ sessionId: string; state: LabState; warning?: string }>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ labId, lab }),
    });
    this.sessionId.set(r.sessionId);
    this.state.set(r.state);
    if (r.warning) this.warning.set(r.warning);
  }

  async refresh(): Promise<void> {
    const id = this.sessionId();
    if (!id) return;
    this.state.set(await this.json<LabState>(`/sessions/${id}/state`));
  }

  async cli(deviceId: string, line: string) {
    const id = this.sessionId();
    const r = await this.json<{ output: string; prompt: string; error?: boolean; events: PacketEvent[]; state: LabState }>(
      `/sessions/${id}/cli`,
      { method: 'POST', body: JSON.stringify({ deviceId, line }) },
    );
    this.state.set(r.state);
    return r;
  }

  cancelPing(): void {
    const id = this.sessionId();
    if (!id) return;
    try {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws?sessionId=${id}`);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'cancel' }));
        ws.close();
      };
    } catch {
      /* ignore */
    }
  }

  async save() {
    const id = this.sessionId();
    if (!id) return;
    return this.json(`/sessions/${id}/save`, { method: 'POST', body: '{}' });
  }

  async check() {
    const id = this.sessionId();
    const r = await this.json<{ ok: boolean; results: { reason: string; ok: boolean }[] }>(`/sessions/${id}/check`, { method: 'POST', body: '{}' });
    await this.refresh();
    return r;
  }

  async edit(patch: unknown, move?: { id: string; x: number; y: number }[]) {
    const id = this.sessionId();
    const r = await this.json<{ state: LabState }>(`/sessions/${id}/edit`, { method: 'POST', body: JSON.stringify({ patch, move }) });
    this.state.set(r.state);
  }

  async confirm(purpose: string) {
    const id = this.sessionId();
    return this.json<{ confirmToken: string }>(`/sessions/${id}/confirm`, { method: 'POST', body: JSON.stringify({ purpose }) });
  }

  async applyPatch(patch: unknown, confirmToken: string) {
    const id = this.sessionId();
    const r = await this.json<{ state: LabState }>(`/sessions/${id}/patch`, { method: 'POST', body: JSON.stringify({ patch, confirmToken }) });
    this.state.set(r.state);
  }

  async applyConfig(deviceId: string, commands: string[], confirmToken: string) {
    const id = this.sessionId();
    const r = await this.json<{ state: LabState }>(`/sessions/${id}/config`, {
      method: 'POST',
      body: JSON.stringify({ deviceId, commands, confirmToken }),
    });
    if (r.state) this.state.set(r.state);
    else await this.refresh();
  }

  async highlight(deviceIds: string[]) {
    const id = this.sessionId();
    await this.json(`/sessions/${id}/highlight`, { method: 'POST', body: JSON.stringify({ deviceIds }) });
    await this.refresh();
  }

  async path(src: string, dst: string, proto = 'icmp', family = 'v4') {
    const id = this.sessionId();
    return this.json<{ ok: boolean; reason: string; events: PacketEvent[]; hops: { device: string; iface: string; reason: string }[] }>(
      `/sessions/${id}/path`,
      { method: 'POST', body: JSON.stringify({ src, dst, proto, family }) },
    );
  }

  commands(kind: string) {
    return this.json<{ commands: { cmd: string; help: string }[] }>(`/commands/${kind}`);
  }

  eveTool(name: string, body: unknown) {
    return this.json(`/eve/tools/${name}`, { method: 'POST', body: JSON.stringify(body) });
  }
}
