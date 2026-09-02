import { Injectable, computed, signal } from '@angular/core';

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
  associatedAp?: string;
  sshListen?: boolean;
  ifaces: IfaceState[];
  runningConfig: string;
  ospfNeighbors?: { routerId: string; state: string; iface?: string; peerIp?: string }[];
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

export type LabCheck =
  | { type: 'ping'; src: string; dst: string; family?: 'v4' | 'v6' }
  | { type: 'ssh'; src: string; dst: string; expect: 'allow' | 'deny' }
  | { type: 'wifi-associated'; client: string }
  | { type: 'dhcp-bound'; device: string }
  | { type: 'ospf-full'; a: string; b: string };

export interface CheckItemResult {
  check: LabCheck;
  ok: boolean;
  reason: string;
}

export interface CheckResult {
  ok: boolean;
  results: CheckItemResult[];
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
  activity?: { t: string; msg: string }[];
  checks: LabCheck[];
  lastCheck: CheckResult | null;
  highlightIds: string[];
}

export interface LabJson {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  goal?: string;
  differsNote?: string;
  devices: { id?: string; kind: string; name: string; x: number; y: number; hostname?: string; startup?: string[]; post?: string[] }[];
  links: { a: string; b: string; cable?: CableMedia }[];
  checks: LabCheck[];
}

export interface SavedLab {
  id: string;
  userId: string | null;
  name: string;
  json: LabJson;
  updatedAt: string;
}

export interface PathResult {
  ok: boolean;
  reason: string;
  events: PacketEvent[];
  hops: { device: string; iface: string; reason: string }[];
}

export interface LabSummary {
  id: string;
  name: string;
  goal: string;
  description?: string;
  /** Not part of the builtin curriculum (guest snapshot, edited or shared lab). */
  custom?: boolean;
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

interface TokenPayload {
  sub?: string;
  email?: string;
  guest?: boolean;
  exp?: number;
}

function decodeToken(t: string | null): TokenPayload | null {
  if (!t) return null;
  try {
    const mid = t.split('.')[1] ?? '';
    return JSON.parse(atob(mid.replace(/-/g, '+').replace(/_/g, '/'))) as TokenPayload;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class Api {
  token = signal<string | null>(null);
  private payload = computed(() => decodeToken(this.token()));
  /** True until a real (non-guest) account token is present. */
  guest = computed(() => this.payload()?.guest !== false);
  email = computed(() => (this.guest() ? null : (this.payload()?.email ?? null)));
  sessionId = signal<string | null>(null);
  state = signal<LabState | null>(null);
  warning = signal<string | null>(null);
  /** False after a network-level failure; true again after any successful request. */
  online = signal(true);
  wsConnected = signal(false);
  onPackets: ((events: PacketEvent[]) => void) | null = null;

  private ws: WebSocket | null = null;
  private wsReady: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private cliWaiters: Array<(msg: WsMsg) => void> = [];

  constructor() {
    const stored = localStorage.getItem('nb_token');
    const p = decodeToken(stored);
    if (stored && p && (!p.exp || p.exp * 1000 > Date.now())) this.token.set(stored);
    else if (stored) localStorage.removeItem('nb_token');
  }

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
    this.wsConnected.set(false);
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
      socket.onopen = () => {
        this.wsConnected.set(true);
        resolve();
      };
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
      this.wsConnected.set(false);
      this.reconnectTimer = setTimeout(() => this.connectWs(), 1200);
    };
  }

  async json<T>(path: string, init?: RequestInit): Promise<T> {
    let r: Response;
    try {
      r = await fetch(`${API}${path}`, { ...init, headers: { ...this.headers(), ...(init?.headers ?? {}) } });
    } catch {
      this.online.set(false);
      throw new ApiError('Cannot reach the lab API. Check your connection and try again.', 0);
    }
    this.online.set(true);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (body as { message?: string | string[] }).message;
      throw new ApiError(Array.isArray(msg) ? msg.join(', ') : msg || r.statusText || `HTTP ${r.status}`, r.status);
    }
    return body as T;
  }

  userId(): string {
    return this.payload()?.sub || 'anon';
  }

  private setToken(token: string): void {
    this.token.set(token);
    localStorage.setItem('nb_token', token);
  }

  async startGuest(): Promise<void> {
    const r = await this.json<{ token: string; warning?: string }>('/auth/guest', { method: 'POST', body: '{}' });
    this.setToken(r.token);
    this.warning.set(r.warning ?? 'Guest — this lab is saved in this browser. Sign in to keep it on your account.');
  }

  async login(email: string, password: string): Promise<void> {
    const r = await this.json<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    this.setToken(r.token);
    this.warning.set(null);
    await this.promoteGuestLab();
  }

  async register(email: string, password: string): Promise<void> {
    const r = await this.json<{ token: string }>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
    this.setToken(r.token);
    this.warning.set(null);
    await this.promoteGuestLab();
  }

  async logout(): Promise<void> {
    this.token.set(null);
    localStorage.removeItem('nb_token');
    await this.startGuest();
  }

  readGuestLab(): LabJson | null {
    try {
      const raw = localStorage.getItem(GUEST_LAB_KEY);
      if (!raw) return null;
      const snap = JSON.parse(raw) as GuestSnap;
      return (snap?.lab as LabJson) ?? null;
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
    return this.json<{ labs: LabSummary[] }>('/labs/builtin');
  }

  /** Opens a lab in a new engine session. `fresh` ignores the guest snapshot for builtin ids (Reset lab). */
  async open(labId?: string, lab?: unknown, opts: { fresh?: boolean } = {}): Promise<void> {
    if (!this.token()) await this.startGuest();
    if (!lab && labId && !opts.fresh) {
      const guest = this.readGuestLab();
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

  /** Re-attaches to a still-running engine session (reload without losing ARP tables, terminal state…). */
  async attach(sessionId: string): Promise<boolean> {
    if (!this.token()) await this.startGuest();
    try {
      const st = await this.json<LabState>(`/sessions/${sessionId}/state`);
      if (!st?.devices) return false;
      this.sessionId.set(sessionId);
      this.state.set(st);
      this.connectWs();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) throw e;
      return false;
    }
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
    const r = await this.json<{ ok?: boolean; guest?: boolean; json?: LabJson; lab?: SavedLab }>(`/sessions/${id}/save`, {
      method: 'POST',
      body: '{}',
    });
    if (this.guest() && r.json) this.writeGuestLab(r.json);
    return r;
  }

  /** Current lab as portable JSON (what Download / Share / Undo use). */
  async snapshot(): Promise<LabJson | null> {
    const r = await this.save();
    return r?.json ?? r?.lab?.json ?? null;
  }

  listLabs() {
    return this.json<{ labs: SavedLab[] }>('/labs');
  }

  saveLabAs(lab: LabJson) {
    return this.json<SavedLab>('/labs', { method: 'POST', body: JSON.stringify(lab) });
  }

  deleteLab(id: string) {
    return this.json<{ ok: boolean }>(`/labs/${id}`, { method: 'DELETE' });
  }

  async check() {
    const id = this.sessionId();
    const r = await this.json<CheckResult>(`/sessions/${id}/check`, { method: 'POST', body: '{}' });
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
    return this.json<PathResult>(`/sessions/${id}/path`, {
      method: 'POST',
      body: JSON.stringify({ src, dst, proto, family }),
    });
  }

  commands(kind: string) {
    return this.json<{ commands: { cmd: string; help: string }[] }>(`/commands/${kind}`);
  }

  eveTool(name: string, body: unknown) {
    return this.json(`/eve/tools/${name}`, { method: 'POST', body: JSON.stringify(body) });
  }
}
