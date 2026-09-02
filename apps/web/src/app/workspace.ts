import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import {
  Api,
  ApiError,
  CABLE_TYPES,
  PALETTE,
  type CableMedia,
  type CheckItemResult,
  type CheckResult,
  type DeviceState,
  type IfacePeer,
  type IfaceState,
  type LabCheck,
  type LabJson,
  type LabSummary,
  type LinkState,
  type PacketEvent,
  type SavedLab,
} from './api';
import { EveClient } from './eve-client';
import { Icon, KIND_ICON, type IconName } from './icons';
import { QUICK_COMMANDS, Terminal, type TermLine } from './terminal';
import { Packets } from './packets';
import { Toasts, type Toast, type ToastKind } from './toasts';
import { LabPicker } from './lab-picker';
import { CheatSheet } from './cheat-sheet';

type HelpId = 'basics' | 'lab' | 'check' | 'goal' | 'cable' | 'add' | 'ports' | 'ipv4' | 'status' | 'ping' | 'gateway' | 'hints' | 'troubleshoot' | 'checkpoints';
type MobileTab = 'canvas' | 'palette' | 'inspect' | 'term' | 'eve';

export interface ReachResult {
  kind: 'ping' | 'trace';
  ok: boolean;
  reason: string;
  summary: string;
  hops: string[];
}

interface ReachState {
  target: string;
  proto: 'icmp' | 'ssh';
  busy: boolean;
  result: ReachResult | null;
}

/** Devices/links lit up on the canvas after a ping, trace or Check. Built only from engine packet events. */
interface TraceView {
  devices: string[];
  dropDevice?: string;
  linkIds: string[];
  ok: boolean;
  reason: string;
  label: string;
}

export interface Hint {
  id: string;
  level: 'warn' | 'info';
  text: string;
  action?: { label: string; run: () => unknown };
}

interface UndoLink {
  a: string;
  b: string;
  cable?: CableMedia;
}

export type DiagLayer = 'Physical (L1)' | 'Switching (L2)' | 'Addressing & routing (L3)' | 'Policy' | 'Wi-Fi' | 'Service' | 'Unknown';

/** Plain-language reading of one engine drop reason. Every field is derived from engine text or engine state. */
export interface Diagnosis {
  layer: DiagLayer;
  title: string;
  detail: string;
  device?: string;
  iface?: string;
  lookAt: string[];
  commands: { device: string; cmd: string }[];
  fix?: { label: string; run: () => unknown };
  reason: string;
  reachable?: boolean;
}

interface MonitorState {
  src: string;
  dst: string;
  proto: 'icmp' | 'ssh';
  ok: boolean | null;
  reason: string;
  ticks: number;
  busy: boolean;
}

interface Checkpoint {
  id: string;
  name: string;
  at: number;
  labId: string;
  lab: LabJson;
}

interface ConfigDiff {
  device: string;
  status: 'changed' | 'added' | 'removed';
  added: string[];
  removed: string[];
}

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: IconName;
  run: () => unknown;
}

interface ViewOptions {
  subnet: boolean;
  vlan: boolean;
  anim: boolean;
}

const GRID = 24;
const CARD_W_SIMPLE = 112;
const CARD_W_ADV = 132;
const ANCHOR_Y = 34;
const LINUX_KINDS = new Set(['workstation', 'server', 'firewall', 'cloud']);
const PASSED_KEY = 'nb_passed';
const WELCOME_KEY = 'nb_welcome';
const DOCK_KEY = 'nb_dock_h';
const AUTOSAVE_KEY = 'nb_autosave';
const CKPT_KEY = 'nb_ckpt';
const VIEW_KEY = 'nb_view';
const MONITOR_MS = 5000;
const SUBNET_COLORS = ['text-ok-300', 'text-sky-300', 'text-amber-300', 'text-fuchsia-300', 'text-lime-300', 'text-orange-300', 'text-teal-300', 'text-pink-300'];

@Component({
  selector: 'app-workspace',
  imports: [FormsModule, NgClass, NgTemplateOutlet, Icon, Terminal, Packets, Toasts, LabPicker, CheatSheet],
  templateUrl: './workspace.html',
})
export class Workspace implements OnInit, AfterViewInit, OnDestroy {
  readonly api = inject(Api);
  readonly eve = inject(EveClient);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly PALETTE = PALETTE;
  readonly CABLE_TYPES = CABLE_TYPES;
  readonly KIND_ICON = KIND_ICON;

  // ---- lab / session -------------------------------------------------------
  labs = signal<LabSummary[]>([]);
  private builtinIds = new Set<string>();
  loading = signal(true);
  loadError = signal<string | null>(null);
  myLabs = signal<SavedLab[]>([]);
  passed = signal<string[]>(this.readJson<string[]>(PASSED_KEY, []));
  checkResult = signal<(CheckResult & { at: number }) | null>(null);
  checkBusy = signal(false);
  checkOpen = signal(true);
  goalOpen = signal(typeof window === 'undefined' || window.innerWidth >= 768);

  // ---- selection / canvas --------------------------------------------------
  selectedId = signal<string | null>(null);
  pan = signal({ x: 40, y: 40, s: 1 });
  @ViewChild('stage') stage?: ElementRef<HTMLElement>;
  private terminal = viewChild(Terminal);
  dragging: { id: string; ox: number; oy: number } | null = null;
  panning: { x: number; y: number; px: number; py: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; s: number; x: number; y: number; mx: number; my: number } | null = null;
  private gesture: { s: number; x: number; y: number; cx: number; cy: number } | null = null;
  private stageEl: HTMLElement | null = null;
  private pendingFit = false;
  private guarded = new WeakSet<HTMLElement>();
  private tapAt: { x: number; y: number } | null = null;
  private moved = false;
  cableFrom = signal<{ id: string; iface: string } | null>(null);
  cableKind = signal<CableMedia>('ethernet');
  cableArmed = signal(false);
  cableCursor = signal<{ x: number; y: number } | null>(null);
  selectedLinkId = signal<string | null>(null);
  showFreePorts = signal(false);
  placing = signal<string | null>(null);
  animPkts = signal<{ id: string; x1: number; y1: number; x2: number; y2: number; drop?: boolean }[]>([]);
  trace = signal<TraceView | null>(null);
  activeHop = signal<string | null>(null);
  private replayToken = 0;
  private recentAnim = new Map<string, number>();

  // ---- modes ---------------------------------------------------------------
  advanced = signal(typeof localStorage !== 'undefined' && localStorage.getItem('nb_advanced') === '1');
  basic = signal(typeof localStorage === 'undefined' || localStorage.getItem('nb_basic') !== '0');
  isNarrow = signal(typeof window !== 'undefined' && window.innerWidth < 768);
  mobileTab = signal<MobileTab>('canvas');
  eveOpen = signal(this.initialEveOpen());
  /** Focus mode: canvas only, thin header, floating toolbar. Desktop only. */
  focus = signal(typeof localStorage !== 'undefined' && localStorage.getItem('nb_focus') === '1');
  focusTerm = signal(false);
  focusAddOpen = signal(false);
  basicSheet = signal(false);
  addOpen = signal(false);
  moreOpen = signal(false);
  menuOpen = signal(false);
  readonly mobileTabs: { id: MobileTab; label: string; icon: IconName }[] = [
    { id: 'canvas', label: 'Canvas', icon: 'network' },
    { id: 'palette', label: 'Add', icon: 'layers' },
    { id: 'inspect', label: 'Inspect', icon: 'inspect' },
    { id: 'term', label: 'Terminal', icon: 'terminal' },
    { id: 'eve', label: 'Eve', icon: 'sparkles' },
  ];
  private mq: MediaQueryList | null = null;

  // ---- inspector tools -----------------------------------------------------
  inspectorTab = signal<'ifaces' | 'run' | 'routing'>('ifaces');
  ipInput = '10.0.0.30';
  ipPrefix = 24;
  ipBusy = signal(false);
  gwInput = '';
  gwBusy = signal(false);
  gwEdit = signal(false);
  /** Interface whose IPv4 is being edited in the inspector. */
  ipEdit = signal<string | null>(null);
  ipEditValue = '';
  ipEditPrefix = 24;
  wifiSsid = '';
  wifiPsk = '';
  wifiBusy = signal(false);
  wifiOpen = signal(false);
  reach = signal<ReachState | null>(null);
  confirmDel = signal<DeviceState | null>(null);
  confirmReset = signal(false);

  // ---- dock / terminal -----------------------------------------------------
  termDevice = signal<string | null>(null);
  private buffers = signal<Record<string, TermLine[]>>({});
  termLines = computed(() => this.buffers()[this.termDevice() ?? ''] ?? []);
  termBusy = signal(false);
  selectedPkt = signal<PacketEvent | null>(null);
  dockH = signal(this.readNumber(DOCK_KEY, 232));
  private dockDrag: { y: number; h: number } | null = null;
  private vocabCache = new Map<string, string[]>();
  vocab = signal<string[]>([]);

  // ---- dialogs -------------------------------------------------------------
  showCheat = signal(false);
  cheatKind = signal('workstation');
  cheatRows = signal<{ cmd: string; help: string }[]>([]);
  cheatLoading = signal(false);
  authOpen = signal(false);
  authMode = signal<'login' | 'register'>('login');
  authError = signal<string | null>(null);
  authBusy = signal(false);
  email = '';
  password = '';
  saveAsOpen = signal(false);
  saveAsName = '';
  saveAsBusy = signal(false);
  shortcutsOpen = signal(false);
  aboutOpen = signal(false);
  welcomeOpen = signal(false);
  helpOpen = signal<HelpId | 'hub' | null>(null);
  toasts = signal<Toast[]>([]);
  private toastSeq = 0;
  private toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

  // ---- troubleshoot / monitor / checkpoints / editor / palette / view --------
  diagnosis = signal<Diagnosis | null>(null);
  diagBusy = signal(false);
  monitor = signal<MonitorState | null>(null);
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  checkpoints = signal<Checkpoint[]>(this.readJson<Checkpoint[]>(CKPT_KEY, []));
  checkpointsOpen = signal(false);
  ckptName = '';
  diff = signal<{ against: Checkpoint; rows: ConfigDiff[]; links: { added: string[]; removed: string[] } } | null>(null);
  labEditOpen = signal(false);
  labEdit = { name: '', goal: '', description: '' };
  labChecks = signal<LabCheck[]>([]);
  newCheck: { type: LabCheck['type']; src: string; dst: string; family: 'v4' | 'v6'; expect: 'allow' | 'deny'; client: string; device: string; a: string; b: string } = {
    type: 'ping',
    src: '',
    dst: '',
    family: 'v4',
    expect: 'allow',
    client: '',
    device: '',
    a: '',
    b: '',
  };
  labEditBusy = signal(false);
  paletteOpen = signal(false);
  paletteQ = signal('');
  paletteIdx = signal(0);
  view = signal<ViewOptions>({ subnet: true, vlan: true, anim: true, ...this.readJson<Partial<ViewOptions>>(VIEW_KEY, {}) });
  pktOnlySelected = signal(false);

  // ---- eve -----------------------------------------------------------------
  eveInput = '';
  eveMode = signal<'chat' | 'build'>('chat');
  pending = signal<{ title: string; patch?: unknown; deviceId?: string; commands?: string[]; requestId?: string } | null>(null);
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  readonly HELP: Record<HelpId, { title: string; body: string[] }> = {
    basics: {
      title: 'Basic mode',
      body: [
        'This is the simple phone view: a drawing of the network, nothing else.',
        'Tap a box to see its cables, IP and a Ping button. Use Cable to plug two devices. Use + Add for a new PC or switch. Check tests the lab goal.',
        'Turn Basic off in the header if you want the full editor with a terminal, packets and Eve.',
      ],
    },
    lab: {
      title: 'This lab',
      body: [
        'The lab picker holds the practice scenarios in order of difficulty. Each has a goal — what must work when you press Check.',
        'The first three are single-fix labs: plug a cable, add an address, enable a port. Study labs already work; fault labs start broken and tell you what to repair.',
      ],
    },
    check: {
      title: 'Check',
      body: [
        'Check runs this lab’s tests, usually a ping between two PCs.',
        'Green means the path works. Red lists exactly why it failed: no cable, no IPv4, a disabled port, a wrong gateway.',
        'Fix one thing, then Check again. That is how you debug a real network too.',
      ],
    },
    goal: {
      title: 'Lab goal',
      body: [
        'The sentence at the top is the job. Check is true only when every item in its checklist passes.',
        'Read it before you add devices. Most first labs already have cables — you only confirm or fix them.',
      ],
    },
    cable: {
      title: 'Cables',
      body: [
        'Tap Cable, then tap two devices. Ethernet uses the first free port on each (PC eth0, switch Gi0/1, Gi0/2, …).',
        'A green light on the card means the link is up. Amber means the port is disabled or the cable type is wrong.',
        'Tap a cable on the canvas to inspect or unplug it. Each PC has its own eth0 — never share one Ethernet port across PCs.',
      ],
    },
    add: {
      title: 'Add a device',
      body: [
        '+ Add drops a device in the middle of the canvas. Drag it where you want, then Cable it.',
        'PC = a computer you ping from. Switch = a box that joins cables. Router = different IP networks. Server = a host with a service.',
        'A switch usually has no IPv4. That is normal for layer 2.',
      ],
    },
    ports: {
      title: 'Ports',
      body: [
        'Used ports are the ones with a cable. The name on the left is this device; the arrow is the neighbor.',
        'Up = the port is on and the cable has link. Disabled = administratively down — tap it to turn it on. Unplugged = no cable.',
        'Show free ports if you need an empty switch jack. Do not plug two cables into the same port.',
      ],
    },
    ipv4: {
      title: 'IPv4 address',
      body: [
        'PCs and routers need an IPv4 address to ping. Same network means the same prefix, often /24 (255.255.255.0).',
        'Example: 10.0.0.10/24 can ping 10.0.0.20/24. 10.0.1.20/24 is a different network and needs a router.',
        'Add IP fills the next free host on the busiest subnet. A switch with no IP is fine.',
      ],
    },
    status: {
      title: 'Up and Disabled',
      body: [
        'Tap Up or Disabled to shut or no-shut the port. Same idea as ip link set eth0 down on Linux, or shutdown on a Cisco switch.',
        'A cabled port that is Disabled will not pass pings. Turn it Up, then Check.',
      ],
    },
    ping: {
      title: 'Ping, Trace and Watch',
      body: [
        'Ping sends ICMP echo from this device to a target and reports whether a reply came back.',
        'Trace asks the engine for the exact hop-by-hop path. Every hop lights up on the canvas and a drop shows the honest reason.',
        'Watch repeats the test every five seconds while you work. The moment the path works it turns green and stops.',
        'The command that ran is echoed in the terminal so you can learn it.',
      ],
    },
    troubleshoot: {
      title: 'Troubleshoot',
      body: [
        'Troubleshoot traces the failing check and reads the engine’s drop reason: which device dropped the packet and at which layer — cable, VLAN, addressing/routing, or policy.',
        'It never guesses. The explanation is built from the drop text plus the device state, so “Look at” always names real interfaces and settings.',
        'Use the verify buttons to run the matching show command, or apply the suggested fix when there is one.',
      ],
    },
    checkpoints: {
      title: 'Checkpoints',
      body: [
        'Save a checkpoint before a risky change. Diff later shows exactly which configuration lines were added or removed on each device, plus cables added or removed.',
        'Restore reopens the lab as it was at that moment. Checkpoints live in this browser.',
      ],
    },
    gateway: {
      title: 'Default gateway',
      body: [
        'A host only knows its own network. To reach another network it hands packets to a router — the default gateway.',
        'On Linux: ip route add default via 10.0.0.1. The gateway must be on the same subnet as the host.',
        'A wrong gateway is changed with ip route replace default via <router>, or removed with ip route del default. Cisco routers use no ip route 0.0.0.0 0.0.0.0 <old>.',
      ],
    },
    hints: {
      title: 'Hints',
      body: [
        'Hints are read from the device state: disabled ports, missing IPs, wrong cables, no gateway.',
        'They are not a simulation result. Press Check for the real test — a device can look fine and still not reach its target.',
      ],
    },
  };

  readonly helpTopics: { id: HelpId; title: string }[] = [
    { id: 'basics', title: 'Basic mode' },
    { id: 'lab', title: 'Picking a lab' },
    { id: 'goal', title: 'Lab goal' },
    { id: 'check', title: 'Check' },
    { id: 'add', title: 'Adding devices' },
    { id: 'cable', title: 'Cables' },
    { id: 'ports', title: 'Ports' },
    { id: 'status', title: 'Up and Disabled' },
    { id: 'ipv4', title: 'IPv4 addresses' },
    { id: 'gateway', title: 'Default gateway' },
    { id: 'ping', title: 'Ping, Trace and Watch' },
    { id: 'hints', title: 'Hints' },
    { id: 'troubleshoot', title: 'Troubleshoot' },
    { id: 'checkpoints', title: 'Checkpoints' },
  ];

  readonly shortcuts: { keys: string[]; what: string }[] = [
    { keys: ['Ctrl', 'K'], what: 'Command palette — devices, labs, actions' },
    { keys: ['?'], what: 'Keyboard shortcuts' },
    { keys: ['Esc'], what: 'Cancel cable / placement, close dialogs, clear trace' },
    { keys: ['Del'], what: 'Delete selected device' },
    { keys: ['C'], what: 'Arm an Ethernet cable' },
    { keys: ['T'], what: 'Focus the terminal' },
    { keys: ['E'], what: 'Toggle Eve' },
    { keys: ['F'], what: 'Fit topology to view' },
    { keys: ['Shift', 'F'], what: 'Focus mode — canvas only' },
    { keys: ['+', '−', '0'], what: 'Zoom in / out / reset' },
    { keys: ['Ctrl', 'S'], what: 'Download lab JSON' },
    { keys: ['Ctrl', 'Enter'], what: 'Run Check' },
    { keys: ['↑', '↓'], what: 'Terminal history' },
    { keys: ['Tab'], what: 'Terminal completion' },
    { keys: ['Ctrl', 'C'], what: 'Cancel a running ping (in the terminal)' },
    { keys: ['Ctrl', 'L'], what: 'Clear terminal output' },
  ];

  // ---- computed --------------------------------------------------------------
  selected = computed(() => this.api.state()?.devices.find((d) => d.id === this.selectedId()) ?? null);
  helpView = computed(() => this.helpContent());
  worldW = computed(() => {
    let m = 4000;
    for (const d of this.api.state()?.devices ?? []) m = Math.max(m, d.x + 400);
    return m;
  });
  worldH = computed(() => {
    let m = 3000;
    for (const d of this.api.state()?.devices ?? []) m = Math.max(m, d.y + 300);
    return m;
  });
  gridPos = computed(() => `${this.pan().x}px ${this.pan().y}px`);
  gridSize = computed(() => `${GRID * this.pan().s}px ${GRID * this.pan().s}px`);
  zoomPct = computed(() => Math.round(this.pan().s * 100));
  hints = computed(() => {
    const d = this.selected();
    return d ? this.hintsFor(d) : [];
  });
  labIndex = computed(() => this.labs().findIndex((l) => l.id === this.api.state()?.id));
  nextLab = computed(() => {
    const i = this.labIndex();
    return i >= 0 ? (this.labs()[i + 1] ?? null) : null;
  });
  checklist = computed(() => {
    const st = this.api.state();
    if (!st) return [];
    const last = this.checkResult() ?? st.lastCheck;
    return (st.checks ?? []).map((c) => {
      const r = last?.results.find((x) => JSON.stringify(x.check) === JSON.stringify(c));
      return { label: this.checkLabel(c), ok: r ? r.ok : null, reason: r?.reason ?? '', result: r };
    });
  });
  failedChecks = computed(() => this.checkResult()?.results.filter((r) => !r.ok) ?? []);
  guestLabel = computed(() => (this.api.guest() ? 'Guest' : (this.api.email() ?? 'Account')));
  quickCmds = computed(() => {
    const d = this.api.state()?.devices.find((x) => x.id === this.termDevice());
    return d ? (QUICK_COMMANDS[d.kind] ?? []) : [];
  });
  /** Subnet → colour class, assigned in order of first appearance so the same network always shares a colour. */
  subnetColors = computed(() => {
    const m = new Map<string, string>();
    for (const d of this.api.state()?.devices ?? []) {
      for (const i of d.ifaces) {
        if (!i.ipv4?.ip) continue;
        const n = this.parseV4(i.ipv4.ip);
        if (n == null) continue;
        const key = `${(n & this.maskOf(i.ipv4.prefix || 24)) >>> 0}/${i.ipv4.prefix}`;
        if (!m.has(key)) m.set(key, SUBNET_COLORS[m.size % SUBNET_COLORS.length]);
      }
    }
    return m;
  });
  paletteItems = computed(() => {
    const q = this.paletteQ().trim().toLowerCase();
    const items = this.buildPalette();
    if (!q) return items.slice(0, 40);
    return items.filter((i) => `${i.group} ${i.label} ${i.hint ?? ''}`.toLowerCase().includes(q)).slice(0, 40);
  });
  visiblePacketsFiltered = computed(() => {
    const sel = this.selected();
    const all = this.visiblePackets();
    if (!this.pktOnlySelected() || !sel) return all;
    return all.filter((p) => p.from.device === sel.name || p.to?.device === sel.name);
  });

  // ===========================================================================
  // lifecycle
  // ===========================================================================

  async ngOnInit() {
    this.api.onPackets = (events) => this.animate(events);
    this.mq = window.matchMedia('(max-width: 767px)');
    this.onMq(this.mq);
    this.mq.addEventListener('change', this.onMq);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('pagehide', this.flushGuest);
    this.saveTimer = setInterval(() => {
      const st = this.api.state();
      if (!st) return;
      this.writeAutosave();
      void this.api.save().catch(() => undefined);
    }, 12000);
    await this.boot();
  }

  ngAfterViewInit() {
    const el = this.stage?.nativeElement;
    if (el) this.guardCanvas(el);
    requestAnimationFrame(() => this.fitIfNarrow());
  }

  ngOnDestroy() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pagehide', this.flushGuest);
    this.mq?.removeEventListener('change', this.onMq);
    this.stopMonitor();
    if (this.saveTimer) clearInterval(this.saveTimer);
    for (const t of this.toastTimers.values()) clearTimeout(t);
    this.api.disconnectWs();
    this.eve.stop();
  }

  private flushGuest = () => {
    this.writeAutosave();
    void this.api.save().catch(() => undefined);
  };

  private writeAutosave() {
    const st = this.api.state();
    if (!st) return;
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ id: st.id, sessionId: this.api.sessionId(), at: Date.now() }));
    } catch {
      /* ignore */
    }
  }

  private async boot() {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const b = await this.api.builtins();
      this.labs.set(b.labs);
      this.builtinIds = new Set(b.labs.map((l) => l.id));
      const guestLab = this.api.readGuestLab();
      if (guestLab?.id && guestLab.name && !b.labs.some((l) => l.id === guestLab.id)) {
        this.labs.set([{ id: guestLab.id, name: `${guestLab.name} (this browser)`, goal: guestLab.goal ?? '', custom: true }, ...b.labs]);
      }
      let how: 'shared' | 'attached' | 'opened' = 'opened';
      const shared = this.readShareHash();
      if (shared) {
        await this.api.open(undefined, shared);
        history.replaceState(null, '', location.pathname + location.search);
        how = 'shared';
      } else if (await this.tryAttach()) {
        how = 'attached';
      } else {
        const firstLab = b.labs[0]?.id ?? 'lab-1-first-ipv4-ping';
        try {
          if (guestLab) await this.api.open(undefined, guestLab);
          else await this.api.open(firstLab);
        } catch {
          await this.api.open(firstLab);
        }
      }
      this.afterOpen(how === 'attached');
      if (how === 'shared') this.toast('Opened a shared lab. It is now saved in this browser.', 'success');
      if (how === 'attached') this.toast('Picked up where you left off.', 'info');
      if (!this.api.guest()) void this.loadMyLabs();
      if (how !== 'shared' && localStorage.getItem(WELCOME_KEY) !== '1') this.welcomeOpen.set(true);
    } catch (e) {
      this.loadError.set(this.errMsg(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async tryAttach(): Promise<boolean> {
    const saved = this.readJson<{ id?: string; sessionId?: string; at?: number } | null>(AUTOSAVE_KEY, null);
    if (!saved?.sessionId || !saved.at || Date.now() - saved.at > 12 * 3_600_000) return false;
    try {
      return await this.api.attach(saved.sessionId);
    } catch {
      return false;
    }
  }

  async retryBoot() {
    await this.boot();
  }

  private afterOpen(attached = false) {
    const st = this.api.state();
    const first = st?.devices[0];
    this.selectedId.set(first?.id ?? null);
    this.termDevice.set(first?.id ?? null);
    this.buffers.set({});
    if (first) this.pushLine(first.id, { text: `Connected to ${first.hostname}. Type help.`, sys: true });
    this.checkResult.set(attached && st?.lastCheck ? { ...st.lastCheck, at: Date.now() } : null);
    this.checkOpen.set(!attached);
    this.trace.set(null);
    this.reach.set(null);
    this.diagnosis.set(null);
    this.diff.set(null);
    this.stopMonitor();
    this.selectedPkt.set(null);
    this.selectedLinkId.set(null);
    this.cancelCable();
    this.bindEve();
    this.writeAutosave();
    void this.loadVocab(first?.kind ?? 'workstation');
    requestAnimationFrame(() => (this.isNarrow() ? this.fitIfNarrow() : this.fitToView()));
  }

  private onMq = (e: MediaQueryList | MediaQueryListEvent) => {
    const narrow = e.matches;
    const was = this.isNarrow();
    this.isNarrow.set(narrow);
    if (narrow) {
      this.eveOpen.set(false);
      requestAnimationFrame(() => this.fitIfNarrow());
    } else if (was) this.eveOpen.set(this.initialEveOpen());
  };

  /** Eve starts open only on wide screens (or when the user last left it open); a 1280px canvas needs the room. */
  private initialEveOpen() {
    if (typeof window === 'undefined') return true;
    if (window.innerWidth < 768) return false;
    const saved = localStorage.getItem('nb_eve_open');
    if (saved === '1') return true;
    if (saved === '0') return false;
    return window.innerWidth >= 1440;
  }

  private rememberEve(open: boolean) {
    try {
      localStorage.setItem('nb_eve_open', open ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  // ===========================================================================
  // toasts / errors
  // ===========================================================================

  toast(text: string, kind: ToastKind = 'info', action?: Toast['action'], ms = kind === 'error' ? 8000 : 4500) {
    const id = ++this.toastSeq;
    this.toasts.update((t) => [...t.slice(-3), { id, kind, text, action }]);
    this.toastTimers.set(
      id,
      setTimeout(() => this.dismissToast(id), action ? Math.max(ms, 8000) : ms),
    );
  }

  dismissToast(id: number) {
    const t = this.toastTimers.get(id);
    if (t) clearTimeout(t);
    this.toastTimers.delete(id);
    this.toasts.update((list) => list.filter((x) => x.id !== id));
  }

  /** Kept for the canvas hint bar call sites; hints are toasts now. */
  showHint(msg: string) {
    this.toast(msg, 'info');
  }

  errMsg(e: unknown) {
    if (e instanceof ApiError) return e.message;
    if (e instanceof Error) return e.message;
    return String(e);
  }

  private fail(e: unknown) {
    this.toast(this.errMsg(e), 'error');
  }

  private readJson<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private readNumber(key: string, fallback: number) {
    const n = Number(typeof localStorage !== 'undefined' ? localStorage.getItem(key) : NaN);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  // ===========================================================================
  // labs
  // ===========================================================================

  async loadLab(id: string) {
    this.loading.set(true);
    try {
      await this.api.open(id);
      this.afterOpen();
      this.toast(`Loaded ${this.api.state()?.name}`, 'info');
    } catch (e) {
      this.fail(e);
    } finally {
      this.loading.set(false);
    }
  }

  async openSaved(id: string) {
    await this.loadLab(id);
  }

  async goNextLab() {
    const n = this.nextLab();
    if (n) await this.loadLab(n.id);
  }

  async resetLab() {
    this.confirmReset.set(false);
    const st = this.api.state();
    if (!st) return;
    if (!this.builtinIds.has(st.id)) {
      this.toast('Only built-in labs can be reset to their starting state.', 'warn');
      return;
    }
    this.loading.set(true);
    try {
      await this.api.open(st.id, undefined, { fresh: true });
      this.afterOpen();
      this.toast('Lab reset to its starting state.', 'success');
    } catch (e) {
      this.fail(e);
    } finally {
      this.loading.set(false);
    }
  }

  async loadMyLabs() {
    if (this.api.guest()) {
      this.myLabs.set([]);
      return;
    }
    try {
      const r = await this.api.listLabs();
      this.myLabs.set(r.labs);
    } catch {
      this.myLabs.set([]);
    }
  }

  openSaveAs() {
    this.menuOpen.set(false);
    if (this.api.guest()) {
      this.authOpen.set(true);
      this.toast('Sign in to save labs to your account.', 'info');
      return;
    }
    this.saveAsName = this.api.state()?.name ?? 'My lab';
    this.saveAsOpen.set(true);
  }

  async saveAs() {
    const name = this.saveAsName.trim();
    if (!name) return;
    this.saveAsBusy.set(true);
    try {
      const snap = await this.api.snapshot();
      if (!snap) throw new Error('Nothing to save yet');
      const id = `nb-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
      await this.api.saveLabAs({ ...snap, id, name });
      await this.loadMyLabs();
      this.saveAsOpen.set(false);
      this.toast(`Saved “${name}” to your account.`, 'success');
    } catch (e) {
      this.fail(e);
    } finally {
      this.saveAsBusy.set(false);
    }
  }

  async deleteSaved(id: string) {
    try {
      await this.api.deleteLab(id);
      this.myLabs.update((l) => l.filter((x) => x.id !== id));
      this.toast('Saved lab deleted.', 'info');
    } catch (e) {
      this.fail(e);
    }
  }

  private markPassed(id: string) {
    if (this.passed().includes(id)) return;
    const next = [...this.passed(), id];
    this.passed.set(next);
    try {
      localStorage.setItem(PASSED_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  // ===========================================================================
  // check
  // ===========================================================================

  async doCheck() {
    if (this.checkBusy()) return;
    this.checkBusy.set(true);
    const before = new Set((this.api.state()?.packets ?? []).map((p) => p.id));
    try {
      const r = await this.api.check();
      this.checkResult.set({ ...r, at: Date.now() });
      this.checkOpen.set(true);
      const fresh = (this.api.state()?.packets ?? []).filter((p) => !before.has(p.id));
      if (fresh.length) {
        this.setTrace(fresh, r.ok, r.ok ? 'Check passed' : (r.results.find((x) => !x.ok)?.reason ?? 'Check failed'), 'Check');
        this.animate(fresh);
      }
      const id = this.api.state()?.id;
      if (r.ok && id) this.markPassed(id);
    } catch (e) {
      this.fail(e);
    } finally {
      this.checkBusy.set(false);
    }
  }

  checkLabel(c: LabCheck): string {
    switch (c.type) {
      case 'ping':
        return `${c.src} pings ${c.dst}${c.family === 'v6' ? ' (IPv6)' : ''}`;
      case 'ssh':
        return `SSH ${c.src} → ${c.dst} is ${c.expect === 'allow' ? 'allowed' : 'denied'}`;
      case 'wifi-associated':
        return `${c.client} joins Wi-Fi`;
      case 'dhcp-bound':
        return `${c.device} gets a DHCP lease`;
      case 'ospf-full':
        return `OSPF ${c.a} ↔ ${c.b} reach FULL`;
      default:
        return JSON.stringify(c);
    }
  }

  resultLabel(r: CheckItemResult) {
    return this.checkLabel(r.check);
  }

  async explainCheck() {
    const failed = this.failedChecks();
    if (!failed.length) return;
    this.openEve();
    await this.eve.send(
      `Check failed. Failing items: ${failed.map((f) => `${this.checkLabel(f.check)} — ${f.reason}`).join('; ')}. Use run_check, get_lab_state and get_path to explain the root cause in junior-admin terms, then propose the smallest fix.`,
    );
  }

  // ===========================================================================
  // modes
  // ===========================================================================

  setTab(tab: MobileTab) {
    this.mobileTab.set(tab);
    this.moreOpen.set(false);
    this.addOpen.set(false);
    if (tab === 'eve') this.eveOpen.set(true);
    if (tab === 'canvas') {
      requestAnimationFrame(() => {
        const el = this.stage?.nativeElement;
        if (el) this.guardCanvas(el);
        if (this.pendingFit) this.fitIfNarrow();
      });
    }
    if (tab === 'term') requestAnimationFrame(() => this.terminal()?.focus());
  }

  toggleAdvanced() {
    this.setAdvanced(!this.advanced());
  }

  setAdvanced(next: boolean) {
    this.advanced.set(next);
    if (!next) {
      this.cableKind.set('ethernet');
      if (this.inspectorTab() !== 'ifaces') this.inspectorTab.set('ifaces');
    }
    this.showFreePorts.set(false);
    try {
      localStorage.setItem('nb_advanced', next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  basicMode() {
    return this.isNarrow() && this.basic();
  }

  /** Advanced inspector/cables/ports. Basic mobile always stays simple. */
  advUi() {
    return this.advanced() && !this.basicMode();
  }

  toggleBasic() {
    const next = !this.basic();
    this.basic.set(next);
    try {
      localStorage.setItem('nb_basic', next ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.moreOpen.set(false);
    this.addOpen.set(false);
    this.basicSheet.set(false);
    this.cancelCable();
    if (next) {
      this.mobileTab.set('canvas');
      this.eveOpen.set(false);
      this.setAdvanced(false);
      requestAnimationFrame(() => this.fitIfNarrow());
    }
  }

  toggleEve() {
    if (this.isNarrow()) this.setTab(this.mobileTab() === 'eve' ? 'canvas' : 'eve');
    else this.setEveOpen(!this.eveOpen());
  }

  openEve() {
    if (this.isNarrow()) this.setTab('eve');
    else this.setEveOpen(true);
  }

  setEveOpen(open: boolean) {
    this.eveOpen.set(open);
    this.rememberEve(open);
    requestAnimationFrame(() => this.fitToView());
  }

  /** Desktop focus mode is active (mobile has Basic mode instead). */
  focusMode() {
    return this.focus() && !this.isNarrow();
  }

  toggleFocus() {
    const next = !this.focus();
    this.focus.set(next);
    try {
      localStorage.setItem('nb_focus', next ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.menuOpen.set(false);
    this.focusAddOpen.set(false);
    this.focusTerm.set(false);
    this.placing.set(null);
    if (next) this.goalOpen.set(false);
    requestAnimationFrame(() => this.fitToView());
  }

  toggleFocusTerm() {
    this.focusTerm.set(!this.focusTerm());
    if (this.focusTerm()) requestAnimationFrame(() => this.terminal()?.focus());
    requestAnimationFrame(() => this.fitToView());
  }

  /** Leave focus mode and land on the full inspector for the selected device. */
  openDetails(d: DeviceState) {
    this.selectDevice(d);
    if (this.focusMode()) this.toggleFocus();
  }

  showPalette() {
    if (this.basicMode() || this.focusMode()) return false;
    return !this.isNarrow() || this.mobileTab() === 'palette';
  }
  showCanvas() {
    if (this.basicMode()) return true;
    return !this.isNarrow() || this.mobileTab() === 'canvas';
  }
  showInspect() {
    if (this.basicMode() || this.focusMode()) return false;
    return !this.isNarrow() || this.mobileTab() === 'inspect';
  }
  showEve() {
    if (this.basicMode() || this.focusMode()) return false;
    return this.isNarrow() ? this.mobileTab() === 'eve' : this.eveOpen();
  }
  showTerm() {
    if (this.basicMode()) return false;
    if (this.focusMode()) return this.focusTerm();
    return !this.isNarrow() || this.mobileTab() === 'term';
  }

  closeInspect() {
    if (this.isNarrow()) this.setTab('canvas');
    else this.selectedId.set(null);
  }

  openHelp(id: HelpId | 'hub', ev?: Event) {
    ev?.stopPropagation();
    ev?.preventDefault();
    this.helpOpen.set(id);
  }

  helpContent() {
    const id = this.helpOpen();
    if (!id || id === 'hub') return null;
    const base = this.HELP[id];
    const st = this.api.state();
    if ((id === 'goal' || id === 'lab') && st) {
      const extra = id === 'goal' && st.goal ? [`This lab: ${st.goal}`] : id === 'lab' ? [`${st.name}${st.goal ? ` — ${st.goal}` : ''}`] : [];
      return { title: id === 'lab' ? st.name || base.title : base.title, body: [...extra, ...base.body] };
    }
    return base;
  }

  dismissWelcome(start = false) {
    this.welcomeOpen.set(false);
    try {
      localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      /* ignore */
    }
    const first = this.labs().find((l) => !l.custom)?.id;
    if (start && first && this.api.state()?.id !== first) void this.loadLab(first);
  }

  // ===========================================================================
  // labels / device helpers
  // ===========================================================================

  kindLabel(k: string) {
    const m: Record<string, string> = {
      workstation: 'PC',
      server: 'Server',
      switch: 'Switch',
      router: 'Router',
      firewall: 'Firewall',
      ap: 'Wi-Fi AP',
      wlc: 'WLC',
      cloud: 'Internet',
    };
    return m[k] ?? k;
  }

  kindIcon(k: string): IconName {
    return KIND_ICON[k] ?? 'pc';
  }

  kindColor(k: string) {
    const m: Record<string, string> = {
      workstation: 'bg-sky-950/85 border-sky-500/40',
      server: 'bg-indigo-950/85 border-indigo-400/40',
      switch: 'bg-emerald-950/85 border-emerald-500/40',
      router: 'bg-amber-950/85 border-amber-500/40',
      firewall: 'bg-rose-950/85 border-rose-500/40',
      ap: 'bg-violet-950/85 border-violet-400/40',
      wlc: 'bg-fuchsia-950/85 border-fuchsia-400/40',
      cloud: 'bg-slate-800/90 border-cyan-400/30',
    };
    return m[k] ?? 'bg-ink-800 border-ink-600';
  }

  kindAccent(k: string) {
    const m: Record<string, string> = {
      workstation: 'text-sky-300',
      server: 'text-indigo-300',
      switch: 'text-emerald-300',
      router: 'text-amber-300',
      firewall: 'text-rose-300',
      ap: 'text-violet-300',
      wlc: 'text-fuchsia-300',
      cloud: 'text-cyan-300',
    };
    return m[k] ?? 'text-ink-300';
  }

  isLinux(d: DeviceState) {
    return LINUX_KINDS.has(d.kind);
  }

  primaryIpv4(d: DeviceState): string | null {
    for (const i of d.ifaces) if (i.ipv4?.ip) return `${i.ipv4.ip}/${i.ipv4.prefix}`;
    return null;
  }

  primaryIpv6(d: DeviceState): string | null {
    for (const i of d.ifaces) {
      const g = i.ipv6.find((v) => !v.ip.toLowerCase().startsWith('fe80:'));
      if (g) return `${g.ip}/${g.prefix}`;
    }
    return null;
  }

  ipv4Rows(d: DeviceState) {
    return d.ifaces
      .filter((i) => i.ipv4?.ip)
      .map((i) => ({ name: i.name, ip: `${i.ipv4!.ip}/${i.ipv4!.prefix}`, status: this.linkStatus(i), up: i.operUp }));
  }

  canAddIpv4(d: DeviceState) {
    return d.kind !== 'switch' && this.ipv4Rows(d).length === 0;
  }

  ipIface(d: DeviceState) {
    return d.ifaces.find((i) => !i.isRadio && !i.name.includes('.') && !i.name.toLowerCase().startsWith('vlan'))?.name ?? 'eth0';
  }

  prepareIpv4Form(d: DeviceState) {
    if (!this.canAddIpv4(d)) return;
    const s = this.suggestIpv4();
    this.ipInput = s.ip;
    this.ipPrefix = s.prefix;
  }

  private parseV4(ip: string): number | null {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
  }

  private fmtV4(n: number) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }

  private maskOf(prefix: number) {
    return prefix <= 0 ? 0 : prefix >= 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  }

  private prefixMask(prefix: number) {
    return this.fmtV4(this.maskOf(prefix));
  }

  suggestIpv4() {
    const used = new Set<number>();
    const nets = new Map<string, { network: number; prefix: number; count: number }>();
    for (const d of this.api.state()?.devices ?? []) {
      for (const i of d.ifaces) {
        if (!i.ipv4?.ip) continue;
        const n = this.parseV4(i.ipv4.ip);
        if (n == null) continue;
        used.add(n);
        const p = i.ipv4.prefix || 24;
        const network = (n & this.maskOf(p)) >>> 0;
        const key = `${network}/${p}`;
        const rec = nets.get(key) ?? { network, prefix: p, count: 0 };
        rec.count++;
        nets.set(key, rec);
      }
    }
    const best = [...nets.values()].sort((a, b) => b.count - a.count)[0] ?? { network: this.parseV4('10.0.0.0')!, prefix: 24 };
    const mask = this.maskOf(best.prefix);
    const broadcast = (best.network | (~mask >>> 0)) >>> 0;
    let maxHost = best.network;
    for (const u of used) if (((u & mask) >>> 0) === best.network && u !== broadcast && u > maxHost) maxHost = u;
    for (let h = (maxHost + 1) >>> 0; h < broadcast; h++) if (!used.has(h >>> 0)) return { ip: this.fmtV4(h >>> 0), prefix: best.prefix };
    return { ip: '10.0.0.30', prefix: 24 };
  }

  /** Default gateway as the engine reports it in running-config (`ip route 0.0.0.0 0.0.0.0 GW` or `ip default-gateway`). */
  gatewayOf(d: DeviceState): string | null {
    const m = d.runningConfig.match(/^ip route 0\.0\.0\.0 0\.0\.0\.0 (\S+)/m) ?? d.runningConfig.match(/^ip default-gateway (\S+)/m);
    return m?.[1] ?? null;
  }

  /** Router/firewall/cloud address on this host's own subnet, else the .1 of that subnet. */
  suggestGateway(d: DeviceState): string | null {
    const own = d.ifaces.find((i) => i.ipv4?.ip)?.ipv4;
    if (!own) return null;
    const n = this.parseV4(own.ip);
    if (n == null) return null;
    const mask = this.maskOf(own.prefix || 24);
    const net = (n & mask) >>> 0;
    const routerish = (this.api.state()?.devices ?? []).filter((x) => x.id !== d.id && (x.kind === 'router' || x.kind === 'firewall' || x.kind === 'cloud'));
    for (const r of routerish) {
      for (const i of r.ifaces) {
        const ip = i.ipv4?.ip ? this.parseV4(i.ipv4.ip) : null;
        if (ip != null && ((ip & mask) >>> 0) === net) return i.ipv4!.ip;
      }
    }
    const first = (net + 1) >>> 0;
    return first === n ? null : this.fmtV4(first);
  }

  /** Other subnets exist, so a host with no gateway will not get past its own network. */
  needsGateway(d: DeviceState) {
    if (!(d.kind === 'workstation' || d.kind === 'server')) return false;
    const own = d.ifaces.find((i) => i.ipv4?.ip)?.ipv4;
    if (!own || this.gatewayOf(d)) return false;
    const n = this.parseV4(own.ip);
    if (n == null) return false;
    const mask = this.maskOf(own.prefix || 24);
    const net = (n & mask) >>> 0;
    return (this.api.state()?.devices ?? []).some((x) =>
      x.ifaces.some((i) => {
        const ip = i.ipv4?.ip ? this.parseV4(i.ipv4.ip) : null;
        return ip != null && ((ip & mask) >>> 0) !== net;
      }),
    );
  }

  prepareGatewayForm(d: DeviceState) {
    this.gwInput = this.suggestGateway(d) ?? '';
  }

  /** Gateway set, but not inside the host's own IPv4 subnet — it can never be reached at layer 2. */
  gatewayOffSubnet(d: DeviceState): string | null {
    const gw = this.gatewayOf(d);
    const own = d.ifaces.find((i) => i.ipv4?.ip)?.ipv4;
    if (!gw || !own) return null;
    const g = this.parseV4(gw);
    const n = this.parseV4(own.ip);
    if (g == null || n == null) return null;
    const mask = this.maskOf(own.prefix || 24);
    return ((g & mask) >>> 0) === ((n & mask) >>> 0) ? null : gw;
  }

  /** Gateway set and on-subnet, but no device in the lab owns that address. */
  gatewayUnowned(d: DeviceState): string | null {
    const gw = this.gatewayOf(d);
    if (!gw || this.gatewayOffSubnet(d)) return null;
    const owner = (this.api.state()?.devices ?? []).some((x) => x.id !== d.id && x.ifaces.some((i) => i.ipv4?.ip === gw));
    return owner ? null : gw;
  }

  startGatewayEdit(d: DeviceState) {
    this.gwInput = this.suggestGateway(d) ?? this.gatewayOf(d) ?? '';
    this.gwEdit.set(true);
  }

  startIpEdit(d: DeviceState, iface: string) {
    const i = d.ifaces.find((x) => x.name === iface);
    this.ipEditValue = i?.ipv4?.ip ?? '';
    this.ipEditPrefix = i?.ipv4?.prefix ?? 24;
    this.ipEdit.set(iface);
  }

  linkStatus(i: IfaceState) {
    if (i.isRadio && !i.adminUp) return 'Radio off';
    if (i.status) return i.status;
    if (!i.adminUp) return 'Disabled';
    if (!i.operUp) return i.peer ? 'Down' : 'Unplugged';
    return 'Up';
  }

  statusChipClass(i: IfaceState) {
    if (i.operUp) return 'chip-ok';
    if (i.peer && !i.operUp) return 'chip-warn';
    return 'chip-muted';
  }

  statusChipClassFor(d: DeviceState, name: string) {
    const i = d.ifaces.find((x) => x.name === name);
    return i ? this.statusChipClass(i) : 'chip-muted';
  }

  statusToggleTitle(d: DeviceState, iface: string) {
    const i = d.ifaces.find((x) => x.name === iface);
    if (!i) return 'Toggle port';
    if (i.isRadio) return i.adminUp ? 'Click to disable Wi-Fi radio' : 'Click to enable Wi-Fi radio';
    return i.adminUp ? 'Click to disable this port (shutdown)' : 'Click to enable this port (no shutdown)';
  }

  deviceLed(d: DeviceState): 'up' | 'warn' | 'off' {
    const used = d.ifaces.filter((i) => this.peerOf(d, i.name) || (i.isRadio && d.associatedSsid));
    if (!used.length) return 'off';
    if (used.some((i) => i.operUp)) return 'up';
    return 'warn';
  }

  ipv6Rows(i: IfaceState) {
    const rows = i.ipv6.map((v) => ({ ip: `${v.ip}/${v.prefix}`, linkLocal: v.ip.toLowerCase().startsWith('fe80:') }));
    return [...rows.filter((r) => !r.linkLocal), ...rows.filter((r) => r.linkLocal)];
  }

  cardIfaces(d: DeviceState) {
    return d.ifaces.filter((i) => !i.name.includes('.') && !i.name.toLowerCase().startsWith('vlan'));
  }

  cableRows(d: DeviceState) {
    const rows: { mine: string; peer: string; peerIface: string; linkId: string; cable: string; kind: string }[] = [];
    for (const l of this.api.state()?.links ?? []) {
      const side = l.a.deviceId === d.id ? 'a' : l.b.deviceId === d.id ? 'b' : null;
      if (!side) continue;
      const me = side === 'a' ? l.a : l.b;
      const other = side === 'a' ? l.b : l.a;
      rows.push({
        mine: me.iface,
        peer: this.devName(other.deviceId),
        peerIface: other.iface,
        linkId: l.id,
        cable: l.kind === 'radio' ? 'radio' : (l.cable ?? 'ethernet'),
        kind: l.kind,
      });
    }
    return rows;
  }

  peerOf(d: DeviceState, iface: string): IfacePeer | null {
    const i = d.ifaces.find((x) => x.name.toLowerCase() === iface.toLowerCase());
    if (i?.peer) return i.peer;
    const row = this.cableRows(d).find((c) => c.mine.toLowerCase() === iface.toLowerCase());
    if (!row) return null;
    return { device: row.peer, deviceId: '', iface: row.peerIface, linkId: row.linkId, cable: row.cable as IfacePeer['cable'] };
  }

  portRows(d: DeviceState) {
    return d.ifaces
      .filter((i) => !i.name.includes('.') && !i.name.toLowerCase().startsWith('vlan') && !i.isRadio)
      .map((i) => {
        const peer = this.peerOf(d, i.name);
        return { name: i.name, status: this.linkStatus(i), up: i.operUp, adminUp: i.adminUp, used: !!peer, peer, reason: i.statusReason ?? '' };
      });
  }

  usedPortRows(d: DeviceState) {
    return this.portRows(d).filter((p) => p.used);
  }

  freePortRows(d: DeviceState) {
    return this.portRows(d).filter((p) => !p.used);
  }

  shortPort(name: string) {
    if (name.toLowerCase() === 'wlan0') return 'wifi';
    const gi = name.match(/^Gi0\/(\d+)$/i);
    if (gi) return gi[1];
    return name;
  }

  portChipClass(d: DeviceState, i: IfaceState) {
    const peer = this.peerOf(d, i.name);
    const hover = 'cursor-pointer transition hover:ring-1 hover:ring-brand-400/70 hover:brightness-125';
    if (i.isRadio) return `${hover} ${i.operUp ? 'bg-violet-600/80 text-violet-50' : 'border border-violet-500/50 text-violet-300'}`;
    if (peer && i.operUp) return `${hover} bg-ok-500/80 text-ink-950`;
    if (peer && !i.operUp) return `${hover} bg-warn-500/80 text-ink-950`;
    if (!i.adminUp) return `${hover} border border-ink-700 text-ink-500`;
    return `${hover} border border-ink-500 text-ink-300`;
  }

  portTitle(d: DeviceState, i: IfaceState) {
    const p = this.peerOf(d, i.name);
    const st = this.linkStatus(i);
    if (this.cableArmed() || this.cableFrom()) {
      if (p) return `${i.name} is cabled — unplug first`;
      return `${i.name} ${st} — click to attach cable`;
    }
    if (p) return `${i.name} → ${p.device} ${p.iface} · ${this.cableLabel(p.cable)} · ${st} — click to ${i.adminUp ? 'disable' : 'enable'}`;
    return `${i.name} ${st} — click to ${i.adminUp ? 'disable' : 'enable'}`;
  }

  cableLabel(id: CableMedia | string | undefined) {
    if (id === 'radio') return 'Wi-Fi';
    return CABLE_TYPES.find((c) => c.id === id)?.label ?? 'Ethernet';
  }

  visibleCables() {
    return this.advUi() ? CABLE_TYPES : CABLE_TYPES.filter((c) => !c.advanced);
  }

  effectiveCable(): CableMedia {
    return this.advUi() ? this.cableKind() : 'ethernet';
  }

  devName(id: string) {
    return this.api.state()?.devices.find((d) => d.id === id)?.name ?? id;
  }

  devByName(name: string) {
    const k = name.toLowerCase();
    return this.api.state()?.devices.find((d) => d.name.toLowerCase() === k || d.id.toLowerCase() === k || d.hostname.toLowerCase() === k) ?? null;
  }

  visiblePackets() {
    const all = this.api.state()?.packets ?? [];
    if (this.advanced()) return all;
    const v4 = all.filter((p) => !p.srcIp?.includes(':'));
    return v4;
  }

  activityLog() {
    return this.api.state()?.activity ?? [];
  }

  // ===========================================================================
  // hints (diagnostics from engine state — never a forwarding guess)
  // ===========================================================================

  hintsFor(d: DeviceState): Hint[] {
    const out: Hint[] = [];
    const st = this.api.state();
    if (!st) return out;
    const used = this.usedPortRows(d);
    const reported = new Set<string>();
    for (const p of used) {
      if (!p.adminUp) {
        reported.add(p.name);
        out.push({
          id: `down-${p.name}`,
          level: 'warn',
          text: `${p.name} is administratively down but has a cable to ${p.peer?.device}.`,
          action: { label: 'Enable port', run: () => this.toggleIface(d, p.name) },
        });
        continue;
      }
      if (p.status === 'Wrong cable') {
        const link = st.links.find((l) => l.id === p.peer?.linkId);
        out.push({
          id: `cable-${p.name}`,
          level: 'warn',
          text: `${p.name}: ${p.reason || 'wrong cable type'} (${this.cableLabel(p.peer?.cable)}).`,
          action: link ? { label: 'Replace with Ethernet', run: () => this.replaceCable(link) } : undefined,
        });
        continue;
      }
      if (p.status === 'Down' && p.peer) {
        const other = this.devByName(p.peer.device);
        const oi = other?.ifaces.find((i) => i.name === p.peer!.iface);
        if (other && oi && !oi.adminUp) {
          out.push({
            id: `peerdown-${p.name}`,
            level: 'warn',
            text: `No link on ${p.name}: the other end, ${other.name} ${oi.name}, is disabled.`,
            action: { label: `Enable ${other.name} ${oi.name}`, run: () => this.toggleIface(other, oi.name) },
          });
          continue;
        }
        out.push({ id: `nocarrier-${p.name}`, level: 'warn', text: `${p.name} has a cable but no carrier (${p.reason || 'no carrier'}).` });
      }
    }
    const radio = d.ifaces.find((i) => i.isRadio);
    if (d.kind === 'ap' && radio && !radio.adminUp) {
      out.push({
        id: 'radio-off',
        level: 'warn',
        text: 'The Wi-Fi radio is off; clients cannot associate.',
        action: { label: 'Enable radio', run: () => this.toggleIface(d, radio.name) },
      });
    }
    if (d.kind !== 'switch' && d.kind !== 'wlc' && d.kind !== 'ap' && this.canAddIpv4(d) && (used.length || d.associatedSsid)) {
      const linux = this.isLinux(d);
      out.push({
        id: 'no-ip',
        level: 'warn',
        text: `${d.name} has no IPv4 address, so it cannot ping or be pinged.`,
        action: {
          label: linux && this.dhcpServerExists() ? 'Get one via DHCP' : 'Add IP',
          run: () => (linux && this.dhcpServerExists() ? this.runDhcp(d) : this.focusIpForm(d)),
        },
      });
    }
    for (const i of d.ifaces) {
      if (i.ipv4?.ip && !i.isRadio && !i.name.includes('.') && !i.operUp && !reported.has(i.name)) {
        const p = this.peerOf(d, i.name);
        out.push({
          id: `ip-down-${i.name}`,
          level: 'warn',
          text: `${i.name} has ${i.ipv4.ip} but is ${this.linkStatus(i).toLowerCase()}${p ? '' : ' — cable it to a switch or router'}.`,
          action: !i.adminUp ? { label: 'Enable port', run: () => this.toggleIface(d, i.name) } : undefined,
        });
      }
    }
    if (this.needsGateway(d)) {
      const gw = this.suggestGateway(d);
      out.push({
        id: 'no-gw',
        level: 'warn',
        text: `No default gateway: ${d.name} can only reach its own subnet.`,
        action: gw ? { label: `Set gateway ${gw}`, run: () => this.setGateway(d, gw) } : undefined,
      });
    }
    const offGw = this.gatewayOffSubnet(d);
    if (offGw && d.kind !== 'switch') {
      const gw = this.suggestGateway(d);
      out.push({
        id: 'gw-off-subnet',
        level: 'warn',
        text: `Gateway ${offGw} is not on ${d.name}'s own subnet, so it can never be reached.`,
        action: gw ? { label: `Change to ${gw}`, run: () => this.setGateway(d, gw) } : { label: 'Remove gateway', run: () => this.removeGateway(d) },
      });
    }
    const ghostGw = this.gatewayUnowned(d);
    if (ghostGw && d.kind !== 'switch') {
      const gw = this.suggestGateway(d);
      out.push({
        id: 'gw-unowned',
        level: 'warn',
        text: `No device in this lab has the gateway address ${ghostGw}.`,
        action: gw && gw !== ghostGw ? { label: `Change to ${gw}`, run: () => this.setGateway(d, gw) } : undefined,
      });
    }
    if (d.kind === 'workstation' && !used.length && !d.associatedSsid) {
      const nets = this.wifiNetworks();
      out.push({
        id: 'isolated',
        level: 'warn',
        text: nets.length ? `${d.name} is not connected. Cable it, or join Wi-Fi “${nets[0].ssid}”.` : `${d.name} is not connected to anything yet.`,
        action: nets.length ? { label: 'Join Wi-Fi', run: () => this.openWifi(d) } : { label: 'Cable', run: () => this.armCable('ethernet') },
      });
    }
    if (d.kind === 'server' && !d.sshListen) {
      const ip = d.ifaces.find((i) => i.ipv4?.ip)?.ipv4?.ip;
      const wantsSsh = st.checks.some((c) => c.type === 'ssh' && (c.dst === d.name || c.dst === ip));
      if (wantsSsh) {
        out.push({
          id: 'ssh',
          level: 'warn',
          text: 'This lab expects SSH on the server, but sshd is not running.',
          action: { label: 'Start SSH', run: () => this.runCommands(d, ['systemctl start ssh'], 'SSH started') },
        });
      }
    }
    if (d.kind === 'switch' && !used.length) out.push({ id: 'empty-switch', level: 'info', text: 'Nothing is plugged into this switch yet.' });
    return out;
  }

  private dhcpServerExists() {
    return (this.api.state()?.devices ?? []).some((x) => /^ip dhcp pool /m.test(x.runningConfig));
  }

  private focusIpForm(d: DeviceState) {
    this.prepareIpv4Form(d);
    if (this.isNarrow()) {
      if (this.basicMode()) this.basicSheet.set(true);
      else this.setTab('inspect');
    }
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[name="inspectip"],input[name="newip"]')?.focus());
  }

  // ===========================================================================
  // CLI helpers (every UI action is a real command, echoed into the terminal)
  // ===========================================================================

  private pushLine(deviceId: string, line: TermLine) {
    this.buffers.update((b) => {
      const cur = b[deviceId] ?? [];
      const next = [...cur, line];
      return { ...b, [deviceId]: next.length > 400 ? next.slice(-400) : next };
    });
  }

  promptFor(d: DeviceState | null | undefined) {
    if (!d) return '#';
    return this.isLinux(d) ? `root@${d.hostname}:~#` : `${d.hostname}#`;
  }

  prompt() {
    return this.promptFor(this.api.state()?.devices.find((x) => x.id === this.termDevice()));
  }

  async runCli(d: DeviceState, line: string) {
    this.pushLine(d.id, { text: `${this.promptFor(d)} ${line}`, cmd: true });
    const r = await this.api.cli(d.id, line);
    if (r.output) this.pushLine(d.id, { text: r.output, err: r.error });
    return r;
  }

  /** Runs commands in order, stops at the first error. Returns whether all succeeded. */
  async runCommands(d: DeviceState, cmds: string[], doneMsg?: string): Promise<boolean> {
    this.termDevice.set(d.id);
    try {
      for (const line of cmds) {
        const r = await this.runCli(d, line);
        if (r.error) {
          this.toast(r.output || `Failed: ${line}`, 'error');
          return false;
        }
      }
      await this.api.refresh();
      if (doneMsg) this.toast(doneMsg, 'success');
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  async runLine(line: string) {
    const id = this.termDevice();
    const d = this.api.state()?.devices.find((x) => x.id === id);
    if (!d || !line.trim()) return;
    this.termBusy.set(true);
    try {
      const r = await this.runCli(d, line);
      if (r.events?.length) {
        this.animate(r.events);
        if (/^ping|^traceroute/.test(line.trim())) {
          this.setTrace(r.events, !r.error, this.dropReason(r.events) ?? (r.error ? 'failed' : 'reply received'), line.trim());
        }
      }
    } catch (e) {
      this.pushLine(d.id, { text: this.errMsg(e), err: true });
    } finally {
      this.termBusy.set(false);
    }
  }

  clearTerm() {
    const id = this.termDevice();
    if (!id) return;
    this.buffers.update((b) => ({ ...b, [id]: [] }));
  }

  cancelPing() {
    const id = this.termDevice();
    if (id) this.pushLine(id, { text: '^C', sys: true });
    this.api.cancelPing();
  }

  selectTermDevice(id: string) {
    this.termDevice.set(id);
    const d = this.api.state()?.devices.find((x) => x.id === id);
    if (d) void this.loadVocab(d.kind);
  }

  openTerminalFor(d: DeviceState) {
    this.termDevice.set(d.id);
    void this.loadVocab(d.kind);
    if (this.isNarrow()) this.setTab('term');
    else requestAnimationFrame(() => this.terminal()?.focus());
  }

  private async loadVocab(kind: string) {
    const cached = this.vocabCache.get(kind);
    if (cached) {
      this.vocab.set(cached);
      return;
    }
    try {
      const r = await this.api.commands(kind);
      const words = new Set<string>();
      for (const c of r.commands) {
        for (const w of c.cmd.split(/[\s|/[\]]+/)) {
          if (/^[a-z][a-z0-9-]{1,}$/.test(w)) words.add(w);
        }
      }
      const list = [...words];
      this.vocabCache.set(kind, list);
      this.vocab.set(list);
    } catch {
      this.vocab.set([]);
    }
  }

  insertCommand(cmd: string) {
    this.showCheat.set(false);
    if (this.isNarrow()) this.setTab('term');
    requestAnimationFrame(() => this.terminal()?.setText(cmd));
  }

  async openCheat() {
    this.menuOpen.set(false);
    this.moreOpen.set(false);
    const kind = this.selected()?.kind ?? 'workstation';
    this.showCheat.set(true);
    await this.setCheatKind(kind);
  }

  async setCheatKind(kind: string) {
    this.cheatKind.set(kind);
    this.cheatLoading.set(true);
    try {
      const r = await this.api.commands(kind);
      this.cheatRows.set(r.commands);
    } catch (e) {
      this.cheatRows.set([]);
      this.fail(e);
    } finally {
      this.cheatLoading.set(false);
    }
  }

  // ===========================================================================
  // device actions
  // ===========================================================================

  async applyIpv4(d: DeviceState) {
    const ip = this.ipInput.trim();
    if (this.parseV4(ip) == null) {
      this.toast('Enter an IPv4 address like 10.0.0.30', 'warn');
      return;
    }
    const prefix = this.ipPrefix || 24;
    const iface = this.ipIface(d);
    const cmds = this.isLinux(d)
      ? [`ip addr add ${ip}/${prefix} dev ${iface}`, `ip link set ${iface} up`]
      : ['enable', 'conf t', `interface ${iface}`, `ip address ${ip} ${this.prefixMask(prefix)}`, 'no shutdown', 'end'];
    this.ipBusy.set(true);
    try {
      await this.runCommands(d, cmds, `${d.name} is now ${ip}/${prefix}`);
    } finally {
      this.ipBusy.set(false);
    }
  }

  /** Sets a missing gateway, or replaces the current one (Linux `ip route replace`, Cisco `no ip route` + `ip route`). */
  async setGateway(d: DeviceState, gw?: string) {
    const target = (gw ?? this.gwInput).trim();
    if (this.parseV4(target) == null) {
      this.toast('Enter the router address, like 10.0.0.1', 'warn');
      return;
    }
    const current = this.gatewayOf(d);
    const cmds = this.isLinux(d)
      ? [current ? `ip route replace default via ${target}` : `ip route add default via ${target}`]
      : d.kind === 'switch'
        ? ['enable', 'conf t', `ip default-gateway ${target}`, 'end']
        : ['enable', 'conf t', ...(current ? [`no ip route 0.0.0.0 0.0.0.0 ${current}`] : []), `ip route 0.0.0.0 0.0.0.0 ${target}`, 'end'];
    this.gwBusy.set(true);
    try {
      const ok = await this.runCommands(d, cmds, `${d.name} default gateway ${current ? `changed to ${target}` : target}`);
      if (ok) this.gwEdit.set(false);
    } finally {
      this.gwBusy.set(false);
    }
  }

  async removeGateway(d: DeviceState) {
    const current = this.gatewayOf(d);
    if (!current) return;
    const cmds = this.isLinux(d)
      ? ['ip route del default']
      : d.kind === 'switch'
        ? ['enable', 'conf t', 'no ip default-gateway', 'end']
        : ['enable', 'conf t', `no ip route 0.0.0.0 0.0.0.0 ${current}`, 'end'];
    await this.runCommands(d, cmds, `${d.name} default gateway removed`);
    this.gwEdit.set(false);
  }

  /** Re-addresses one interface: Linux del + add (routes via the old subnet go with it), Cisco overwrites. */
  async changeIpv4(d: DeviceState, iface: string, ip?: string, prefix?: number) {
    const newIp = (ip ?? this.ipEditValue).trim();
    const newPrefix = prefix ?? this.ipEditPrefix ?? 24;
    if (this.parseV4(newIp) == null || newPrefix < 1 || newPrefix > 32) {
      this.toast('Enter an IPv4 address like 10.0.0.20 and a prefix between 1 and 32', 'warn');
      return;
    }
    const i = d.ifaces.find((x) => x.name === iface);
    const old = i?.ipv4;
    const gw = this.gatewayOf(d);
    const cmds = this.isLinux(d)
      ? [
          ...(old ? [`ip addr del ${old.ip}/${old.prefix} dev ${iface}`] : []),
          `ip addr add ${newIp}/${newPrefix} dev ${iface}`,
          `ip link set ${iface} up`,
        ]
      : ['enable', 'conf t', `interface ${iface}`, `ip address ${newIp} ${this.prefixMask(newPrefix)}`, 'no shutdown', 'end'];
    this.ipBusy.set(true);
    try {
      const ok = await this.runCommands(d, cmds, `${d.name} ${iface} is now ${newIp}/${newPrefix}`);
      if (ok) {
        this.ipEdit.set(null);
        const fresh = this.api.state()?.devices.find((x) => x.id === d.id);
        // Linux drops a default route whose next hop left the subnet; say so instead of leaving the learner guessing.
        if (fresh && gw && this.isLinux(d) && !this.gatewayOf(fresh)) this.toast(`The old gateway ${gw} is no longer on ${d.name}'s subnet, so its default route was removed. Set a new one if needed.`, 'info');
      }
    } finally {
      this.ipBusy.set(false);
    }
  }

  async toggleIface(d: DeviceState, iface: string, ev?: Event) {
    ev?.stopPropagation();
    ev?.preventDefault();
    const i = d.ifaces.find((x) => x.name === iface);
    if (!i) return;
    const enable = !i.adminUp;
    const cmds = this.isLinux(d)
      ? [`ip link set ${iface} ${enable ? 'up' : 'down'}`]
      : ['enable', 'conf t', `interface ${iface}`, enable ? 'no shutdown' : 'shutdown', 'end'];
    await this.runCommands(d, cmds, `${d.name} ${iface} ${enable ? 'enabled' : 'disabled'}`);
  }

  async runDhcp(d: DeviceState) {
    const iface = d.associatedSsid ? (d.ifaces.find((i) => i.isRadio)?.name ?? 'wlan0') : this.ipIface(d);
    const ok = await this.runCommands(d, [`dhclient ${iface}`]);
    if (ok) {
      const ip = this.primaryIpv4(this.api.state()?.devices.find((x) => x.id === d.id) ?? d);
      this.toast(ip ? `${d.name} got ${ip} via DHCP` : `${d.name}: no DHCP offer received — see the terminal`, ip ? 'success' : 'warn');
    }
  }

  /** SSIDs advertised by APs and WLCs, read from their running-config. */
  wifiNetworks(): { ssid: string; psk?: string; ap: string }[] {
    const out: { ssid: string; psk?: string; ap: string }[] = [];
    for (const d of this.api.state()?.devices ?? []) {
      if (d.kind !== 'ap' && d.kind !== 'wlc') continue;
      const lines = d.runningConfig.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^ssid (\S+)/) ?? lines[i].match(/^wlan create (\S+)/);
        if (!m) continue;
        let psk: string | undefined;
        for (let j = i + 1; j < lines.length && j < i + 5; j++) {
          const pm = lines[j].match(/^\s*wpa2-psk (\S+)/) ?? lines[j].match(/^wpa2 psk (\S+)/);
          if (pm) psk = pm[1];
        }
        if (!out.some((w) => w.ssid === m[1])) out.push({ ssid: m[1], psk, ap: d.name });
      }
    }
    return out;
  }

  hasRadio(d: DeviceState) {
    return d.kind === 'workstation' && d.ifaces.some((i) => i.isRadio);
  }

  openWifi(d: DeviceState) {
    const nets = this.wifiNetworks();
    this.wifiSsid = nets[0]?.ssid ?? '';
    this.wifiPsk = nets[0]?.psk ?? '';
    this.wifiOpen.set(true);
    this.selectedId.set(d.id);
    if (this.isNarrow()) {
      if (this.basicMode()) this.basicSheet.set(true);
      else this.setTab('inspect');
    }
  }

  pickWifi(ssid: string) {
    this.wifiSsid = ssid;
    this.wifiPsk = this.wifiNetworks().find((w) => w.ssid === ssid)?.psk ?? '';
  }

  async connectWifi(d: DeviceState) {
    const ssid = this.wifiSsid.trim();
    if (!ssid) return;
    const cmd = `nmcli wifi connect ${ssid}${this.wifiPsk.trim() ? ` password ${this.wifiPsk.trim()}` : ''}`;
    this.wifiBusy.set(true);
    try {
      const ok = await this.runCommands(d, [cmd]);
      const fresh = this.api.state()?.devices.find((x) => x.id === d.id);
      if (ok && fresh?.associatedSsid) {
        this.wifiOpen.set(false);
        this.toast(`${d.name} joined ${fresh.associatedSsid}`, 'success');
      } else if (ok) this.toast(`${d.name} did not associate — see the terminal output`, 'warn');
    } finally {
      this.wifiBusy.set(false);
    }
  }

  // ===========================================================================
  // reach tool: ping + trace
  // ===========================================================================

  reachTargets(d: DeviceState) {
    const rows: { label: string; ip: string }[] = [];
    for (const x of this.api.state()?.devices ?? []) {
      if (x.id === d.id) continue;
      for (const i of x.ifaces) {
        if (i.ipv4?.ip) rows.push({ label: `${x.name} · ${i.ipv4.ip}`, ip: i.ipv4.ip });
        if (this.advanced()) for (const v of i.ipv6) if (!v.ip.toLowerCase().startsWith('fe80:')) rows.push({ label: `${x.name} · ${v.ip}`, ip: v.ip });
      }
    }
    return rows;
  }

  openReach(d: DeviceState, target?: string) {
    const targets = this.reachTargets(d);
    this.reach.set({ target: target ?? this.reach()?.target ?? targets[0]?.ip ?? '', proto: 'icmp', busy: false, result: null });
    requestAnimationFrame(() => document.querySelector('[data-reach]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  setReachTarget(v: string) {
    const r = this.reach();
    if (r) this.reach.set({ ...r, target: v });
  }

  setReachProto(v: 'icmp' | 'ssh') {
    const r = this.reach();
    if (r) this.reach.set({ ...r, proto: v });
  }

  closeReach() {
    this.reach.set(null);
  }

  private dropReason(events: PacketEvent[]) {
    return [...events].reverse().find((e) => e.drop)?.reason ?? null;
  }

  async runPing(d: DeviceState) {
    const r = this.reach() ?? { target: '', proto: 'icmp' as const, busy: false, result: null };
    const target = r.target.trim();
    if (!target) {
      this.toast('Pick a target first.', 'warn');
      return;
    }
    this.reach.set({ ...r, busy: true });
    const v6 = target.includes(':');
    const line = this.isLinux(d) ? `${v6 ? 'ping6' : 'ping'} -c 2 ${target}` : `ping ${target}`;
    this.termDevice.set(d.id);
    try {
      const res = await this.runCli(d, line);
      const events = res.events ?? [];
      const ok = !res.error;
      const reason = this.dropReason(events) ?? (ok ? 'Echo reply received' : res.output.split('\n').filter(Boolean).pop() ?? 'no reply');
      const hops = this.hopNames(events);
      this.reach.set({ ...r, busy: false, result: { kind: 'ping', ok, reason, summary: this.pingSummary(res.output), hops } });
      this.setTrace(events, ok, reason, `Ping ${d.name} → ${target}`);
      this.animate(events);
      await this.api.refresh();
    } catch (e) {
      this.reach.set({ ...r, busy: false, result: { kind: 'ping', ok: false, reason: this.errMsg(e), summary: '', hops: [] } });
    }
  }

  async runTrace(d: DeviceState) {
    const r = this.reach() ?? { target: '', proto: 'icmp' as const, busy: false, result: null };
    const target = r.target.trim();
    if (!target) {
      this.toast('Pick a target first.', 'warn');
      return;
    }
    this.reach.set({ ...r, busy: true });
    try {
      const family = target.includes(':') ? 'v6' : 'v4';
      const res = await this.api.path(d.name, target, r.proto, family);
      const hops = this.hopNames(res.events);
      // On success the engine's summary reason is the first "reply"-ish event (often ARP); the echo reply is the clearer fact.
      const reason = res.ok ? (res.events.find((e) => /echo reply|SSH/i.test(e.reason))?.reason ?? res.reason) : res.reason;
      this.reach.set({ ...r, busy: false, result: { kind: 'trace', ok: res.ok, reason, summary: hops.join(' → '), hops } });
      this.setTrace(res.events, res.ok, reason, `${r.proto === 'ssh' ? 'SSH' : 'ICMP'} ${d.name} → ${target}`);
      this.pushLine(d.id, { text: `[trace] ${d.name} → ${target} (${r.proto}): ${res.ok ? 'reachable' : 'dropped'} — ${reason}`, sys: true });
      this.animate(res.events);
      await this.api.refresh();
    } catch (e) {
      this.reach.set({ ...r, busy: false, result: { kind: 'trace', ok: false, reason: this.errMsg(e), summary: '', hops: [] } });
    }
  }

  private pingSummary(output: string) {
    const lines = output.split('\n').filter(Boolean);
    const stats = lines.find((l) => /packets transmitted|received|loss/i.test(l));
    return stats ?? lines[lines.length - 1] ?? '';
  }

  private hopNames(events: PacketEvent[]) {
    const seen: string[] = [];
    for (const e of events) {
      if (e.drop) break;
      for (const n of [e.from.device, e.to?.device]) if (n && !seen.includes(n)) seen.push(n);
      if (e.reason.startsWith('ICMP echo reply')) break;
    }
    return seen;
  }

  private setTrace(events: PacketEvent[], ok: boolean, reason: string, label: string) {
    if (!events.length) {
      this.trace.set(null);
      return;
    }
    const st = this.api.state();
    const devices: string[] = [];
    const linkIds: string[] = [];
    for (const e of events) {
      for (const n of [e.from.device, e.to?.device]) if (n && !devices.includes(n)) devices.push(n);
      if (e.to && st) {
        const a = this.devByName(e.from.device);
        const b = this.devByName(e.to.device);
        const l = st.links.find(
          (x) =>
            (x.a.deviceId === a?.id && x.b.deviceId === b?.id) || (x.a.deviceId === b?.id && x.b.deviceId === a?.id),
        );
        if (l && !linkIds.includes(l.id)) linkIds.push(l.id);
      }
    }
    // A drop inside a passing result (e.g. an SSH deny the lab expects) is policy doing its job, not a fault.
    const drop = ok ? undefined : [...events].reverse().find((e) => e.drop);
    this.trace.set({ devices, dropDevice: drop?.from.device, linkIds, ok, reason, label });
  }

  clearTrace() {
    this.trace.set(null);
    this.activeHop.set(null);
    this.replayToken++;
    this.animPkts.set([]);
  }

  traceClass(d: DeviceState) {
    const t = this.trace();
    if (!t) return '';
    if (t.dropDevice === d.name) return ' ring-2 ring-danger-400 shadow-glow-danger';
    if (this.activeHop() === d.name) return ' ring-2 ring-brand-300 shadow-glow';
    if (t.devices.includes(d.name)) return ' ring-1 ring-brand-400/70';
    return '';
  }

  linkInTrace(l: LinkState) {
    return this.trace()?.linkIds.includes(l.id) ?? false;
  }

  replayPacket(p: PacketEvent) {
    const all = this.api.state()?.packets ?? [];
    const idx = all.findIndex((x) => x.id === p.id);
    const burst = idx >= 0 ? all.slice(Math.max(0, idx - 12), idx + 1) : [p];
    const start = burst.findIndex((e) => e.reason.includes('echo request') || e.proto === 'arp');
    const events = start >= 0 ? burst.slice(start) : burst;
    this.setTrace(events, !p.drop, p.reason, `${p.proto} ${p.srcIp ?? ''} → ${p.dstIp ?? ''}`.trim());
    this.animate(events, true);
    if (this.isNarrow()) this.setTab('canvas');
  }

  // ===========================================================================
  // topology editing
  // ===========================================================================

  private nameFor(kind: string) {
    const prefix: Record<string, string> = { workstation: 'PC', server: 'SRV', switch: 'SW', router: 'R', firewall: 'FW', ap: 'AP', wlc: 'WLC', cloud: 'NET' };
    const p = prefix[kind] ?? kind.slice(0, 2).toUpperCase();
    const taken = new Set((this.api.state()?.devices ?? []).map((d) => d.name));
    for (let i = 1; i < 100; i++) {
      const n = `${p}${i}`;
      if (!taken.has(n)) return n;
    }
    return p + Math.floor(Math.random() * 90 + 10);
  }

  private dropPoint() {
    const devices = this.api.state()?.devices ?? [];
    const el = this.stage?.nativeElement ?? this.stageEl;
    let x = 240;
    let y = 180;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) {
        const w = this.worldFromEvent({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, el);
        x = Math.round(w.x / GRID) * GRID;
        y = Math.round(w.y / GRID) * GRID;
      }
    }
    const occupied = (px: number, py: number) => devices.some((d) => Math.abs(d.x - px) < 150 && Math.abs(d.y - py) < 120);
    for (let n = 0; n < 20 && occupied(x, y); n++) {
      x += 156;
      if (n % 3 === 2) {
        x -= 468;
        y += 120;
      }
    }
    return { x, y };
  }

  place(kind: string) {
    this.addOpen.set(false);
    this.focusAddOpen.set(false);
    if (this.isNarrow()) {
      this.placing.set(null);
      this.mobileTab.set('canvas');
      requestAnimationFrame(() => requestAnimationFrame(() => void this.addDevice(kind)));
      return;
    }
    this.placing.set(this.placing() === kind ? null : kind);
    this.cancelCable();
  }

  async addDevice(kind: string, at?: { x: number; y: number }) {
    const name = this.nameFor(kind);
    const pos = at ?? this.dropPoint();
    try {
      await this.api.edit({ addDevices: [{ type: kind, name, x: pos.x, y: pos.y }] });
    } catch (e) {
      this.fail(e);
      return;
    }
    const d = this.api.state()?.devices.find((x) => x.name === name);
    if (d) {
      this.selectedId.set(d.id);
      this.termDevice.set(d.id);
      void this.loadVocab(d.kind);
    }
    this.toast(
      this.basicMode() ? `${name} added. Drag it, then tap Cable and another device.` : `${this.kindLabel(kind)} ${name} added. Drag to move; Cable to connect.`,
      'success',
    );
    if (this.basicMode()) requestAnimationFrame(() => this.fitIfNarrow());
  }

  deleteDevice(d: DeviceState) {
    this.confirmDel.set(d);
  }

  async doDelete() {
    const d = this.confirmDel();
    if (!d) return;
    this.confirmDel.set(null);
    this.basicSheet.set(false);
    let snapDev: LabJson['devices'][number] | undefined;
    let snapLinks: UndoLink[] = [];
    try {
      const snap = await this.api.snapshot();
      snapDev = snap?.devices.find((x) => x.name === d.name);
      snapLinks = (snap?.links ?? []).filter((l) => l.a.startsWith(`${d.name}:`) || l.b.startsWith(`${d.name}:`)).map((l) => ({ a: l.a, b: l.b, cable: l.cable }));
    } catch {
      /* undo without config is still possible */
    }
    try {
      await this.api.edit({ removeDeviceIds: [d.id] });
    } catch (e) {
      this.fail(e);
      return;
    }
    if (this.selectedId() === d.id) this.selectedId.set(null);
    if (this.termDevice() === d.id) this.termDevice.set(this.api.state()?.devices[0]?.id ?? null);
    const kind = d.kind;
    const restore = async () => {
      try {
        await this.api.edit({ addDevices: [{ type: kind, name: d.name, x: d.x, y: d.y }], addLinks: snapLinks });
        const cmds = [...(snapDev?.startup ?? []), ...(snapDev?.post ?? [])];
        if (cmds.length) {
          try {
            await this.api.edit({ configs: [{ device: d.name, commands: cmds }] });
          } catch {
            this.toast(`${d.name} restored, but part of its configuration could not be replayed.`, 'warn');
            return;
          }
        }
        const back = this.api.state()?.devices.find((x) => x.name === d.name);
        if (back) this.selectedId.set(back.id);
        this.toast(`${d.name} restored.`, 'success');
      } catch (e) {
        this.fail(e);
      }
    };
    this.toast(`${d.name} deleted.`, 'info', { label: 'Undo', run: () => void restore() });
  }

  async unplug(linkId: string) {
    const l = this.api.state()?.links.find((x) => x.id === linkId);
    if (!l) return;
    const undo: UndoLink | null = l.kind === 'radio' ? null : { a: `${l.a.device}:${l.a.iface}`, b: `${l.b.device}:${l.b.iface}`, cable: l.cable };
    try {
      await this.api.edit({ removeLinks: [linkId] });
    } catch (e) {
      this.fail(e);
      return;
    }
    this.selectedLinkId.set(null);
    this.toast(
      `Cable ${l.a.device}:${l.a.iface} — ${l.b.device}:${l.b.iface} removed.`,
      'info',
      undo ? { label: 'Undo', run: () => void this.api.edit({ addLinks: [undo] }).catch((e) => this.fail(e)) } : undefined,
    );
  }

  async replaceCable(l: LinkState, cable: CableMedia = 'ethernet') {
    try {
      await this.api.edit({ removeLinks: [l.id] });
      await this.api.edit({ addLinks: [{ a: `${l.a.device}:${l.a.iface}`, b: `${l.b.device}:${l.b.iface}`, cable }] });
      this.toast(`Cable replaced with ${this.cableLabel(cable)}.`, 'success');
    } catch (e) {
      this.fail(e);
    }
  }

  private freePort(d: DeviceState) {
    const cable = this.effectiveCable();
    if (cable === 'fiber') {
      const fiberOk = d.kind === 'switch' || d.kind === 'router' || d.kind === 'firewall' || d.kind === 'ap' || d.kind === 'wlc';
      if (!fiberOk) return null;
    }
    return d.ifaces.find((i) => !this.peerOf(d, i.name) && !i.isRadio && !i.name.includes('.') && !i.name.toLowerCase().startsWith('vlan')) ?? null;
  }

  armCable(kind?: CableMedia) {
    if (kind) this.cableKind.set(kind);
    if (!this.advUi()) this.cableKind.set('ethernet');
    this.cableArmed.set(true);
    this.cableFrom.set(null);
    this.placing.set(null);
    this.addOpen.set(false);
    this.basicSheet.set(false);
    this.selectedLinkId.set(null);
    if (this.isNarrow()) this.mobileTab.set('canvas');
  }

  cancelCable() {
    this.cableFrom.set(null);
    this.cableArmed.set(false);
    this.cableCursor.set(null);
  }

  selectedLink(): LinkState | null {
    const id = this.selectedLinkId();
    if (!id) return null;
    return this.api.state()?.links.find((l) => l.id === id) ?? null;
  }

  startCable(ev: Event, d: DeviceState) {
    ev.stopPropagation();
    ev.preventDefault();
    const from = this.cableFrom();
    if (from && from.id !== d.id) {
      void this.finishCable(d);
      return;
    }
    const iface = this.freePort(d);
    if (!iface) {
      this.toast(
        this.effectiveCable() === 'fiber' ? `${d.name} has no fiber (SFP) port. Use Ethernet, or pick a switch/router.` : `${d.name} has no free Ethernet port.`,
        'warn',
      );
      return;
    }
    this.cableFrom.set({ id: d.id, iface: iface.name });
    this.cableArmed.set(true);
    this.basicSheet.set(false);
  }

  private async finishCable(d: DeviceState, ifaceName?: string) {
    const from = this.cableFrom();
    if (!from || from.id === d.id) return;
    const iface = ifaceName ? d.ifaces.find((i) => i.name === ifaceName) : this.freePort(d);
    if (!iface || iface.isRadio) {
      this.toast(this.effectiveCable() === 'fiber' ? `${d.name} has no fiber (SFP) port.` : `${d.name} has no free Ethernet port.`, 'warn');
      return;
    }
    if (this.peerOf(d, iface.name)) {
      this.toast(`${d.name} ${iface.name} is already cabled.`, 'warn');
      return;
    }
    const fromName = this.devName(from.id);
    const cable = this.effectiveCable();
    try {
      await this.api.edit({ addLinks: [{ a: `${fromName}:${from.iface}`, b: `${d.name}:${iface.name}`, cable }] });
    } catch (e) {
      this.fail(e);
      return;
    }
    this.cableFrom.set(null);
    this.cableCursor.set(null);
    const fresh = this.api.state()?.devices.find((x) => x.id === d.id);
    const st = fresh?.ifaces.find((i) => i.name === iface.name);
    const linkOk = !!st?.operUp;
    this.toast(
      `${this.cableLabel(cable)} ${fromName}:${from.iface} ↔ ${d.name}:${iface.name}${linkOk ? ' — link up' : st ? ` — ${this.linkStatus(st)}` : ''}${this.cableArmed() ? '. Tap two more, or Esc.' : ''}`,
      linkOk ? 'success' : 'warn',
    );
    if (this.basicMode()) {
      this.selectedId.set(d.id);
      this.termDevice.set(d.id);
      this.prepareIpv4Form(d);
      this.basicSheet.set(true);
    }
  }

  clickPort(ev: Event, d: DeviceState, iface: string) {
    ev.stopPropagation();
    ev.preventDefault();
    const i = d.ifaces.find((x) => x.name === iface);
    if (i?.isRadio) {
      if (this.cableArmed() || this.cableFrom()) {
        this.toast('Wi-Fi uses association (nmcli), not a copper cable.', 'info');
        return;
      }
      void this.toggleIface(d, iface, ev);
      return;
    }
    if (!this.cableArmed() && !this.cableFrom()) {
      void this.toggleIface(d, iface, ev);
      return;
    }
    const busy = this.peerOf(d, iface);
    if (busy) {
      this.selectedLinkId.set(busy.linkId);
      this.toast(`${d.name} ${iface} is already cabled to ${busy.device} ${busy.iface}. Unplug it first.`, 'warn');
      return;
    }
    const from = this.cableFrom();
    if (!from) {
      this.cableFrom.set({ id: d.id, iface });
      this.cableArmed.set(true);
      return;
    }
    if (from.id === d.id) {
      this.cableFrom.set({ id: d.id, iface });
      return;
    }
    void this.finishCable(d, iface);
  }

  selectLink(ev: Event, l: LinkState) {
    ev.stopPropagation();
    ev.preventDefault();
    this.selectedLinkId.set(l.id);
    this.selectedId.set(null);
    this.basicSheet.set(false);
  }

  /** Lays devices out in tiers (edge → core → access → hosts) using engine `move`. */
  async tidyUp() {
    this.menuOpen.set(false);
    const st = this.api.state();
    if (!st?.devices.length) return;
    const tier: Record<string, number> = { cloud: 0, firewall: 1, router: 1, wlc: 1, switch: 2, ap: 2, server: 3, workstation: 3 };
    const rows = new Map<number, DeviceState[]>();
    for (const d of st.devices) {
      const t = tier[d.kind] ?? 3;
      rows.set(t, [...(rows.get(t) ?? []), d]);
    }
    const gapX = 168;
    const gapY = 150;
    const widest = Math.max(...[...rows.values()].map((r) => r.length));
    const totalW = (widest - 1) * gapX;
    const moves: { id: string; x: number; y: number }[] = [];
    for (const [t, list] of rows) {
      list.sort((a, b) => a.x - b.x);
      const rowW = (list.length - 1) * gapX;
      const startX = 96 + (totalW - rowW) / 2;
      list.forEach((d, i) => {
        const x = Math.round((startX + i * gapX) / GRID) * GRID;
        const y = Math.round((72 + t * gapY) / GRID) * GRID;
        d.x = x;
        d.y = y;
        moves.push({ id: d.id, x, y });
      });
    }
    this.api.state.set({ ...st });
    try {
      await this.api.edit(undefined, moves);
      this.fitToView();
      this.toast('Topology tidied.', 'success');
    } catch (e) {
      this.fail(e);
    }
  }

  // ===========================================================================
  // share / import / export
  // ===========================================================================

  private readShareHash(): LabJson | null {
    const m = location.hash.match(/^#lab=(.+)$/);
    if (!m) return null;
    try {
      const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const lab = JSON.parse(new TextDecoder().decode(bytes)) as LabJson;
      return lab && Array.isArray(lab.devices) ? lab : null;
    } catch {
      return null;
    }
  }

  async copyShareLink() {
    this.menuOpen.set(false);
    try {
      const snap = await this.api.snapshot();
      if (!snap) throw new Error('Nothing to share yet');
      const bytes = new TextEncoder().encode(JSON.stringify(snap));
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const url = `${location.origin}${location.pathname}#lab=${b64}`;
      await navigator.clipboard.writeText(url);
      this.toast('Share link copied. Anyone who opens it gets a copy of this lab.', 'success');
    } catch (e) {
      this.fail(e);
    }
  }

  async copyJson() {
    this.menuOpen.set(false);
    try {
      const snap = await this.api.snapshot();
      if (!snap) throw new Error('Nothing to copy yet');
      await navigator.clipboard.writeText(JSON.stringify(snap, null, 2));
      this.toast('Lab JSON copied to the clipboard.', 'success');
    } catch (e) {
      this.fail(e);
    }
  }

  saveJson() {
    this.menuOpen.set(false);
    this.moreOpen.set(false);
    const st = this.api.state();
    if (!st) return;
    void this.api.snapshot().then((snap) => {
      const blob = new Blob([JSON.stringify(snap ?? st, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${st.id}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  async importJson(ev: Event) {
    this.menuOpen.set(false);
    this.moreOpen.set(false);
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    try {
      const lab = JSON.parse(await f.text()) as LabJson;
      if (!Array.isArray(lab.devices)) throw new Error('Not a NetBench lab file');
      this.loading.set(true);
      await this.api.open(undefined, lab);
      this.afterOpen();
      this.toast(`Imported ${lab.name || f.name}`, 'success');
    } catch (e) {
      this.fail(e);
    } finally {
      this.loading.set(false);
      input.value = '';
    }
  }

  // ===========================================================================
  // auth
  // ===========================================================================

  openAuth() {
    this.menuOpen.set(false);
    this.authError.set(null);
    this.authOpen.set(true);
  }

  async doAuth() {
    const email = this.email.trim();
    if (!email || !this.password) {
      this.authError.set('Email and password are required.');
      return;
    }
    this.authBusy.set(true);
    this.authError.set(null);
    try {
      if (this.authMode() === 'login') await this.api.login(email, this.password);
      else await this.api.register(email, this.password);
      this.authOpen.set(false);
      this.password = '';
      this.toast(`Signed in as ${email}. Your labs now save to this account.`, 'success');
      this.bindEve();
      void this.loadMyLabs();
    } catch (e) {
      this.authError.set(this.errMsg(e));
    } finally {
      this.authBusy.set(false);
    }
  }

  async signOut() {
    this.menuOpen.set(false);
    try {
      await this.api.logout();
      this.myLabs.set([]);
      this.authOpen.set(false);
      this.toast('Signed out. You are a guest again; this lab stays in this browser.', 'info');
    } catch (e) {
      this.fail(e);
    }
  }

  // ===========================================================================
  // eve
  // ===========================================================================

  private bindEve() {
    const sid = this.api.sessionId();
    if (!sid) return;
    this.eve.bind({ nestSessionId: sid, userId: this.api.userId(), context: () => this.eveContext() });
    this.eve.onLabMutated = () => void this.api.refresh();
  }

  private eveContext(): string {
    const st = this.api.state();
    const sel = this.selected();
    const pkt = this.selectedPkt();
    return [
      '[NetBench context]',
      `labSessionId=${this.api.sessionId()}`,
      `labId=${this.api.sessionId()}`,
      `labName=${st?.name ?? ''}`,
      sel ? `selectedDevice=${sel.name} id=${sel.id} kind=${sel.kind}` : 'selectedDevice=none',
      pkt ? `selectedPacket=${pkt.proto} ${pkt.srcIp ?? ''} → ${pkt.dstIp ?? ''} reason=${pkt.reason}` : 'selectedPacket=none',
      'Use labId=labSessionId (UUID) on every tool. Never pass confirmToken. Never ask the user for a token — UI Approve mints it. Eight devices only. OSPF area 0. No BGP/MPLS/VXLAN/802.1X.',
    ].join('\n');
  }

  async explain() {
    const sel = this.selected();
    const pkt = this.selectedPkt();
    if (sel) await this.api.highlight([sel.id]).catch(() => undefined);
    await this.eve.send(
      pkt
        ? 'Explain this packet using get_path and get_lab_state. Cite devices and interfaces.'
        : `Explain ${sel?.name ?? 'the lab'} using get_lab_state and get_device. Cite running-config.`,
    );
  }

  async explainPacket(p: PacketEvent) {
    this.selectedPkt.set(p);
    this.openEve();
    await this.eve.send(
      `Explain this packet: ${p.proto} ${p.srcIp ?? p.srcMac} → ${p.dstIp ?? p.dstMac} at ${p.from.device}:${p.from.iface}${p.to ? ` → ${p.to.device}:${p.to.iface}` : ''}. Engine reason: "${p.reason}"${p.drop ? ' (dropped)' : ''}. Use get_path and get_lab_state, cite devices and interfaces, and say what a junior admin should change.`,
    );
  }

  async fixLab() {
    await this.eve.send('Fix my lab. Call run_check and get_lab_state first. Apply the smallest junior-admin change with apply_device_config or apply_lab_patch.');
  }

  async sendEve() {
    const t = this.eveInput.trim();
    if (!t) return;
    this.eveInput = '';
    if (this.eveMode() === 'build') {
      this.eveMode.set('chat');
      await this.eve.send(`Build this lab with build_lab. Spec: ${t}`);
      return;
    }
    await this.eve.send(t);
  }

  async applyPending() {
    const h = this.eve.hitl();
    if (h) {
      const approve = h.options?.find((o) => /approve|allow|yes/i.test(o.id) || /approve|allow|yes/i.test(o.label))?.id ?? 'approve';
      await this.eve.respond(approve, h.requestId);
      await this.api.refresh();
      return;
    }
    const p = this.pending();
    if (!p) return;
    try {
      if (p.patch && (p.patch as { __build?: string }).__build) {
        const tok = await this.api.confirm('build_lab');
        await this.api.json(`/eve/tools/build_lab`, {
          method: 'POST',
          body: JSON.stringify({ labId: this.api.sessionId(), spec: (p.patch as { __build: string }).__build, confirmToken: tok.confirmToken }),
        });
        await this.api.refresh();
      } else if (p.commands && p.deviceId) {
        const tok = await this.api.confirm('apply_device_config');
        await this.api.applyConfig(p.deviceId, p.commands, tok.confirmToken);
      } else if (p.patch) {
        const tok = await this.api.confirm('apply_lab_patch');
        await this.api.applyPatch(p.patch, tok.confirmToken);
      }
      await this.doCheck();
    } catch (e) {
      this.eve.msgs.update((m) => [...m, { role: 'eve', text: this.errMsg(e) }]);
    }
    this.pending.set(null);
  }

  discardPending() {
    const h = this.eve.hitl();
    if (h) {
      const cancel = h.options?.find((o) => /cancel|deny|reject|no/i.test(o.id) || /cancel|deny|no/i.test(o.label))?.id ?? 'cancel';
      void this.eve.respond(cancel, h.requestId);
      return;
    }
    this.pending.set(null);
  }

  answerEve(optionId: string) {
    const h = this.eve.hitl();
    if (!h) return;
    void this.eve.respond(optionId, h.requestId);
  }

  isApproveOption(o: { id: string; label: string }) {
    return /approve|allow|yes/i.test(o.id) || /approve|allow|yes/i.test(o.label);
  }

  reachHasTarget(d: DeviceState, target: string) {
    return this.reachTargets(d).some((t) => t.ip === target);
  }

  hitlInput(h: { toolInput?: unknown }) {
    if (h.toolInput == null) return '';
    try {
      const s = JSON.stringify(h.toolInput, null, 1);
      return s.length > 600 ? s.slice(0, 600) + '…' : s;
    } catch {
      return String(h.toolInput);
    }
  }

  // ===========================================================================
  // troubleshoot assistant — interprets engine drop reasons; never predicts forwarding
  // ===========================================================================

  private showRoutesCmd(d: DeviceState | null | undefined) {
    return d && this.isLinux(d) ? 'ip route' : 'show ip route';
  }

  private isPrivateV4(ip: string) {
    const n = this.parseV4(ip);
    if (n == null) return false;
    return (n >>> 24) === 10 || ((n >>> 24) === 172 && ((n >>> 16) & 0xf0) === 16) || ((n >>> 24) === 192 && ((n >>> 16) & 0xff) === 168);
  }

  private sameSubnet(a: string, b: string, prefix: number) {
    const x = this.parseV4(a);
    const y = this.parseV4(b);
    if (x == null || y == null) return false;
    const mask = this.maskOf(prefix || 24);
    return ((x & mask) >>> 0) === ((y & mask) >>> 0);
  }

  private showIfacesCmd(d: DeviceState | null | undefined) {
    return d && this.isLinux(d) ? 'ip link' : 'show int';
  }

  private enablePeerFix(owner: DeviceState, ip: string): Diagnosis['fix'] {
    const i = owner.ifaces.find((x) => x.ipv4?.ip === ip || x.ipv6.some((v) => v.ip === ip));
    if (i && !i.adminUp) return { label: `Enable ${owner.name} ${i.name}`, run: () => this.toggleIface(owner, i.name) };
    return undefined;
  }

  diagnose(reason: string, dropDevice?: string, dropIface?: string, ctx: { src?: string; dst?: string } = {}): Diagnosis {
    const st = this.api.state();
    const dev = dropDevice ? this.devByName(dropDevice) : null;
    const base = { reason, device: dropDevice, iface: dropIface, commands: [] as Diagnosis['commands'], lookAt: [] as string[] };
    let m: RegExpMatchArray | null;

    if ((m = reason.match(/^Interface (\S+) is administratively down/))) {
      const ifn = m[1];
      return {
        ...base,
        layer: 'Physical (L1)',
        title: `${dropDevice} port ${ifn} is shut down`,
        detail: `The packet had to leave ${dropDevice} through ${ifn}, but that port is administratively down. Nothing passes a shut port, however correct the addressing is.`,
        iface: ifn,
        lookAt: [`${dropDevice} ${ifn} admin state`],
        commands: dev ? [{ device: dev.name, cmd: this.showIfacesCmd(dev) }] : [],
        fix: dev ? { label: `Enable ${dev.name} ${ifn}`, run: () => this.toggleIface(dev, ifn) } : undefined,
      };
    }
    if ((m = reason.match(/^No cable on (\S+)/))) {
      return {
        ...base,
        layer: 'Physical (L1)',
        title: `${dropDevice} ${m[1]} has no cable`,
        detail: `${dropDevice} tried to send out ${m[1]}, but nothing is plugged in. Its route or gateway points at an interface that is not connected to anything.`,
        iface: m[1],
        lookAt: [`Cable ${dropDevice} ${m[1]} to a switch or router`],
        fix: { label: 'Start a cable', run: () => this.armCable('ethernet') },
      };
    }
    if ((m = reason.match(/^Interface (\S+) is down/))) {
      const ifn = m[1];
      const peer = dev ? this.peerOf(dev, ifn) : null;
      const other = peer ? this.devByName(peer.device) : null;
      const oi = other?.ifaces.find((i) => i.name === peer!.iface);
      const peerDown = !!(other && oi && !oi.adminUp);
      return {
        ...base,
        layer: 'Physical (L1)',
        title: `${dropDevice} ${ifn} has a cable but no link`,
        detail: peerDown
          ? `The other end, ${other!.name} ${oi!.name}, is administratively down, so the link never comes up.`
          : `The port is enabled and cabled, yet there is no carrier. Usually the far end is shut down, or the cable type is wrong for this pair of devices.`,
        iface: ifn,
        lookAt: peer ? [`${peer.device} ${peer.iface} admin state`, `Cable type: ${this.cableLabel(peer.cable)}`] : [`${dropDevice} ${ifn}`],
        commands: other ? [{ device: other.name, cmd: this.showIfacesCmd(other) }] : [],
        fix: peerDown ? { label: `Enable ${other!.name} ${oi!.name}`, run: () => this.toggleIface(other!, oi!.name) } : undefined,
      };
    }
    if ((m = reason.match(/^VLAN mismatch on (\S+) (\S+)/))) {
      const sw = this.devByName(m[1]);
      const port = sw?.ifaces.find((i) => i.name === m![2]);
      return {
        ...base,
        layer: 'Switching (L2)',
        title: `VLAN mismatch at ${m[1]} ${m[2]}`,
        detail: `The frame reached ${m[1]} ${m[2]} carrying a VLAN that port does not accept${port ? ` (it is ${port.mode}${port.mode === 'access' ? ` VLAN ${port.accessVlan}` : ''})` : ''}. Access ports only carry their own VLAN; trunks drop VLANs missing from the allowed list.`,
        lookAt: [`${m[1]} ${m[2]}: switchport mode, access vlan, trunk allowed vlan`],
        commands: sw ? [{ device: sw.name, cmd: 'show vlan' }, { device: sw.name, cmd: 'show trunk' }] : [],
      };
    }
    if ((m = reason.match(/^No subinterface for VLAN (\d+) on (\S+) (\S+)/))) {
      return {
        ...base,
        layer: 'Addressing & routing (L3)',
        title: `${m[2]} has no subinterface for VLAN ${m[1]}`,
        detail: `Router-on-a-stick: the trunk delivered a VLAN ${m[1]} frame to ${m[2]} ${m[3]}, but there is no ${m[3]}.${m[1]} with “encapsulation dot1Q ${m[1]}” and an address, so the router cannot act as that VLAN’s gateway.`,
        lookAt: [`${m[2]}: interface ${m[3]}.${m[1]}`],
        commands: [{ device: m[2], cmd: 'show run' }],
      };
    }
    if (/RSTP-lite blocking|loop/i.test(reason)) {
      return {
        ...base,
        layer: 'Switching (L2)',
        title: 'Port blocked by loop protection',
        detail: `Two switches are connected twice, or a cable loops back. Spanning tree blocks one port so the loop cannot flood the network. Remove the redundant cable, or accept that this port stays blocked.`,
        lookAt: ['Redundant cables between switches'],
      };
    }
    if ((m = reason.match(/^(ARP|NDP) timeout for (\S+) at (\S+)/))) {
      const nh = m[2];
      const asker = this.devByName(m[3]);
      const owner = (st?.devices ?? []).find((x) => x.ifaces.some((i) => i.ipv4?.ip === nh || i.ipv6.some((v) => v.ip === nh)));
      if (asker?.kind === 'cloud' && this.isPrivateV4(nh)) {
        // The Internet stub has no route to RFC 1918 space and falls back to ARP for it: the reply to a private source is lost.
        const edge = (st?.devices ?? []).find(
          (x) => (x.kind === 'router' || x.kind === 'firewall') && x.ifaces.some((i) => i.ipv4?.ip && asker.ifaces.some((a) => a.ipv4 && this.sameSubnet(i.ipv4!.ip, a.ipv4.ip, a.ipv4.prefix))),
        );
        return {
          ...base,
          layer: 'Addressing & routing (L3)',
          title: `${asker.name} cannot answer a private address`,
          detail: `The reply is addressed to ${nh}, a private (RFC 1918) address that does not exist on the Internet, so ${asker.name} can never deliver it${owner ? ` back to ${owner.name}` : ''}. The edge router must translate the source address with NAT overload before the packet leaves.`,
          lookAt: edge ? [`${edge.name}: ip nat inside / outside on the interfaces`, `${edge.name}: access-list + "ip nat inside source list … overload"`] : ['NAT on the router facing the Internet'],
          commands: edge ? [{ device: edge.name, cmd: 'show run' }] : [],
        };
      }
      const gwFix =
        !owner && asker && (asker.kind === 'workstation' || asker.kind === 'server') && this.gatewayOf(asker) === nh && this.suggestGateway(asker) && this.suggestGateway(asker) !== nh
          ? { label: `Change gateway to ${this.suggestGateway(asker)}`, run: () => this.setGateway(asker, this.suggestGateway(asker)!) }
          : undefined;
      return {
        ...base,
        layer: owner ? 'Switching (L2)' : 'Addressing & routing (L3)',
        title: `${m[3]} got no answer for ${nh}`,
        detail: owner
          ? `${m[3]} asked “who has ${nh}?” — ${owner.name} owns that address but never replied. The layer-2 path between them is broken: a port down, a VLAN mismatch, or ${owner.name}’s interface is disabled.`
          : `${m[3]} asked “who has ${nh}?” and no device in this lab has that address. Its next hop (gateway or target) points at an address that does not exist here — check the gateway on ${m[3]} or the target IP.`,
        lookAt: owner ? [`Ports and VLANs between ${m[3]} and ${owner.name}`, `${owner.name} interface holding ${nh}`] : [`${m[3]} default gateway and routes`],
        commands: asker ? [{ device: asker.name, cmd: this.showRoutesCmd(asker) }] : [],
        fix: owner ? this.enablePeerFix(owner, nh) : gwFix,
      };
    }
    if ((m = reason.match(/^No route to (\S+) on (\S+)/))) {
      const host = this.devByName(m[2]);
      const isHost = !!host && (host.kind === 'workstation' || host.kind === 'server');
      const missingIp = !!host && this.canAddIpv4(host);
      // The engine says "no route" when the only interface that covers the destination is down:
      // a down interface contributes no connected route. Read that from state before blaming the gateway.
      const dstN = m[1].includes(':') ? null : this.parseV4(m[1]);
      const covering = host?.ifaces.find((i) => {
        if (!i.ipv4?.ip || dstN == null) return false;
        const n = this.parseV4(i.ipv4.ip);
        const mask = this.maskOf(i.ipv4.prefix || 24);
        return n != null && ((n & mask) >>> 0) === ((dstN & mask) >>> 0);
      });
      if (host && covering && !covering.operUp) {
        const peer = this.peerOf(host, covering.name);
        return {
          ...base,
          layer: 'Physical (L1)',
          title: `${host.name} ${covering.name} holds ${covering.ipv4!.ip} but is ${this.linkStatus(covering).toLowerCase()}`,
          detail: `${host.name} has ${covering.ipv4!.ip}/${covering.ipv4!.prefix} on ${covering.name}, which covers ${m[1]}, but that interface is ${!covering.adminUp ? 'administratively down' : peer ? 'cabled without link' : 'not cabled'}. A down interface contributes no connected route, so the engine reports “no route”.`,
          iface: covering.name,
          lookAt: [`${host.name} ${covering.name} admin state`, ...(peer ? [`${peer.device} ${peer.iface}`] : ['Cable it to a switch'])],
          commands: [{ device: host.name, cmd: this.showIfacesCmd(host) }],
          fix: !covering.adminUp ? { label: `Enable ${host.name} ${covering.name}`, run: () => this.toggleIface(host, covering.name) } : peer ? undefined : { label: 'Start a cable', run: () => this.armCable('ethernet') },
        };
      }
      const gw = host ? this.suggestGateway(host) : null;
      const fixIp = host && missingIp ? { label: 'Add IP', run: () => { this.selectDevice(host); this.focusIpForm(host); } } : undefined;
      const curGw = host ? this.gatewayOf(host) : null;
      const fixGw =
        host && isHost && !missingIp && gw && gw !== curGw ? { label: `${curGw ? 'Change' : 'Set'} gateway ${curGw ? 'to ' : ''}${gw}`, run: () => this.setGateway(host, gw) } : undefined;
      // Same /24 but outside the host's own prefix: almost always a mask typo (e.g. /25 instead of /24).
      const own = host?.ifaces.find((i) => i.ipv4?.ip)?.ipv4;
      const ownN = own ? this.parseV4(own.ip) : null;
      const maskHint =
        own && ownN != null && dstN != null && own.prefix > 24 && ((ownN & this.maskOf(24)) >>> 0) === ((dstN & this.maskOf(24)) >>> 0)
          ? ` ${m[2]} is ${own.ip}/${own.prefix}: with a /24 mask ${m[1]} would be on the same network — the mask looks wrong.`
          : '';
      const ownIface = host?.ifaces.find((i) => i.ipv4?.ip);
      const fixMask = maskHint && host && ownIface ? { label: `Set mask to /24`, run: () => this.changeIpv4(host, ownIface.name, ownIface.ipv4!.ip, 24) } : undefined;
      return {
        ...base,
        layer: 'Addressing & routing (L3)',
        title: `${m[2]} has no route to ${m[1]}`,
        detail: missingIp
          ? `${m[2]} has no IPv4 address at all, so it cannot even choose a source address for the packet.`
          : isHost
            ? `${m[1]} is not on ${m[2]}’s own subnet and ${m[2]} has ${curGw ? `gateway ${curGw}, which ${this.gatewayOffSubnet(host!) ? 'is not on its own subnet' : 'did not help'}` : 'no default gateway'}. Hosts hand off-subnet traffic to a router on their own subnet.${maskHint}`
            : `${m[2]} looked ${m[1]} up in its routing table and found nothing: no connected network, no static route, no OSPF route. Add a static route or advertise the network with OSPF area 0.`,
        lookAt: isHost ? [`${m[2]} address and prefix (${own ? `${own.ip}/${own.prefix}` : 'none'})`, `${m[2]} default gateway (${curGw ?? 'none'})`] : [`${m[2]} routing table`],
        commands: host ? [{ device: host.name, cmd: this.showRoutesCmd(host) }, ...(isHost ? [{ device: host.name, cmd: 'ip addr' }] : [])] : [],
        fix: fixIp ?? fixMask ?? fixGw,
      };
    }
    if ((m = reason.match(/^No outgoing interface for (\S+) on (\S+)/))) {
      return {
        ...base,
        layer: 'Addressing & routing (L3)',
        title: `${m[2]} has a route but no interface for it`,
        detail: `A route to ${m[1]} exists on ${m[2]} but the interface it points at is missing or has no address. Check the route’s exit interface.`,
        lookAt: [`${m[2]} routes and interface addresses`],
        commands: [{ device: m[2], cmd: 'show ip route' }],
      };
    }
    if ((m = reason.match(/^(\S+) is not a router/))) {
      const src = ctx.src ? this.devByName(ctx.src) : null;
      const kind = this.devByName(m[1])?.kind ?? '';
      return {
        ...base,
        layer: 'Addressing & routing (L3)',
        title: `${m[1]} received the packet but cannot route it`,
        detail: `At layer 2 the packet was addressed to ${m[1]}, a ${this.kindLabel(kind)} — it does not forward between IP networks. A host’s default gateway must be a router or firewall interface on the host’s own subnet.`,
        lookAt: src ? [`${src.name} default gateway (${this.gatewayOf(src) ?? 'none'})`] : ['The source device’s gateway'],
        commands: src ? [{ device: src.name, cmd: this.showRoutesCmd(src) }] : [],
      };
    }
    if (/TTL expired|Hop limit expired/.test(reason)) {
      return {
        ...base,
        layer: 'Addressing & routing (L3)',
        title: 'Routing loop',
        detail: `The packet bounced between routers until its TTL reached zero at ${dropDevice}. Two routers point routes for this destination at each other.`,
        lookAt: ['Static/default routes on each router along the path'],
        commands: dropDevice ? [{ device: dropDevice, cmd: 'show ip route' }] : [],
      };
    }
    if ((m = reason.match(/^ACL drop: (.*)/))) {
      return {
        ...base,
        layer: 'Policy',
        title: `Blocked by policy on ${dropDevice}`,
        detail: `${dropDevice} matched a deny rule or its default policy: ${m[1]}. This is a configured decision, not a fault — if the lab expects this traffic to be denied, the network is doing its job.`,
        lookAt: [`${dropDevice} rules / ACLs`],
        commands: dropDevice ? [{ device: dropDevice, cmd: dev && this.isLinux(dev) ? 'show rules' : 'show run' }] : [],
      };
    }
    if (/not associated/i.test(reason)) {
      const client = ctx.src ? this.devByName(ctx.src) : null;
      return {
        ...base,
        layer: 'Wi-Fi',
        title: `${ctx.src ?? 'The client'} is not on Wi-Fi`,
        detail: `The client has not associated to any SSID, so wlan0 has no link. Join the network with the SSID and PSK configured on the access point, then get an address (usually DHCP).`,
        lookAt: ['AP: ssid / wpa2-psk / radio no shutdown', 'Client wlan0'],
        commands: client ? [{ device: client.name, cmd: 'iw dev wlan0 link' }] : [],
        fix: client ? { label: 'Join Wi-Fi', run: () => this.openWifi(client) } : undefined,
      };
    }
    return { ...base, layer: 'Unknown', title: 'Dropped', detail: reason, lookAt: dropDevice ? [`${dropDevice}${dropIface ? ' ' + dropIface : ''}`] : [] };
  }

  /** Checks that are not a path (Wi-Fi, DHCP, OSPF) are read straight from the check result. */
  private diagnoseCheck(r: CheckItemResult): Diagnosis {
    const c = r.check;
    if (c.type === 'wifi-associated') return this.diagnose('not associated', c.client, undefined, { src: c.client });
    if (c.type === 'dhcp-bound') {
      const d = this.devByName(c.device);
      return {
        layer: 'Service',
        title: `${c.device} has no DHCP lease`,
        detail: `dhclient broadcasts a DISCOVER on the link. A router with “ip dhcp pool” for that subnet must hear it: same VLAN, port up, and (for Wi-Fi) an association first. ${r.reason}`,
        device: c.device,
        lookAt: [`${c.device} link state`, 'Router: ip dhcp pool network / default-router', 'Same VLAN between client and router'],
        commands: d ? [{ device: d.name, cmd: 'ip addr' }] : [],
        fix: d ? { label: 'Run dhclient', run: () => this.runDhcp(d) } : undefined,
        reason: r.reason,
      };
    }
    if (c.type === 'ospf-full') {
      return {
        layer: 'Addressing & routing (L3)',
        title: `${c.a} and ${c.b} are not OSPF FULL`,
        detail: `Both routers need “router ospf 1” with a “network <shared subnet> <wildcard> area 0” statement covering the link between them, matching subnets on that link, and the interfaces up. ${r.reason}`,
        device: c.a,
        lookAt: [`${c.a} and ${c.b}: router ospf / network statements`, 'Link interfaces up with addresses in one subnet'],
        commands: [
          { device: c.a, cmd: 'show ip ospf neighbor' },
          { device: c.b, cmd: 'show ip ospf neighbor' },
        ],
        reason: r.reason,
      };
    }
    return this.diagnose(r.reason, undefined, undefined, {});
  }

  async troubleshoot(r?: CheckItemResult) {
    const target = r ?? this.failedChecks()[0];
    if (!target || this.diagBusy()) return;
    const c = target.check;
    this.diagBusy.set(true);
    try {
      if (c.type === 'ping' || c.type === 'ssh') {
        const proto = c.type === 'ssh' ? 'ssh' : 'icmp';
        const family = c.type === 'ping' ? (c.family ?? 'v4') : 'v4';
        const res = await this.api.path(c.src, c.dst, proto, family);
        const drop = [...res.events].reverse().find((e) => e.drop);
        if (res.ok) {
          this.diagnosis.set({
            layer: 'Unknown',
            title: 'Reachable right now',
            detail: `${c.src} can reach ${c.dst} at this moment. Press Check again — the last result is probably stale.`,
            lookAt: [],
            commands: [],
            reason: res.reason,
            reachable: true,
          });
        } else {
          const d = this.diagnose(drop?.reason ?? res.reason ?? target.reason, drop?.from.device ?? c.src, drop?.from.iface, { src: c.src, dst: c.dst });
          this.diagnosis.set(d);
          this.setTrace(res.events, false, d.reason, `${c.type === 'ssh' ? 'SSH' : 'Ping'} ${c.src} → ${c.dst}`);
          this.animate(res.events);
          const dev = d.device ? this.devByName(d.device) : null;
          if (dev) this.selectDevice(dev);
        }
        await this.api.refresh();
      } else {
        this.diagnosis.set(this.diagnoseCheck(target));
      }
    } catch (e) {
      this.fail(e);
    } finally {
      this.diagBusy.set(false);
    }
  }

  troubleshootReach(d: DeviceState) {
    const r = this.reach();
    if (!r?.result) return;
    const t = this.trace();
    this.diagnosis.set(this.diagnose(r.result.reason, t?.dropDevice ?? d.name, undefined, { src: d.name, dst: r.target }));
  }

  goToDevice(name: string) {
    const d = this.devByName(name);
    if (!d) return;
    this.diagnosis.set(null);
    this.paletteOpen.set(false);
    this.selectDevice(d);
    if (this.isNarrow()) {
      if (this.basicMode()) {
        this.prepareIpv4Form(d);
        this.basicSheet.set(true);
      } else this.setTab('inspect');
    }
  }

  runDiagCommand(c: { device: string; cmd: string }) {
    const d = this.devByName(c.device);
    if (!d) return;
    this.diagnosis.set(null);
    this.openTerminalFor(d);
    if (this.focusMode() && !this.focusTerm()) this.toggleFocusTerm();
    void this.runLine(c.cmd);
  }

  async applyDiagFix() {
    const fix = this.diagnosis()?.fix;
    if (!fix) return;
    this.diagnosis.set(null);
    await fix.run();
  }

  async askEveDiag() {
    const d = this.diagnosis();
    if (!d) return;
    this.diagnosis.set(null);
    this.openEve();
    await this.eve.send(
      `The engine dropped a packet${d.device ? ` at ${d.device}` : ''} with reason "${d.reason}". My reading: ${d.title} — ${d.detail} Use get_path and get_lab_state to confirm, then propose the smallest junior-admin fix.`,
    );
  }

  layerChip(layer: DiagLayer) {
    switch (layer) {
      case 'Physical (L1)':
        return 'bg-amber-500/15 text-amber-300';
      case 'Switching (L2)':
        return 'bg-emerald-500/15 text-emerald-300';
      case 'Addressing & routing (L3)':
        return 'bg-sky-500/15 text-sky-300';
      case 'Policy':
        return 'bg-rose-500/15 text-rose-300';
      case 'Wi-Fi':
        return 'bg-violet-500/15 text-violet-300';
      case 'Service':
        return 'bg-fuchsia-500/15 text-fuchsia-300';
      default:
        return 'chip-muted';
    }
  }

  // ===========================================================================
  // live monitor — re-runs one reach test every 5 s until it succeeds
  // ===========================================================================

  startMonitor(d: DeviceState) {
    const r = this.reach();
    const target = r?.target.trim();
    if (!r || !target) {
      this.toast('Pick a target first.', 'warn');
      return;
    }
    this.stopMonitor();
    this.monitor.set({ src: d.name, dst: target, proto: r.proto, ok: null, reason: 'starting…', ticks: 0, busy: false });
    void this.monitorTick();
    this.monitorTimer = setInterval(() => void this.monitorTick(), MONITOR_MS);
  }

  stopMonitor() {
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = null;
    this.monitor.set(null);
  }

  private async monitorTick() {
    const m = this.monitor();
    if (!m || m.busy) return;
    this.monitor.set({ ...m, busy: true });
    try {
      const res = await this.api.path(m.src, m.dst, m.proto, m.dst.includes(':') ? 'v6' : 'v4');
      const cur = this.monitor();
      if (!cur) return;
      const reason = res.ok ? (res.events.find((e) => /echo reply|SSH/i.test(e.reason))?.reason ?? res.reason) : res.reason;
      this.monitor.set({ ...cur, ok: res.ok, reason, ticks: cur.ticks + 1, busy: false });
      this.setTrace(res.events, res.ok, reason, `Watching ${m.src} → ${m.dst}`);
      if (res.ok) {
        this.animate(res.events);
        this.toast(cur.ok === false ? `${m.src} can now reach ${m.dst}.` : `${m.src} already reaches ${m.dst}.`, 'success');
        if (this.monitorTimer) clearInterval(this.monitorTimer);
        this.monitorTimer = null;
        this.monitor.set(null);
      }
    } catch (e) {
      const cur = this.monitor();
      if (cur) this.monitor.set({ ...cur, busy: false, reason: this.errMsg(e) });
    }
  }

  // ===========================================================================
  // checkpoints — save / restore / diff the lab configuration
  // ===========================================================================

  labCheckpoints = computed(() => this.checkpoints().filter((c) => c.labId === this.api.state()?.id));
  otherCheckpoints = computed(() => this.checkpoints().filter((c) => c.labId !== this.api.state()?.id));

  private persistCheckpoints(list: Checkpoint[]) {
    this.checkpoints.set(list);
    try {
      localStorage.setItem(CKPT_KEY, JSON.stringify(list));
    } catch {
      this.toast('Checkpoint kept in memory only (browser storage is full).', 'warn');
    }
  }

  async saveCheckpoint(name?: string) {
    this.menuOpen.set(false);
    try {
      const snap = await this.api.snapshot();
      if (!snap) throw new Error('Nothing to checkpoint yet');
      const n = (name ?? this.ckptName).trim() || `Checkpoint ${this.labCheckpoints().length + 1}`;
      const c: Checkpoint = { id: Date.now().toString(36), name: n, at: Date.now(), labId: snap.id, lab: snap };
      this.persistCheckpoints([c, ...this.checkpoints()].slice(0, 12));
      this.ckptName = '';
      this.toast(`Checkpoint “${n}” saved.`, 'success');
    } catch (e) {
      this.fail(e);
    }
  }

  deleteCheckpoint(id: string) {
    this.persistCheckpoints(this.checkpoints().filter((c) => c.id !== id));
    if (this.diff()?.against.id === id) this.diff.set(null);
  }

  async restoreCheckpoint(c: Checkpoint) {
    this.checkpointsOpen.set(false);
    this.loading.set(true);
    try {
      await this.api.open(undefined, c.lab);
      this.afterOpen();
      this.toast(`Restored “${c.name}”.`, 'success');
    } catch (e) {
      this.fail(e);
    } finally {
      this.loading.set(false);
    }
  }

  /** What changed since the checkpoint: per-device startup lines (engine-generated) plus cables added/removed. */
  async diffCheckpoint(c: Checkpoint) {
    try {
      const now = await this.api.snapshot();
      if (!now) return;
      const lines = (d: LabJson['devices'][number]) => [...(d.startup ?? []), ...(d.post ?? [])];
      const before = new Map(c.lab.devices.map((d) => [d.name, d]));
      const after = new Map(now.devices.map((d) => [d.name, d]));
      const rows: ConfigDiff[] = [];
      for (const [name, dev] of after) {
        const old = before.get(name);
        const cur = lines(dev);
        if (!old) {
          rows.push({ device: name, status: 'added', added: cur, removed: [] });
          continue;
        }
        const prev = lines(old);
        const added = cur.filter((l) => !prev.includes(l));
        const removed = prev.filter((l) => !cur.includes(l));
        if (added.length || removed.length) rows.push({ device: name, status: 'changed', added, removed });
      }
      for (const [name, old] of before) if (!after.has(name)) rows.push({ device: name, status: 'removed', added: [], removed: lines(old) });
      const key = (l: { a: string; b: string }) => `${l.a} — ${l.b}`;
      const la = c.lab.links.map(key);
      const lb = now.links.map(key);
      this.diff.set({ against: c, rows, links: { added: lb.filter((k) => !la.includes(k)), removed: la.filter((k) => !lb.includes(k)) } });
    } catch (e) {
      this.fail(e);
    }
  }

  when(ts: number) {
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
    return new Date(ts).toLocaleDateString();
  }

  // ===========================================================================
  // lab editor — name, goal, description and checks (authoring)
  // ===========================================================================

  openLabEditor() {
    const st = this.api.state();
    if (!st) return;
    this.menuOpen.set(false);
    this.labEdit = { name: st.name, goal: st.goal ?? '', description: st.description ?? '' };
    this.labChecks.set([...(st.checks ?? [])]);
    const hosts = st.devices.filter((d) => d.kind === 'workstation' || d.kind === 'server');
    this.newCheck = { ...this.newCheck, src: hosts[0]?.name ?? st.devices[0]?.name ?? '', dst: '', client: hosts[0]?.name ?? '', device: hosts[0]?.name ?? '', a: '', b: '' };
    this.labEditOpen.set(true);
  }

  addCheck() {
    const n = this.newCheck;
    let c: LabCheck | null = null;
    switch (n.type) {
      case 'ping':
        if (n.src && n.dst.trim()) c = { type: 'ping', src: n.src, dst: n.dst.trim(), family: n.family };
        break;
      case 'ssh':
        if (n.src && n.dst.trim()) c = { type: 'ssh', src: n.src, dst: n.dst.trim(), expect: n.expect };
        break;
      case 'wifi-associated':
        if (n.client) c = { type: 'wifi-associated', client: n.client };
        break;
      case 'dhcp-bound':
        if (n.device) c = { type: 'dhcp-bound', device: n.device };
        break;
      case 'ospf-full':
        if (n.a && n.b && n.a !== n.b) c = { type: 'ospf-full', a: n.a, b: n.b };
        break;
    }
    if (!c) {
      this.toast('Fill in the check first.', 'warn');
      return;
    }
    this.labChecks.update((l) => [...l, c!]);
    this.newCheck.dst = '';
  }

  removeCheck(i: number) {
    this.labChecks.update((l) => l.filter((_, idx) => idx !== i));
  }

  deviceNames() {
    return (this.api.state()?.devices ?? []).map((d) => d.name);
  }

  routerNames() {
    return (this.api.state()?.devices ?? []).filter((d) => d.kind === 'router').map((d) => d.name);
  }

  labIps() {
    const out: string[] = [];
    for (const d of this.api.state()?.devices ?? []) for (const i of d.ifaces) if (i.ipv4?.ip) out.push(i.ipv4.ip);
    return out;
  }

  async applyLabEdit() {
    const name = this.labEdit.name.trim();
    if (!name) {
      this.toast('Give the lab a name.', 'warn');
      return;
    }
    this.labEditBusy.set(true);
    try {
      const snap = await this.api.snapshot();
      if (!snap) throw new Error('Nothing to edit yet');
      const lab: LabJson = {
        ...snap,
        id: this.builtinIds.has(snap.id) ? `nb-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)}-${Math.random().toString(36).slice(2, 6)}` : snap.id,
        name,
        goal: this.labEdit.goal.trim(),
        description: this.labEdit.description.trim() || undefined,
        checks: this.labChecks(),
      };
      this.labEditOpen.set(false);
      this.loading.set(true);
      await this.api.open(undefined, lab);
      this.labs.update((list) => [{ id: lab.id, name: `${lab.name} (this browser)`, goal: lab.goal ?? '', custom: true }, ...list.filter((l) => l.id !== lab.id && !l.custom)]);
      this.afterOpen();
      this.toast('Lab updated. Share it with ⋯ → Copy share link.', 'success');
    } catch (e) {
      this.fail(e);
    } finally {
      this.labEditBusy.set(false);
      this.loading.set(false);
    }
  }

  // ===========================================================================
  // command palette
  // ===========================================================================

  private buildPalette(): PaletteItem[] {
    const st = this.api.state();
    const items: PaletteItem[] = [];
    const act = (id: string, label: string, icon: IconName, run: () => unknown, hint?: string) => items.push({ id, group: 'Actions', label, icon, run, hint });
    act('check', 'Run Check', 'circle-check', () => this.doCheck(), 'Ctrl+Enter');
    if (this.failedChecks().length) act('troubleshoot', 'Troubleshoot the failing check', 'stethoscope', () => this.troubleshoot());
    act('tidy', 'Tidy up layout', 'tidy', () => this.tidyUp());
    act('fit', 'Fit topology to view', 'fit', () => this.fitToView(), 'F');
    if (!this.isNarrow()) act('focus', this.focus() ? 'Exit focus mode' : 'Focus mode (canvas only)', this.focus() ? 'collapse' : 'expand', () => this.toggleFocus(), 'Shift+F');
    act('adv', this.advanced() ? 'Switch to Simple view' : 'Switch to Advanced view', 'inspect', () => this.toggleAdvanced());
    act('eve', this.showEve() ? 'Hide Eve' : 'Open Eve', 'sparkles', () => this.toggleEve(), 'E');
    act('ckpt', 'Save checkpoint', 'bookmark', () => this.saveCheckpoint());
    act('ckpts', 'Checkpoints: restore or diff…', 'clock', () => this.checkpointsOpen.set(true));
    act('edit', 'Edit lab name, goal and checks…', 'pencil', () => this.openLabEditor());
    act('share', 'Copy share link', 'link', () => this.copyShareLink());
    act('report', 'Copy lab report (Markdown)', 'file', () => this.copyReport());
    act('json', 'Download lab JSON', 'download', () => this.saveJson(), 'Ctrl+S');
    act('saveas', 'Save a copy to my account…', 'save', () => this.openSaveAs());
    act('reset', 'Reset lab to its start', 'reset', () => this.confirmReset.set(true));
    act('cheat', 'Command reference', 'book', () => this.openCheat());
    act('keys', 'Keyboard shortcuts', 'keyboard', () => this.shortcutsOpen.set(true), '?');
    act('help', 'Help topics', 'help', () => this.helpOpen.set('hub'));
    act('view-subnet', `${this.view().subnet ? 'Hide' : 'Show'} subnet colours`, 'palette', () => this.toggleView('subnet'));
    act('view-vlan', `${this.view().vlan ? 'Hide' : 'Show'} VLAN labels on cables`, 'layers', () => this.toggleView('vlan'));
    for (const p of PALETTE) {
      items.push({ id: `add-${p.kind}`, group: 'Add device', label: `Add ${p.label}`, hint: p.hint, icon: this.kindIcon(p.kind), run: () => (this.isNarrow() ? this.place(p.kind) : this.addDevice(p.kind)) });
    }
    for (const d of st?.devices ?? []) {
      items.push({ id: `sel-${d.id}`, group: 'Devices', label: `Select ${d.name}`, hint: `${this.kindLabel(d.kind)} · ${this.primaryIpv4(d) ?? 'no IPv4'}`, icon: this.kindIcon(d.kind), run: () => this.goToDevice(d.name) });
      items.push({ id: `term-${d.id}`, group: 'Devices', label: `Terminal on ${d.name}`, icon: 'terminal', run: () => this.openTerminalFor(d) });
    }
    for (const l of this.labs()) items.push({ id: `lab-${l.id}`, group: 'Labs', label: `Open lab: ${l.name}`, hint: l.goal, icon: 'flag', run: () => this.loadLab(l.id) });
    return items;
  }

  openPalette() {
    this.menuOpen.set(false);
    this.moreOpen.set(false);
    this.paletteQ.set('');
    this.paletteIdx.set(0);
    this.paletteOpen.set(true);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[name="palette"]')?.focus());
  }

  setPaletteQ(v: string) {
    this.paletteQ.set(v);
    this.paletteIdx.set(0);
  }

  paletteKey(ev: KeyboardEvent) {
    const items = this.paletteItems();
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.paletteIdx.set(Math.min(this.paletteIdx() + 1, Math.max(items.length - 1, 0)));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.paletteIdx.set(Math.max(this.paletteIdx() - 1, 0));
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const item = items[this.paletteIdx()];
      if (item) this.runPalette(item);
    }
  }

  runPalette(item: PaletteItem) {
    this.paletteOpen.set(false);
    void item.run();
  }

  // ===========================================================================
  // view options, report
  // ===========================================================================

  toggleView(k: keyof ViewOptions) {
    const v = { ...this.view(), [k]: !this.view()[k] };
    this.view.set(v);
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  }

  ipClass(d: DeviceState) {
    if (!this.view().subnet) return 'text-ok-300/90';
    const ip = d.ifaces.find((i) => i.ipv4?.ip)?.ipv4;
    if (!ip) return 'text-ok-300/90';
    const n = this.parseV4(ip.ip);
    if (n == null) return 'text-ok-300/90';
    return this.subnetColors().get(`${(n & this.maskOf(ip.prefix || 24)) >>> 0}/${ip.prefix}`) ?? 'text-ok-300/90';
  }

  /** Cable-end label: interface name plus the switch port's VLAN role (v10 / T) when the VLAN overlay is on. */
  linkLabel(l: LinkState, end: 'a' | 'b') {
    const e = end === 'a' ? l.a : l.b;
    if (!this.view().vlan) return e.iface;
    const d = this.api.state()?.devices.find((x) => x.id === e.deviceId);
    const i = d?.ifaces.find((x) => x.name === e.iface);
    if (!d || !i || d.kind !== 'switch') return e.iface;
    if (i.mode === 'trunk') return `${e.iface} T`;
    return i.accessVlan !== 1 ? `${e.iface} v${i.accessVlan}` : e.iface;
  }

  buildReport(): string {
    const st = this.api.state();
    if (!st) return '';
    const L: string[] = [`# ${st.name}`, ''];
    if (st.goal) L.push(`**Goal:** ${st.goal}`, '');
    if (st.description) L.push(st.description, '');
    L.push(`_Generated ${new Date().toLocaleString()} by NetBench_`, '', '## Devices', '', '| Device | Type | IPv4 | Gateway | Ports up |', '| --- | --- | --- | --- | --- |');
    for (const d of st.devices) {
      const ips = this.ipv4Rows(d).map((r) => `${r.ip} (${r.name})`).join(', ') || '—';
      const up = this.usedPortRows(d).filter((p) => p.up).length;
      L.push(`| ${d.name} | ${this.kindLabel(d.kind)} | ${ips} | ${this.gatewayOf(d) ?? '—'} | ${up}/${this.usedPortRows(d).length} |`);
    }
    L.push('', '## Cables', '');
    for (const l of st.links) L.push(`- ${l.a.device}:${l.a.iface} — ${l.b.device}:${l.b.iface} (${this.cableLabel(l.kind === 'radio' ? 'radio' : l.cable)}${this.linkIsDown(l) ? ', no link' : ''})`);
    if (!st.links.length) L.push('- none');
    L.push('', '## Checks', '');
    for (const c of this.checklist()) L.push(`- ${c.ok === true ? '✅' : c.ok === false ? '❌' : '⬜'} ${c.label}${c.ok === false && c.reason ? ` — ${c.reason}` : ''}`);
    if (!this.checklist().length) L.push('- none');
    const drops = st.packets.filter((p) => p.drop).slice(-5);
    if (drops.length) {
      L.push('', '## Recent drops', '');
      for (const p of drops) L.push(`- ${p.proto} ${p.srcIp ?? p.srcMac} → ${p.dstIp ?? p.dstMac} at ${p.from.device}:${p.from.iface}: ${p.reason}`);
    }
    return L.join('\n');
  }

  async copyReport() {
    this.menuOpen.set(false);
    try {
      const md = this.buildReport();
      if (!md) throw new Error('Nothing to report yet');
      await navigator.clipboard.writeText(md);
      this.toast('Lab report copied as Markdown.', 'success');
    } catch (e) {
      this.fail(e);
    }
  }

  downloadReport() {
    this.menuOpen.set(false);
    const st = this.api.state();
    const md = this.buildReport();
    if (!st || !md) return;
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${st.id}-report.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ===========================================================================
  // keyboard
  // ===========================================================================

  private onKey = (ev: KeyboardEvent) => {
    const target = ev.target as HTMLElement | null;
    const inField = !!target?.closest('input,textarea,select,[contenteditable]');
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'c' && target?.closest('input[name="cli"]')) {
      this.cancelPing();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') {
      ev.preventDefault();
      this.saveJson();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
      ev.preventDefault();
      void this.doCheck();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      if (this.paletteOpen()) this.paletteOpen.set(false);
      else this.openPalette();
      return;
    }
    if (ev.key === 'Escape') {
      if (this.paletteOpen()) return this.paletteOpen.set(false);
      if (this.diagnosis()) return this.diagnosis.set(null);
      if (this.labEditOpen()) return this.labEditOpen.set(false);
      if (this.checkpointsOpen()) {
        if (this.diff()) return this.diff.set(null);
        return this.checkpointsOpen.set(false);
      }
      if (this.helpOpen()) return this.helpOpen.set(null);
      if (this.shortcutsOpen()) return this.shortcutsOpen.set(false);
      if (this.showCheat()) return this.showCheat.set(false);
      if (this.authOpen()) return this.authOpen.set(false);
      if (this.saveAsOpen()) return this.saveAsOpen.set(false);
      if (this.aboutOpen()) return this.aboutOpen.set(false);
      if (this.welcomeOpen()) return this.dismissWelcome();
      if (this.confirmReset()) return this.confirmReset.set(false);
      if (this.confirmDel()) return this.confirmDel.set(null);
      if (this.menuOpen() || this.moreOpen() || this.focusAddOpen()) {
        this.menuOpen.set(false);
        this.moreOpen.set(false);
        this.focusAddOpen.set(false);
        return;
      }
      if (this.reach()) return this.closeReach();
      if (this.wifiOpen()) return this.wifiOpen.set(false);
      this.cancelCable();
      this.placing.set(null);
      this.addOpen.set(false);
      this.basicSheet.set(false);
      this.selectedLinkId.set(null);
      if (this.trace()) this.clearTrace();
      return;
    }
    if (inField) return;
    if (ev.key === 'Delete' && this.selected()) {
      this.confirmDel.set(this.selected());
      return;
    }
    if (ev.key === '?') {
      this.shortcutsOpen.set(!this.shortcutsOpen());
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    switch (ev.key) {
      case '+':
      case '=':
        this.zoomBy(1.2);
        break;
      case '-':
      case '_':
        this.zoomBy(1 / 1.2);
        break;
      case '0':
        this.resetZoom();
        break;
      case 'f':
        this.fitToView();
        break;
      case 'F':
        if (!this.isNarrow()) this.toggleFocus();
        break;
      case 't':
      case 'T':
        ev.preventDefault();
        this.terminal()?.focus();
        break;
      case 'e':
      case 'E':
        this.toggleEve();
        break;
      case 'c':
      case 'C':
        this.armCable('ethernet');
        break;
    }
  };

  // ===========================================================================
  // canvas: pan / zoom / pointer
  // ===========================================================================

  cardW() {
    return this.advUi() ? CARD_W_ADV : CARD_W_SIMPLE;
  }

  private anchor(d: { x: number; y: number }) {
    return { x: d.x + this.cardW() / 2, y: d.y + ANCHOR_Y };
  }

  worldFromEvent(ev: { clientX: number; clientY: number }, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const p = this.pan();
    return { x: (ev.clientX - r.left - p.x) / p.s, y: (ev.clientY - r.top - p.y) / p.s };
  }

  onWheel(ev: WheelEvent, el: HTMLElement) {
    ev.preventDefault();
    this.stageEl = el;
    this.zoomAt(ev.clientX, ev.clientY, ev.deltaY > 0 ? 0.9 : 1.1, el);
  }

  zoomBy(factor: number) {
    const el = this.stage?.nativeElement ?? this.stageEl;
    if (!el) return;
    const r = el.getBoundingClientRect();
    this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor, el);
  }

  resetZoom() {
    const el = this.stage?.nativeElement ?? this.stageEl;
    const p = this.pan();
    if (!el) {
      this.pan.set({ ...p, s: 1 });
      return;
    }
    const r = el.getBoundingClientRect();
    const cx = r.width / 2;
    const cy = r.height / 2;
    this.pan.set({ x: cx - ((cx - p.x) * 1) / p.s, y: cy - ((cy - p.y) * 1) / p.s, s: 1 });
  }

  canvasDown(ev: PointerEvent, el: HTMLElement) {
    this.stageEl = el;
    this.guardCanvas(el);
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if ((ev.target as HTMLElement).closest('[data-dev]')) return;
    try {
      el.setPointerCapture?.(ev.pointerId);
    } catch {
      /* ignore inactive/synthetic pointers */
    }
    if (this.placing()) {
      const w = this.worldFromEvent(ev, el);
      const kind = this.placing()!;
      this.placing.set(null);
      this.pointers.delete(ev.pointerId);
      void this.addDevice(kind, { x: Math.round(w.x / GRID) * GRID - this.cardW() / 2, y: Math.round(w.y / GRID) * GRID - ANCHOR_Y });
      return;
    }
    if (this.pointers.size >= 2) {
      this.dragging = null;
      this.panning = null;
      this.startPinch();
      return;
    }
    this.moved = false;
    this.panning = { x: this.pan().x, y: this.pan().y, px: ev.clientX, py: ev.clientY };
  }

  canvasMove(ev: PointerEvent) {
    if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.cableFrom()) {
      const el = this.stageEl ?? this.stage?.nativeElement;
      if (el) this.cableCursor.set(this.worldFromEvent(ev, el));
    }
    if (this.pinch && this.pointers.size >= 2) {
      ev.preventDefault();
      this.movePinch();
      return;
    }
    if (this.panning || this.dragging) ev.preventDefault();
    if (this.panning) {
      const dx = ev.clientX - this.panning.px;
      const dy = ev.clientY - this.panning.py;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.moved = true;
      this.pan.set({ ...this.pan(), x: this.panning.x + dx, y: this.panning.y + dy });
    }
    if (this.dragging) {
      const st = this.api.state();
      if (!st) return;
      const d = st.devices.find((x) => x.id === this.dragging!.id);
      if (!d) return;
      d.x = Math.round((this.dragging.ox + ev.clientX) / GRID) * GRID;
      d.y = Math.round((this.dragging.oy + ev.clientY) / GRID) * GRID;
      this.api.state.set({ ...st });
    }
  }

  canvasUp(ev?: PointerEvent) {
    if (ev) this.pointers.delete(ev.pointerId);
    else if (this.pointers.size) return;
    else this.pointers.clear();

    if (this.pointers.size >= 2) {
      this.startPinch();
      return;
    }
    this.pinch = null;
    if (this.pointers.size === 1) {
      const pt = [...this.pointers.values()][0];
      this.panning = { x: this.pan().x, y: this.pan().y, px: pt.x, py: pt.y };
      this.dragging = null;
      return;
    }
    if (this.panning && !this.moved && !this.dragging) {
      // Plain click on empty canvas: clear selection state.
      if (!this.cableArmed()) {
        this.selectedLinkId.set(null);
        if (this.trace() && !this.reach()) this.clearTrace();
      }
    }
    if (this.dragging) {
      const d = this.api.state()?.devices.find((x) => x.id === this.dragging!.id);
      if (d) {
        void this.api.edit(undefined, [{ id: d.id, x: d.x, y: d.y }]).catch(() => undefined);
        if (this.isNarrow() && this.tapAt && Math.hypot(d.x - this.tapAt.x, d.y - this.tapAt.y) < 12) {
          if (this.basicMode()) {
            this.prepareIpv4Form(d);
            this.basicSheet.set(true);
          } else this.mobileTab.set('inspect');
        }
      }
    }
    this.panning = null;
    this.dragging = null;
    this.tapAt = null;
  }

  startDrag(ev: PointerEvent, d: DeviceState) {
    ev.stopPropagation();
    const from = this.cableFrom();
    if (this.cableArmed() || from) {
      if (from && from.id !== d.id) {
        void this.finishCable(d);
        this.basicSheet.set(false);
        return;
      }
      if (!from) {
        this.startCable(ev, d);
        return;
      }
    }
    const host = (ev.currentTarget as HTMLElement).closest('.grid-canvas') as HTMLElement | null;
    if (host) {
      this.stageEl = host;
      this.guardCanvas(host);
    }
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try {
      (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    } catch {
      /* ignore inactive/synthetic pointers */
    }
    if (this.pointers.size >= 2) {
      this.dragging = null;
      this.panning = null;
      this.startPinch();
      return;
    }
    this.selectDevice(d);
    this.tapAt = { x: d.x, y: d.y };
    this.dragging = { id: d.id, ox: d.x - ev.clientX, oy: d.y - ev.clientY };
  }

  selectDevice(d: DeviceState) {
    if (this.selectedId() !== d.id) {
      this.reach.set(null);
      this.wifiOpen.set(false);
      this.showFreePorts.set(false);
      this.gwEdit.set(false);
      this.ipEdit.set(null);
    }
    this.selectedId.set(d.id);
    this.termDevice.set(d.id);
    this.selectedLinkId.set(null);
    void this.loadVocab(d.kind);
  }

  private beginGesture(cx: number, cy: number) {
    if (this.pointers.size >= 2) return;
    const p = this.pan();
    this.gesture = { s: p.s, x: p.x, y: p.y, cx, cy };
  }

  private applyGestureScale(scale: number) {
    if (this.pointers.size >= 2 || !this.gesture) return;
    const s = Math.min(2.4, Math.max(0.35, this.gesture.s * scale));
    const { cx, cy, x: px, y: py, s: ps } = this.gesture;
    this.pan.set({ x: cx - ((cx - px) * s) / ps, y: cy - ((cy - py) * s) / ps, s });
    this.cdr.detectChanges();
  }

  private onGestureEnd() {
    this.gesture = null;
  }

  private zoomAt(clientX: number, clientY: number, factor: number, el: HTMLElement) {
    const p = this.pan();
    const s = Math.min(2.4, Math.max(0.35, p.s * factor));
    const r = el.getBoundingClientRect();
    const cx = clientX - r.left;
    const cy = clientY - r.top;
    this.pan.set({ x: cx - ((cx - p.x) * s) / p.s, y: cy - ((cy - p.y) * s) / p.s, s });
  }

  private startPinch() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
    const p = this.pan();
    this.pinch = { dist, s: p.s, x: p.x, y: p.y, mx: (pts[0].x + pts[1].x) / 2, my: (pts[0].y + pts[1].y) / 2 };
  }

  private movePinch() {
    if (!this.pinch) return;
    const el = this.stageEl ?? this.stage?.nativeElement;
    if (!el) return;
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
    const mx = (pts[0].x + pts[1].x) / 2;
    const my = (pts[0].y + pts[1].y) / 2;
    const s = Math.min(2.4, Math.max(0.35, this.pinch.s * (dist / this.pinch.dist)));
    const r = el.getBoundingClientRect();
    const cx = this.pinch.mx - r.left;
    const cy = this.pinch.my - r.top;
    this.pan.set({
      x: cx - ((cx - this.pinch.x) * s) / this.pinch.s + (mx - this.pinch.mx),
      y: cy - ((cy - this.pinch.y) * s) / this.pinch.s + (my - this.pinch.my),
      s,
    });
  }

  private guardCanvas(el: HTMLElement) {
    if (this.guarded.has(el)) return;
    this.guarded.add(el);
    const stop = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchmove', stop, { passive: false });
    el.addEventListener(
      'gesturestart',
      (e) => {
        stop(e);
        const ge = e as unknown as { clientX?: number; clientY?: number; scale?: number };
        const r = el.getBoundingClientRect();
        const cx = (ge.clientX ?? r.left + r.width / 2) - r.left;
        const cy = (ge.clientY ?? r.top + r.height / 2) - r.top;
        this.stageEl = el;
        this.beginGesture(cx, cy);
      },
      { passive: false },
    );
    el.addEventListener(
      'gesturechange',
      (e) => {
        stop(e);
        const rec = e as unknown as Record<string, unknown>;
        let scale = Number(rec['scale']);
        if (!Number.isFinite(scale) || scale <= 0) {
          const orig = rec['originalEvent'] ?? rec['srcEvent'];
          if (orig && typeof orig === 'object') scale = Number((orig as { scale?: number }).scale);
        }
        this.applyGestureScale(Number.isFinite(scale) && scale > 0 ? scale : 1);
      },
      { passive: false },
    );
    el.addEventListener('gestureend', () => this.onGestureEnd(), { passive: false });
  }

  private fitIfNarrow() {
    if (!this.isNarrow()) {
      this.pendingFit = false;
      return;
    }
    const el = this.stage?.nativeElement ?? this.stageEl;
    const devices = this.api.state()?.devices ?? [];
    if (!el || el.getBoundingClientRect().width < 40 || !devices.length) {
      this.pendingFit = true;
      return;
    }
    this.pendingFit = false;
    this.fitToView();
  }

  fitToView() {
    const el = this.stage?.nativeElement ?? this.stageEl;
    const devices = this.api.state()?.devices ?? [];
    if (!el || !devices.length) return;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const d of devices) {
      minX = Math.min(minX, d.x);
      minY = Math.min(minY, d.y);
      maxX = Math.max(maxX, d.x + this.cardW());
      maxY = Math.max(maxY, d.y + 110);
    }
    const pad = this.isNarrow() ? 28 : 64;
    // Keep the topology clear of the goal card (top-left overlay) and the bottom toolbars.
    const top = this.isNarrow() ? 72 : this.goalOpen() ? 150 : 72;
    const bottom = this.isNarrow() ? 72 : this.focusMode() ? 72 : 56;
    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    const availH = Math.max(r.height - top - bottom, 80);
    const s = Math.min(1.4, Math.max(0.35, Math.min((r.width - pad * 2) / bw, availH / bh)));
    this.pan.set({ x: (r.width - bw * s) / 2 - minX * s, y: top + (availH - bh * s) / 2 - minY * s, s });
  }

  // ===========================================================================
  // canvas: geometry & rendering helpers
  // ===========================================================================

  linkPath(l: { a: { deviceId: string }; b: { deviceId: string } }) {
    const st = this.api.state();
    const a = st?.devices.find((d) => d.id === l.a.deviceId);
    const b = st?.devices.find((d) => d.id === l.b.deviceId);
    if (!a || !b) return '';
    const pa = this.anchor(a);
    const pb = this.anchor(b);
    return `M ${pa.x} ${pa.y} L ${pb.x} ${pb.y}`;
  }

  /** Label position for a cable end, ~26% along the segment from that end. */
  linkLabelPos(l: LinkState, end: 'a' | 'b') {
    const st = this.api.state();
    const a = st?.devices.find((d) => d.id === l.a.deviceId);
    const b = st?.devices.find((d) => d.id === l.b.deviceId);
    if (!a || !b) return { x: 0, y: 0 };
    const pa = this.anchor(a);
    const pb = this.anchor(b);
    const t = end === 'a' ? 0.26 : 0.74;
    return { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t - 6 };
  }

  rubberPath() {
    const from = this.cableFrom();
    const cur = this.cableCursor();
    const st = this.api.state();
    if (!from || !cur || !st) return '';
    const a = st.devices.find((d) => d.id === from.id);
    if (!a) return '';
    const pa = this.anchor(a);
    return `M ${pa.x} ${pa.y} L ${cur.x} ${cur.y}`;
  }

  linkStroke(l: LinkState) {
    if (this.selectedLinkId() === l.id) return '#22d3ee';
    if (this.linkInTrace(l)) return this.trace()?.ok || !this.trace()?.dropDevice ? '#67e8f9' : '#fb7185';
    if (l.kind === 'radio') return '#a78bfa';
    if (l.cable === 'fiber') return '#fb923c';
    if (l.cable === 'crossover') return '#2dd4bf';
    if (l.cable === 'straight') return '#94a3b8';
    return '#7c8aa5';
  }

  linkDash(l: LinkState) {
    if (l.kind === 'radio') return '6 4';
    if (l.cable === 'crossover') return '8 3';
    if (l.cable === 'fiber') return '2 3';
    return '0';
  }

  linkIsDown(l: LinkState) {
    if (l.kind === 'radio') return false;
    const st = this.api.state();
    const da = st?.devices.find((d) => d.id === l.a.deviceId);
    const ia = da?.ifaces.find((i) => i.name === l.a.iface);
    return !!ia && !ia.operUp;
  }

  /** Plays packet hops one after another so the path is readable. Duplicate ids within 3s are ignored. */
  animate(events: PacketEvent[], force = false) {
    const st = this.api.state();
    if (!st || !events.length) return;
    const now = Date.now();
    for (const [id, t] of this.recentAnim) if (now - t > 3000) this.recentAnim.delete(id);
    const fresh = force ? events : events.filter((e) => !this.recentAnim.has(e.id));
    if (!fresh.length) return;
    for (const e of fresh) this.recentAnim.set(e.id, now);
    if (!this.view().anim && !force) {
      this.selectedPkt.set(fresh[fresh.length - 1]);
      return;
    }
    const pos = (name: string) => {
      const d = st.devices.find((x) => x.name === name || x.id === name);
      return d ? this.anchor(d) : { x: 0, y: 0 };
    };
    const frames = fresh
      .filter((e) => e.to)
      .slice(0, 40)
      .map((e) => {
        const a = pos(e.from.device);
        const b = pos(e.to!.device);
        return { id: e.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, drop: e.drop, hop: e.to!.device };
      });
    if (!frames.length) {
      const last = fresh[fresh.length - 1];
      this.selectedPkt.set(last);
      return;
    }
    const token = ++this.replayToken;
    const step = frames.length > 12 ? 160 : 380;
    frames.forEach((f, i) => {
      setTimeout(() => {
        if (token !== this.replayToken) return;
        this.animPkts.set([f]);
        this.activeHop.set(f.hop);
      }, i * step);
    });
    setTimeout(() => {
      if (token !== this.replayToken) return;
      this.animPkts.set([]);
      this.activeHop.set(null);
    }, frames.length * step + 500);
    this.selectedPkt.set(fresh[fresh.length - 1]);
  }

  // ===========================================================================
  // dock resize
  // ===========================================================================

  startDockResize(ev: PointerEvent) {
    ev.preventDefault();
    this.dockDrag = { y: ev.clientY, h: this.dockH() };
    const move = (e: PointerEvent) => {
      if (!this.dockDrag) return;
      const h = Math.min(Math.max(this.dockDrag.h + (this.dockDrag.y - e.clientY), 120), Math.max(160, window.innerHeight * 0.7));
      this.dockH.set(Math.round(h));
    };
    const up = () => {
      this.dockDrag = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(DOCK_KEY, String(this.dockH()));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  @HostListener('window:mouseup')
  up() {
    if (this.pointers.size) return;
    this.canvasUp();
  }

  @HostListener('window:resize')
  onResize() {
    const narrow = window.innerWidth < 768;
    const was = this.isNarrow();
    this.isNarrow.set(narrow);
    if (narrow) {
      this.eveOpen.set(false);
      if (!was) requestAnimationFrame(() => this.fitIfNarrow());
    } else if (was) this.eveOpen.set(this.initialEveOpen());
  }
}
