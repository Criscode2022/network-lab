import { Injectable, computed, signal } from '@angular/core';

const LOCAL =
  typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
const API = LOCAL ? '/api' : 'https://api-production-caeb.up.railway.app/api';
const WS = LOCAL
  ? `${typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws'}://${typeof location !== 'undefined' ? location.host : '127.0.0.1:4200'}/ws`
  : 'wss://api-production-caeb.up.railway.app/ws';

export type CableMedia = 'ethernet' | 'straight' | 'crossover' | 'fiber';
export const SWITCH_PROFILES = ['unmanaged', 'managed-l2', 'multilayer'] as const;
export type SwitchProfile = (typeof SWITCH_PROFILES)[number];

export function nextSwitchProfile(profile: SwitchProfile): SwitchProfile {
  const i = SWITCH_PROFILES.indexOf(profile);
  return SWITCH_PROFILES[i < 0 ? 0 : (i + 1) % SWITCH_PROFILES.length];
}

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
  nativeVlan?: number;
  helperAddress?: string;
  isRadio?: boolean;
  zone?: string;
  peer?: IfacePeer | null;
}

export interface DeviceState {
  id: string;
  name: string;
  hostname: string;
  kind: string;
  switchProfile?: SwitchProfile;
  ipRouting?: boolean;
  dhcpPools?: { name: string; network?: string; prefix?: number; gateway?: string; dns?: string }[];
  dhcpBindings?: { mac: string; ip: string; iface: string }[];
  dhcpExcluded?: { start: string; end: string }[];
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
  devices: { id?: string; kind: string; switchProfile?: SwitchProfile; name: string; x: number; y: number; hostname?: string; startup?: string[]; post?: string[] }[];
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

export interface PaletteItem {
  id: string;
  kind: string;
  switchProfile?: SwitchProfile;
  label: string;
  hint: string;
}

export const SWITCH_TYPES: PaletteItem[] = [
  { id: 'switch-unmanaged', kind: 'switch', switchProfile: 'unmanaged', label: 'Unmanaged Switch', hint: 'Plug-and-play; no VLANs or CLI' },
  { id: 'switch-managed-l2', kind: 'switch', switchProfile: 'managed-l2', label: 'Managed L2 Switch', hint: 'VLANs, trunks, STP and management SVI' },
  { id: 'switch-multilayer', kind: 'switch', switchProfile: 'multilayer', label: 'Multilayer L3 Switch', hint: 'Inter-VLAN routing, static routes and DHCP' },
];

export const PALETTE: PaletteItem[] = [
  { id: 'workstation', kind: 'workstation', label: 'PC', hint: 'A computer to ping from' },
  { id: 'server', kind: 'server', label: 'Server', hint: 'Linux host with a service' },
  { id: 'switch', kind: 'switch', switchProfile: 'unmanaged', label: 'Switch', hint: 'Unmanaged by default — cycle for managed L2 or multilayer' },
  { id: 'router', kind: 'router', label: 'Router', hint: 'IPv4 between networks' },
  { id: 'firewall', kind: 'firewall', label: 'Firewall', hint: 'Allow or block traffic' },
  { id: 'ap', kind: 'ap', label: 'Wi-Fi AP', hint: 'Wireless access point' },
  { id: 'wlc', kind: 'wlc', label: 'WLC', hint: 'Wireless controller' },
  { id: 'cloud', kind: 'cloud', label: 'Internet', hint: 'Outside network stub' },
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
const LAB_KEY_KEY = 'nb_lab_key';

type GuestSnap = { v: 1; at: number; lab: unknown };

/** Stable per-browser key sent with every session; Eve addresses the lab by it so API restarts do not strand it. */
function loadLabKey(): string {
  try {
    const existing = localStorage.getItem(LAB_KEY_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const fresh = `lab-${(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 24)}`;
    localStorage.setItem(LAB_KEY_KEY, fresh);
    return fresh;
  } catch {
    return `lab-${Math.random().toString(36).slice(2, 14)}`;
  }
}

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
  /** Called after a lost server session was transparently recreated from the last snapshot. */
  onRecovered: (() => void) | null = null;
  readonly labKey = loadLabKey();

  private ws: WebSocket | null = null;
  private wsReady: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private cliWaiters: Array<(msg: WsMsg) => void> = [];
  private lastLab: LabJson | null = null;
  private lastLabId: string | null = null;
  private recovering: Promise<boolean> | null = null;

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
    socket.onclose = (ev) => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.wsConnected.set(false);
      // 4404: the API no longer knows this session (restart/redeploy) — rebuild it instead of reconnecting forever.
      if (ev.code === 4404) {
        void this.recover();
        return;
      }
      this.reconnectTimer = setTimeout(() => this.connectWs(), 1200);
    };
  }

  async json<T>(path: string, init?: RequestInit, opts: { recovered?: boolean } = {}): Promise<T> {
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
      const raw = (body as { message?: string | string[] }).message;
      const msg = Array.isArray(raw) ? raw.join(', ') : raw || r.statusText || `HTTP ${r.status}`;
      const m = path.match(/^\/sessions\/([^/]+)\//);
      if (r.status === 404 && /session not found/i.test(msg) && m && !opts.recovered && m[1] === this.sessionId()) {
        if (await this.recover()) {
          return this.json<T>(path.replace(`/sessions/${m[1]}/`, `/sessions/${this.sessionId()}/`), init, { recovered: true });
        }
      }
      throw new ApiError(msg, r.status);
    }
    return body as T;
  }

  /**
   * The server lost our session (restart, redeploy, eviction): reopen the last saved lab under the same labKey so the
   * UI and Eve keep working. Runs once at a time; returns false when there is nothing to restore from.
   */
  recover(): Promise<boolean> {
    if (this.recovering) return this.recovering;
    this.recovering = (async () => {
      const lab = this.lastLab ?? this.readGuestLab();
      const body = lab ? { lab, labKey: this.labKey } : this.lastLabId ? { labId: this.lastLabId, labKey: this.labKey } : null;
      if (!body) return false;
      try {
        this.disconnectWs();
        const r = await this.json<{ sessionId: string; state: LabState }>(
          '/sessions',
          { method: 'POST', body: JSON.stringify(body) },
          { recovered: true },
        );
        this.sessionId.set(r.sessionId);
        this.state.set(r.state);
        this.connectWs();
        this.persistSoon();
        this.onRecovered?.();
        return true;
      } catch {
        return false;
      } finally {
        this.recovering = null;
      }
    })();
    return this.recovering;
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
      body: JSON.stringify({ labId, lab, labKey: this.labKey }),
    });
    this.sessionId.set(r.sessionId);
    this.state.set(r.state);
    this.lastLab = (lab as LabJson | undefined) ?? null;
    this.lastLabId = labId ?? null;
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
    if (this.recovering) await this.recovering;
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
      if ((reply as { type?: string; error?: unknown }).type === 'error') {
        throw new ApiError(String((reply as { error?: unknown }).error ?? 'CLI failed'), 400);
      }
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
    const snap = r.json ?? r.lab?.json ?? null;
    if (snap) this.lastLab = snap;
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

  commands(kind: string, switchProfile?: SwitchProfile) {
    const query = switchProfile ? `?switchProfile=${encodeURIComponent(switchProfile)}` : '';
    return this.json<{ commands: { cmd: string; help: string }[] }>(`/commands/${kind}${query}`);
  }

  eveTool(name: string, body: unknown) {
    return this.json(`/eve/tools/${name}`, { method: 'POST', body: JSON.stringify(body) });
  }
}
