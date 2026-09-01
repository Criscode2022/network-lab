import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import { Api, PALETTE, type DeviceState, type IfaceState, type PacketEvent } from './api';
import { EveClient } from './eve-client';

@Component({
  selector: 'app-workspace',
  imports: [FormsModule, NgClass],
  templateUrl: './workspace.html',
})
export class Workspace implements OnInit, AfterViewInit, OnDestroy {
  readonly api = inject(Api);
  readonly eve = inject(EveClient);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly PALETTE = PALETTE;
  labs = signal<{ id: string; name: string; goal: string }[]>([]);
  selectedId = signal<string | null>(null);
  termDevice = signal<string | null>(null);
  termLines = signal<{ text: string; err?: boolean }[]>([]);
  termInput = '';
  pan = signal({ x: 40, y: 40, s: 1 });
  @ViewChild('stage') stage?: ElementRef<HTMLElement>;
  dragging: { id: string; ox: number; oy: number } | null = null;
  panning: { x: number; y: number; px: number; py: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; s: number; x: number; y: number; mx: number; my: number } | null = null;
  private gesture: { s: number; x: number; y: number; cx: number; cy: number } | null = null;
  private stageEl: HTMLElement | null = null;
  private pendingFit = false;
  private guarded = new WeakSet<HTMLElement>();
  cableFrom = signal<{ id: string; iface: string } | null>(null);
  placing = signal<string | null>(null);
  addOpen = signal(false);
  advanced = signal(typeof localStorage !== 'undefined' && localStorage.getItem('nb_advanced') === '1');
  basic = signal(typeof localStorage === 'undefined' || localStorage.getItem('nb_basic') !== '0');
  basicSheet = signal(false);
  hint = signal<string | null>(null);
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  confirmDel = signal<DeviceState | null>(null);
  inspectorTab = signal<'ifaces' | 'run' | 'packets'>('ifaces');
  selectedPkt = signal<PacketEvent | null>(null);
  checkMsg = signal<string | null>(null);
  showCheat = signal(false);
  cheat = signal('');
  eveOpen = signal(typeof window === 'undefined' || window.innerWidth >= 768);
  isNarrow = signal(typeof window !== 'undefined' && window.innerWidth < 768);
  mobileTab = signal<'canvas' | 'palette' | 'inspect' | 'term' | 'eve'>('canvas');
  moreOpen = signal(false);
  readonly mobileTabs = [
    { id: 'canvas' as const, label: 'Canvas' },
    { id: 'palette' as const, label: 'Palette' },
    { id: 'inspect' as const, label: 'Inspect' },
    { id: 'term' as const, label: 'Term' },
    { id: 'eve' as const, label: 'Eve' },
  ];
  eveInput = '';
  buildPrompt = '';
  private mq: MediaQueryList | null = null;
  private tapAt: { x: number; y: number } | null = null;
  pending = signal<{ title: string; patch?: unknown; deviceId?: string; commands?: string[]; requestId?: string } | null>(null);
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  authOpen = signal(false);
  email = '';
  password = '';
  animPkts = signal<{ id: string; x1: number; y1: number; x2: number; y2: number; drop?: boolean }[]>([]);

  selected = computed(() => this.api.state()?.devices.find((d) => d.id === this.selectedId()) ?? null);
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

  async ngOnInit() {
    this.api.onPackets = (events) => this.animate(events);
    const b = await this.api.builtins();
    this.labs.set(b.labs);
    await this.api.open('lab-1-first-ipv4-ping');
    const first = this.api.state()?.devices[0];
    if (first) {
      this.selectedId.set(first.id);
      this.termDevice.set(first.id);
      this.termLines.set([{ text: `Connected to ${first.hostname}. Type help.` }]);
    }
    this.bindEve();
    this.mq = window.matchMedia('(max-width: 767px)');
    this.onMq(this.mq);
    this.mq.addEventListener('change', this.onMq);
    requestAnimationFrame(() => this.fitIfNarrow());
    window.addEventListener('keydown', this.onKey);
    this.saveTimer = setInterval(() => {
      const st = this.api.state();
      if (!st) return;
      localStorage.setItem('nb_autosave', JSON.stringify({ id: st.id, sessionId: this.api.sessionId(), at: Date.now() }));
      void this.api.save().catch(() => undefined);
    }, 12000);
  }

  ngAfterViewInit() {
    const el = this.stage?.nativeElement;
    if (el) this.guardCanvas(el);
    requestAnimationFrame(() => this.fitIfNarrow());
  }

  ngOnDestroy() {
    window.removeEventListener('keydown', this.onKey);
    this.mq?.removeEventListener('change', this.onMq);
    if (this.saveTimer) clearInterval(this.saveTimer);
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.api.disconnectWs();
    this.eve.stop();
  }

  private onMq = (e: MediaQueryList | MediaQueryListEvent) => {
    const narrow = e.matches;
    const was = this.isNarrow();
    this.isNarrow.set(narrow);
    if (narrow) {
      this.eveOpen.set(false);
      requestAnimationFrame(() => this.fitIfNarrow());
    } else if (was) this.eveOpen.set(true);
  };

  setTab(tab: 'canvas' | 'palette' | 'inspect' | 'term' | 'eve') {
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
  }

  place(kind: string) {
    this.addOpen.set(false);
    if (this.isNarrow()) {
      this.placing.set(null);
      this.mobileTab.set('canvas');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => void this.addDevice(kind));
      });
      return;
    }
    this.placing.set(this.placing() === kind ? null : kind);
  }

  toggleAdvanced() {
    const next = !this.advanced();
    this.advanced.set(next);
    try {
      localStorage.setItem('nb_advanced', next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  basicMode() {
    return this.isNarrow() && this.basic();
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
    this.cableFrom.set(null);
    if (next) {
      this.mobileTab.set('canvas');
      this.eveOpen.set(false);
      this.advanced.set(false);
      requestAnimationFrame(() => this.fitIfNarrow());
    }
  }

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

  primaryIpv4(d: DeviceState): string | null {
    for (const i of d.ifaces) {
      if (i.ipv4?.ip) return `${i.ipv4.ip}/${i.ipv4.prefix}`;
    }
    return null;
  }

  ipv4Rows(d: DeviceState) {
    return d.ifaces
      .filter((i) => i.ipv4?.ip)
      .map((i) => ({ name: i.name, ip: `${i.ipv4!.ip}/${i.ipv4!.prefix}`, status: this.linkStatus(i) }));
  }

  emptyIpv4Hint(d: DeviceState) {
    const iface =
      d.ifaces.find((i) => !i.isRadio && !i.name.includes('.') && !i.name.toLowerCase().startsWith('vlan'))?.name ?? 'eth0';
    if (d.kind === 'workstation' || d.kind === 'server' || d.kind === 'firewall' || d.kind === 'cloud') {
      return `ip addr add 10.0.0.10/24 dev ${iface}`;
    }
    return `interface ${iface} → ip address 10.0.0.1 255.255.255.0 → no shutdown`;
  }

  linkStatus(i: IfaceState) {
    if (!i.adminUp) return 'Disabled';
    if (!i.operUp) return 'Unplugged';
    return 'Up';
  }

  ipv6Rows(i: IfaceState) {
    const rows = i.ipv6.map((v) => ({
      ip: `${v.ip}/${v.prefix}`,
      linkLocal: v.ip.toLowerCase().startsWith('fe80:'),
    }));
    return [...rows.filter((r) => !r.linkLocal), ...rows.filter((r) => r.linkLocal)];
  }

  cardIfaces(d: DeviceState) {
    const phys = d.ifaces.filter((i) => !i.name.includes('.') && !i.name.toLowerCase().startsWith('vlan'));
    if (this.advanced()) return phys;
    return phys.filter((i) => !i.isRadio).slice(0, 2);
  }

  visiblePackets() {
    const last = [...(this.api.state()?.packets ?? [])].slice(-12).reverse();
    if (this.advanced()) return last;
    const v4 = last.filter((p) => p.srcIp && !p.srcIp.includes(':'));
    return v4.length ? v4 : last.filter((p) => !p.srcIp?.includes(':'));
  }

  packetLine(p: PacketEvent) {
    const src = p.srcIp || (this.advanced() ? p.srcMac : '');
    const dst = p.dstIp || (this.advanced() ? p.dstMac : '');
    const path = src && dst ? `${src} → ${dst}` : p.proto;
    return `${p.proto} ${path}`;
  }

  private nameFor(kind: string) {
    const prefix: Record<string, string> = {
      workstation: 'PC',
      server: 'SRV',
      switch: 'SW',
      router: 'R',
      firewall: 'FW',
      ap: 'AP',
      wlc: 'WLC',
      cloud: 'NET',
    };
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
        x = Math.round(w.x / 24) * 24;
        y = Math.round(w.y / 24) * 24;
      }
    }
    const occupied = (px: number, py: number) => devices.some((d) => Math.abs(d.x - px) < 140 && Math.abs(d.y - py) < 110);
    for (let n = 0; n < 20 && occupied(x, y); n++) {
      x += 144;
      if (n % 3 === 2) {
        x -= 432;
        y += 110;
      }
    }
    return { x, y };
  }

  async addDevice(kind: string) {
    const name = this.nameFor(kind);
    const pos = this.dropPoint();
    try {
      await this.api.edit({ addDevices: [{ type: kind, name, x: pos.x, y: pos.y }] });
    } catch (e) {
      this.showHint(String(e));
      return;
    }
    const d = this.api.state()?.devices.find((x) => x.name === name);
    if (d) {
      this.selectedId.set(d.id);
      this.termDevice.set(d.id);
    }
    this.showHint(
      this.basicMode()
        ? `${name} added. Drag it. Tap it, then Cable.`
        : `${this.kindLabel(kind)} ${name} added. Drag to move. Tap Cable, then another device to connect.`,
    );
    if (this.basicMode()) requestAnimationFrame(() => this.fitIfNarrow());
  }

  private freeCopper(d: DeviceState) {
    const used = new Set<string>();
    for (const l of this.api.state()?.links ?? []) {
      if (l.a.deviceId === d.id) used.add(l.a.iface);
      if (l.b.deviceId === d.id) used.add(l.b.iface);
    }
    return (
      d.ifaces.find(
        (i) =>
          !used.has(i.name) &&
          !i.isRadio &&
          !i.name.includes('.') &&
          !i.name.toLowerCase().startsWith('vlan'),
      ) ?? null
    );
  }

  startCable(ev: Event, d: DeviceState) {
    ev.stopPropagation();
    ev.preventDefault();
    const from = this.cableFrom();
    if (from && from.id !== d.id) {
      this.finishCable(d);
      return;
    }
    const iface = this.freeCopper(d);
    if (!iface) {
      this.showHint(`${d.name} has no free Ethernet port.`);
      return;
    }
    this.cableFrom.set({ id: d.id, iface: iface.name });
    this.basicSheet.set(false);
    this.showHint(`Cable started on ${d.name}. Tap another device to connect.`);
  }

  private finishCable(d: DeviceState) {
    const from = this.cableFrom();
    if (!from || from.id === d.id) return;
    const iface = this.freeCopper(d);
    if (!iface) {
      this.showHint(`${d.name} has no free Ethernet port.`);
      return;
    }
    const a = `${this.devName(from.id)}:${from.iface}`;
    const b = `${d.name}:${iface.name}`;
    void this.api.edit({ addLinks: [{ a, b }] });
    this.cableFrom.set(null);
    this.showHint(`Cabled ${this.devName(from.id)} ↔ ${d.name}.`);
  }

  showHint(msg: string) {
    this.hint.set(msg);
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hint.set(null), 5000);
  }

  toggleEve() {
    if (this.isNarrow()) {
      this.setTab(this.mobileTab() === 'eve' ? 'canvas' : 'eve');
    } else {
      this.eveOpen.set(!this.eveOpen());
    }
  }

  showPalette() {
    if (this.basicMode()) return false;
    return !this.isNarrow() || this.mobileTab() === 'palette';
  }
  showCanvas() {
    if (this.basicMode()) return true;
    return !this.isNarrow() || this.mobileTab() === 'canvas';
  }
  showInspect() {
    if (this.basicMode()) return false;
    return !this.isNarrow() || this.mobileTab() === 'inspect';
  }
  showEve() {
    if (this.basicMode()) return false;
    return this.isNarrow() ? this.mobileTab() === 'eve' : this.eveOpen();
  }
  showTerm() {
    if (this.basicMode()) return false;
    return !this.isNarrow() || this.mobileTab() === 'term';
  }

  private bindEve() {
    const sid = this.api.sessionId();
    if (!sid) return;
    this.eve.bind({
      nestSessionId: sid,
      userId: this.api.userId(),
      context: () => this.eveContext(),
    });
    this.eve.onLabMutated = () => {
      void this.api.refresh();
    };
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
      'Use labId=labSessionId on every tool. Eight devices only. OSPF area 0. No BGP/MPLS/VXLAN/802.1X.',
    ].join('\n');
  }

  private onKey = (ev: KeyboardEvent) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'c' && (ev.target as HTMLElement).closest('input,textarea')) {
      this.termLines.update((l) => [...l, { text: '^C' }]);
      this.api.cancelPing();
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') {
      ev.preventDefault();
      this.saveJson();
      void this.api.save();
    }
    if (ev.key === 'Delete' && this.selected() && !(ev.target as HTMLElement).closest('input,textarea')) {
      this.confirmDel.set(this.selected());
    }
    if (ev.key === 'Escape') {
      this.cableFrom.set(null);
      this.placing.set(null);
      this.confirmDel.set(null);
      this.addOpen.set(false);
      this.basicSheet.set(false);
    }
  };

  async loadLab(id: string) {
    await this.api.open(id);
    const first = this.api.state()?.devices[0];
    this.selectedId.set(first?.id ?? null);
    this.termDevice.set(first?.id ?? null);
    this.termLines.set([{ text: `Loaded ${this.api.state()?.name}. Type help.` }]);
    this.checkMsg.set(null);
    this.bindEve();
    requestAnimationFrame(() => this.fitIfNarrow());
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
      const gx = Math.round(w.x / 24) * 24;
      const gy = Math.round(w.y / 24) * 24;
      const kind = this.placing()!;
      const name = this.nameFor(kind);
      void this.api.edit({ addDevices: [{ type: kind, name, x: gx, y: gy }] });
      this.placing.set(null);
      this.pointers.delete(ev.pointerId);
      return;
    }
    if (this.pointers.size >= 2) {
      this.dragging = null;
      this.panning = null;
      this.startPinch();
      return;
    }
    this.panning = { x: this.pan().x, y: this.pan().y, px: ev.clientX, py: ev.clientY };
  }

  canvasMove(ev: PointerEvent) {
    if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.pinch && this.pointers.size >= 2) {
      ev.preventDefault();
      this.movePinch();
      return;
    }
    if (this.panning || this.dragging) ev.preventDefault();
    if (this.panning) {
      this.pan.set({
        ...this.pan(),
        x: this.panning.x + (ev.clientX - this.panning.px),
        y: this.panning.y + (ev.clientY - this.panning.py),
      });
    }
    if (this.dragging) {
      const st = this.api.state();
      if (!st) return;
      const d = st.devices.find((x) => x.id === this.dragging!.id);
      if (!d) return;
      d.x = Math.round((this.dragging.ox + ev.clientX) / 24) * 24;
      d.y = Math.round((this.dragging.oy + ev.clientY) / 24) * 24;
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
    if (this.dragging) {
      const d = this.api.state()?.devices.find((x) => x.id === this.dragging!.id);
      if (d) {
        void this.api.edit(undefined, [{ id: d.id, x: d.x, y: d.y }]);
        if (this.isNarrow() && this.tapAt && Math.hypot(d.x - this.tapAt.x, d.y - this.tapAt.y) < 12) {
          if (this.basicMode()) this.basicSheet.set(true);
          else this.mobileTab.set('inspect');
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
    if (from && from.id !== d.id && (this.basicMode() || !this.advanced())) {
      this.finishCable(d);
      this.basicSheet.set(false);
      return;
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
    this.selectedId.set(d.id);
    this.termDevice.set(d.id);
    this.tapAt = { x: d.x, y: d.y };
    this.dragging = { id: d.id, ox: d.x - ev.clientX, oy: d.y - ev.clientY };
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
      maxX = Math.max(maxX, d.x + 96);
      maxY = Math.max(maxY, d.y + 64);
    }
    const pad = 32;
    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    const s = Math.min(2.4, Math.max(0.35, Math.min((r.width - pad * 2) / bw, (r.height - pad * 2) / bh)));
    this.pan.set({
      x: (r.width - bw * s) / 2 - minX * s,
      y: (r.height - bh * s) / 2 - minY * s,
      s,
    });
  }

  clickPort(ev: Event, d: DeviceState, iface: string) {
    ev.stopPropagation();
    const from = this.cableFrom();
    if (!from) {
      this.cableFrom.set({ id: d.id, iface });
      this.showHint(`Cable started on ${d.name} ${iface}. Tap a port on another device.`);
      return;
    }
    if (from.id === d.id) {
      this.cableFrom.set({ id: d.id, iface });
      return;
    }
    const a = `${this.devName(from.id)}:${from.iface}`;
    const b = `${d.name}:${iface}`;
    void this.api.edit({ addLinks: [{ a, b }] });
    this.cableFrom.set(null);
    this.showHint(`Cabled ${this.devName(from.id)} ↔ ${d.name}.`);
  }

  devName(id: string) {
    return this.api.state()?.devices.find((d) => d.id === id)?.name ?? id;
  }

  async doDelete() {
    const d = this.confirmDel();
    if (!d) return;
    await this.api.edit({ removeDeviceIds: [d.id] });
    this.confirmDel.set(null);
    this.selectedId.set(null);
  }

  async runLine() {
    const id = this.termDevice();
    const line = this.termInput;
    if (!id || !line.trim()) return;
    this.termLines.update((l) => [...l, { text: `${this.prompt()} ${line}` }]);
    this.termInput = '';
    try {
      const r = await this.api.cli(id, line);
      if (r.output) this.termLines.update((l) => [...l, { text: r.output, err: r.error }]);
      this.animate(r.events ?? []);
    } catch (e) {
      this.termLines.update((l) => [...l, { text: String(e), err: true }]);
    }
  }

  prompt() {
    const d = this.api.state()?.devices.find((x) => x.id === this.termDevice());
    if (!d) return '#';
    if (d.kind === 'workstation' || d.kind === 'server' || d.kind === 'firewall' || d.kind === 'cloud') return `root@${d.hostname}:~#`;
    return `${d.hostname}#`;
  }

  animate(events: PacketEvent[]) {
    if (this.basicMode()) return;
    const st = this.api.state();
    if (!st) return;
    const pos = (name: string) => {
      const d = st.devices.find((x) => x.name === name || x.id === name);
      return d ? { x: d.x + 48, y: d.y + 28 } : { x: 0, y: 0 };
    };
    const frames = events
      .filter((e) => e.to)
      .map((e) => {
        const a = pos(e.from.device);
        const b = pos(e.to!.device);
        return { id: e.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, drop: e.drop };
      });
    this.animPkts.set(frames);
    setTimeout(() => this.animPkts.set([]), 1600);
    if (events.length) this.selectedPkt.set(events[events.length - 1]);
  }

  async doCheck() {
    try {
      const r = await this.api.check();
      this.checkMsg.set(r.ok ? 'Check passed.' : r.results.filter((x) => !x.ok).map((x) => x.reason).join('\n'));
    } catch (e) {
      this.checkMsg.set(String(e));
    }
  }

  saveJson() {
    const st = this.api.state();
    if (!st) return;
    const blob = new Blob([JSON.stringify(st, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${st.id}.json`;
    a.click();
  }

  async importJson(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const lab = JSON.parse(await f.text());
    await this.api.open(undefined, lab);
  }

  async openCheat() {
    const kind = this.selected()?.kind ?? 'workstation';
    const r = await this.api.commands(kind);
    this.cheat.set(r.commands.map((c) => `${c.cmd}\n  ${c.help}`).join('\n\n'));
    this.showCheat.set(true);
  }

  async explain() {
    const sel = this.selected();
    const pkt = this.selectedPkt();
    if (sel) await this.api.highlight([sel.id]).catch(() => undefined);
    await this.eve.send(pkt ? 'Explain this packet using get_path and get_lab_state. Cite devices and interfaces.' : `Explain ${sel?.name ?? 'the lab'} using get_lab_state and get_device. Cite running-config.`);
  }

  async fixLab() {
    await this.eve.send('Fix my lab. Call run_check and get_lab_state first. Apply the smallest junior-admin change with apply_device_config or apply_lab_patch.');
  }

  async buildFromPrompt() {
    const spec = this.buildPrompt.trim();
    if (!spec) return;
    await this.eve.send(`Build this lab with build_lab. Spec: ${spec}`);
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
      this.eve.msgs.update((m) => [...m, { role: 'eve', text: String(e) }]);
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

  async sendEve() {
    const t = this.eveInput.trim();
    if (!t) return;
    this.eveInput = '';
    if (/^build\b/i.test(t)) this.buildPrompt = t;
    await this.eve.send(t);
  }

  answerEve(optionId: string) {
    const h = this.eve.hitl();
    if (!h) return;
    void this.eve.respond(optionId, h.requestId);
  }

  async doLogin() {
    try {
      await this.api.login(this.email, this.password);
      this.authOpen.set(false);
    } catch {
      await this.api.register(this.email, this.password);
      this.authOpen.set(false);
    }
  }

  kindColor(k: string) {
    const m: Record<string, string> = {
      workstation: 'bg-sky-900/80 border-sky-500/50',
      server: 'bg-indigo-900/80 border-indigo-400/50',
      switch: 'bg-emerald-950/80 border-emerald-500/50',
      router: 'bg-amber-950/80 border-amber-500/50',
      firewall: 'bg-rose-950/80 border-rose-500/50',
      ap: 'bg-violet-950/80 border-violet-400/50',
      wlc: 'bg-fuchsia-950/80 border-fuchsia-400/50',
      cloud: 'bg-slate-800 border-cyan-400/40',
    };
    return m[k] ?? 'bg-zinc-800 border-zinc-600';
  }

  linkPath(l: { a: { deviceId: string }; b: { deviceId: string } }) {
    const st = this.api.state();
    const a = st?.devices.find((d) => d.id === l.a.deviceId);
    const b = st?.devices.find((d) => d.id === l.b.deviceId);
    if (!a || !b) return '';
    return `M ${a.x + 48} ${a.y + 28} L ${b.x + 48} ${b.y + 28}`;
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
    } else if (was) this.eveOpen.set(true);
  }
}
