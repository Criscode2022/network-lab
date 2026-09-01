import { Injectable, signal } from '@angular/core';

const LOCAL =
  typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
const API = LOCAL ? '/api' : 'https://api-production-caeb.up.railway.app/api';
const WS = LOCAL
  ? `${typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws'}://${typeof location !== 'undefined' ? location.host : '127.0.0.1:4200'}/ws`
  : 'wss://api-production-caeb.up.railway.app/ws';

export type CableMedia = 'ethernet' | 'straight' | 'crossover' | 'fiber';

export interface IfacePeer {
  device: string;
  deviceId: string;
  iface: string;
  linkId: string;
  cable: CableMedia | 'radio';
}

export interface IfaceState {
  name: string;
  mac: string;
  adminUp: boolean;
  operUp: boolean;
  status?: string;
  statusReason?: string;
  ipv4?: { ip: string; prefix: number };
  ipv6: { ip: string; prefix: number }[];
  mode: string;
  accessVlan: number;
  isRadio?: boolean;
  zone?: string;
  peer?: IfacePeer | null;
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
  cable?: CableMedia;
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
  { kind: 'workstation', label: 'PC', hint: 'A computer to ping from' },
  { kind: 'server', label: 'Server', hint: 'Linux host with a service' },
  { kind: 'switch', label: 'Switch', hint: 'Plug Ethernet cables here' },
  { kind: 'router', label: 'Router', hint: 'IPv4 between networks' },
  { kind: 'firewall', label: 'Firewall', hint: 'Allow or block traffic' },
  { kind: 'ap', label: 'Wi-Fi AP', hint: 'Wireless access point' },
  { kind: 'wlc', label: 'WLC', hint: 'Wireless controller' },
  { kind: 'cloud', label: 'Internet', hint: 'Outside network stub' },
];

export const CABLE_TYPES: { id: CableMedia; label: string; hint: string; advanced?: boolean }[] = [
  { id: 'ethernet', label: 'Ethernet', hint: 'Auto-MDIX — any two Ethernet ports get a link' },
  { id: 'straight', label: 'Straight-through', hint: 'Unlike devices: PC or router to a switch', advanced: true },
  { id: 'crossover', label: 'Crossover', hint: 'Like devices: PC–PC, switch–switch, router–router', advanced: true },
  { id: 'fiber', label: 'Fiber', hint: 'SFP on switch, router, firewall, AP, WLC', advanced: true },
];

type WsMsg = {
  type?: string;
  output?: string;
  prompt?: string;
  error?: boolean;
  events?: PacketEvent[];
  packets?: PacketEvent[];
  state?: LabState;
};

const GUEST_LAB_KEY = 'nb_guest_lab';

type GuestSnap = { v: 1; at: number; lab: unknown };

@Injectable({ providedIn: 'root' })
export class Api {
  token = signal<string | null>(localStorage.getItem('nb_token'));
  guest = signal(true);
  sessionId = signal<string | null>(null);
  state = signal<LabState | null>(null);
  warning = signal<string | null>(null);
  onPackets: ((events: PacketEvent[]) => void) | null = null;

  private ws: WebSocket | null = null;
  private wsReady: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private cliWaiters: Array<(msg: WsMsg) => void> = [];

  private headers(): HeadersInit {
    const t = this.token();
    return { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) };
  }

  disconnectWs(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.ws;
    this.ws = null;
    this.wsReady = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  }

  connectWs(): void {
    const id = this.sessionId();
    if (!id || typeof WebSocket === 'undefined') return;
    this.disconnectWs();
    const socket = new WebSocket(`${WS}?sessionId=${id}`);
    this.ws = socket;
    this.wsReady = new Promise((resolve) => {
      socket.onopen = () => resolve();
    });
    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as WsMsg;
        if (msg.state) this.state.set(msg.state);
        const packets = msg.packets ?? (msg.type === 'cli' ? msg.events : undefined);
        if (packets?.length) this.onPackets?.(packets);
        if (msg.type === 'cli' || msg.type === 'error') {
          const waiter = this.cliWaiters.shift();
          waiter?.(msg);
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.reconnectTimer = setTimeout(() => this.connectWs(), 1200);
    };
  }

  async json<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(`${API}${path}`, { ...init, headers: { ...this.headers(), ...(init?.headers ?? {}) } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((body as { message?: string }).message || r.statusText);
    return body as T;
  }

  userId(): string {
    const t = this.token();
    if (!t) return 'anon';
    try {
      const mid = t.split('.')[1] ?? '';
      const json = JSON.parse(atob(mid.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string };
      return json.sub || 'anon';
    } catch {
      return 'anon';
    }
  }

  async startGuest(): Promise<void> {
    const r = await this.json<{ token: string; warning?: string; user: { guest: boolean } }>('/auth/guest', { method: 'POST', body: '{}' });
    this.token.set(r.token);
    localStorage.setItem('nb_token', r.token);
    this.guest.set(true);
    this.warning.set(
      r.warning ?? 'Guest — this lab is saved in this browser. Sign in to keep it on your account and other devices.',
    );
  }

  async login(email: string, password: string): Promise<void> {
    const r = await this.json<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    this.token.set(r.token);
    localStorage.setItem('nb_token', r.token);
    this.guest.set(false);
    this.warning.set(null);
    await this.promoteGuestLab();
  }

  async register(email: string, password: string): Promise<void> {
    const r = await this.json<{ token: string }>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
    this.token.set(r.token);
    localStorage.setItem('nb_token', r.token);
    this.guest.set(false);
    this.warning.set(null);
    await this.promoteGuestLab();
  }

  readGuestLab(): unknown | null {
    try {
      const raw = localStorage.getItem(GUEST_LAB_KEY);
      if (!raw) return null;
      const snap = JSON.parse(raw) as GuestSnap;
      return snap?.lab ?? null;
    } catch {
      return null;
    }
  }

  private writeGuestLab(lab: unknown): void {
    try {
      const snap: GuestSnap = { v: 1, at: Date.now(), lab };
      localStorage.setItem(GUEST_LAB_KEY, JSON.stringify(snap));
    } catch {
      /* quota / private mode */
    }
  }

  private async promoteGuestLab(): Promise<void> {
    const lab = this.readGuestLab();
    if (!lab || typeof lab !== 'object') return;
    try {
      await this.json('/labs', { method: 'POST', body: JSON.stringify(lab) });
    } catch {
      /* account save is optional */
    }
  }

  persistSoon(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.save().catch(() => undefined);
    }, 600);
  }

  builtins() {
    return this.json<{ labs: { id: string; name: string; goal: string }[] }>('/labs/builtin');
  }

  async open(labId?: string, lab?: unknown): Promise<void> {
    if (!this.token()) await this.startGuest();
    if (!lab && labId) {
      const guest = this.readGuestLab() as { id?: string } | null;
      if (guest && guest.id === labId) lab = guest;
    }
    const r = await this.json<{ sessionId: string; state: LabState; warning?: string }>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ labId, lab }),
    });
    this.sessionId.set(r.sessionId);
    this.state.set(r.state);
    if (r.warning) this.warning.set(r.warning);
    this.connectWs();
    this.persistSoon();
  }

  async refresh(): Promise<void> {
    const id = this.sessionId();
    if (!id) return;
    this.state.set(await this.json<LabState>(`/sessions/${id}/state`));
    this.persistSoon();
  }

  async cli(deviceId: string, line: string) {
    const id = this.sessionId();
    if (this.ws && this.ws.readyState !== WebSocket.OPEN && this.wsReady) {
      await Promise.race([this.wsReady, new Promise((r) => setTimeout(r, 800))]);
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      const reply = await new Promise<WsMsg>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('CLI websocket timeout')), 15000);
        this.cliWaiters.push((msg) => {
          clearTimeout(t);
          resolve(msg);
        });
        this.ws!.send(JSON.stringify({ type: 'cli', deviceId, line }));
      });
      if (reply.state) {
        this.state.set(reply.state);
        this.persistSoon();
      }
      return {
        output: reply.output ?? '',
        prompt: reply.prompt ?? '',
        error: reply.error,
        events: reply.events ?? reply.packets ?? [],
        state: reply.state ?? this.state()!,
      };
    }
    const r = await this.json<{ output: string; prompt: string; error?: boolean; events: PacketEvent[]; state: LabState }>(
      `/sessions/${id}/cli`,
      { method: 'POST', body: JSON.stringify({ deviceId, line }) },
    );
    this.state.set(r.state);
    this.persistSoon();
    return r;
  }

  cancelPing(): void {
    const id = this.sessionId();
    if (!id) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'cancel' }));
    }
    void this.json(`/sessions/${id}/cancel`, { method: 'POST', body: '{}' }).catch(() => undefined);
  }

  async save() {
    const id = this.sessionId();
    if (!id) return;
    const r = await this.json<{ ok?: boolean; guest?: boolean; json?: unknown }>(`/sessions/${id}/save`, {
      method: 'POST',
      body: '{}',
    });
    if (this.guest() && r.json) this.writeGuestLab(r.json);
    return r;
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
    this.persistSoon();
  }

  async confirm(purpose: string) {
    const id = this.sessionId();
    return this.json<{ confirmToken: string }>(`/sessions/${id}/confirm`, { method: 'POST', body: JSON.stringify({ purpose }) });
  }

  async applyPatch(patch: unknown, confirmToken: string) {
    const id = this.sessionId();
    const r = await this.json<{ state: LabState }>(`/sessions/${id}/patch`, { method: 'POST', body: JSON.stringify({ patch, confirmToken }) });
    this.state.set(r.state);
    this.persistSoon();
  }

  async applyConfig(deviceId: string, commands: string[], confirmToken: string) {
    const id = this.sessionId();
    const r = await this.json<{ state: LabState }>(`/sessions/${id}/config`, {
      method: 'POST',
      body: JSON.stringify({ deviceId, commands, confirmToken }),
    });
    if (r.state) {
      this.state.set(r.state);
      this.persistSoon();
    } else await this.refresh();
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
