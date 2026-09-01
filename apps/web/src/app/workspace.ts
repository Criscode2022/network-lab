import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import { Api, PALETTE, type DeviceState, type PacketEvent } from './api';
import { EveClient } from './eve-client';

@Component({
  selector: 'app-workspace',
  imports: [FormsModule, NgClass],
  templateUrl: './workspace.html',
})
export class Workspace implements OnInit, OnDestroy {
  readonly api = inject(Api);
  readonly eve = inject(EveClient);
  readonly PALETTE = PALETTE;
  labs = signal<{ id: string; name: string; goal: string }[]>([]);
  selectedId = signal<string | null>(null);
  termDevice = signal<string | null>(null);
  termLines = signal<{ text: string; err?: boolean }[]>([]);
  termInput = '';
  pan = signal({ x: 40, y: 40, s: 1 });
  dragging: { id: string; ox: number; oy: number } | null = null;
  panning: { x: number; y: number; px: number; py: number } | null = null;
  cableFrom: { id: string; iface: string } | null = null;
  placing = signal<string | null>(null);
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
    window.addEventListener('keydown', this.onKey);
    this.saveTimer = setInterval(() => {
      const st = this.api.state();
      if (!st) return;
      localStorage.setItem('nb_autosave', JSON.stringify({ id: st.id, sessionId: this.api.sessionId(), at: Date.now() }));
      void this.api.save().catch(() => undefined);
    }, 12000);
  }

  ngOnDestroy() {
    window.removeEventListener('keydown', this.onKey);
    this.mq?.removeEventListener('change', this.onMq);
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.api.disconnectWs();
    this.eve.stop();
  }

  private onMq = (e: MediaQueryList | MediaQueryListEvent) => {
    const narrow = e.matches;
    const was = this.isNarrow();
    this.isNarrow.set(narrow);
    if (narrow) this.eveOpen.set(false);
    else if (was) this.eveOpen.set(true);
  };

  setTab(tab: 'canvas' | 'palette' | 'inspect' | 'term' | 'eve') {
    this.mobileTab.set(tab);
    this.moreOpen.set(false);
    if (tab === 'eve') this.eveOpen.set(true);
  }

  place(kind: string) {
    this.placing.set(this.placing() === kind ? null : kind);
    if (this.isNarrow()) this.mobileTab.set('canvas');
  }

  toggleEve() {
    if (this.isNarrow()) {
      this.setTab(this.mobileTab() === 'eve' ? 'canvas' : 'eve');
    } else {
      this.eveOpen.set(!this.eveOpen());
    }
  }

  showPalette() {
    return !this.isNarrow() || this.mobileTab() === 'palette';
  }
  showCanvas() {
    return !this.isNarrow() || this.mobileTab() === 'canvas';
  }
  showInspect() {
    return !this.isNarrow() || this.mobileTab() === 'inspect';
  }
  showEve() {
    return this.isNarrow() ? this.mobileTab() === 'eve' : this.eveOpen();
  }
  showTerm() {
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
      this.cableFrom = null;
      this.placing.set(null);
      this.confirmDel.set(null);
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
  }

  worldFromEvent(ev: { clientX: number; clientY: number }, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const p = this.pan();
    return { x: (ev.clientX - r.left - p.x) / p.s, y: (ev.clientY - r.top - p.y) / p.s };
  }

  onWheel(ev: WheelEvent, el: HTMLElement) {
    ev.preventDefault();
    const p = this.pan();
    const factor = ev.deltaY > 0 ? 0.9 : 1.1;
    const s = Math.min(2.4, Math.max(0.35, p.s * factor));
    const r = el.getBoundingClientRect();
    const cx = ev.clientX - r.left;
    const cy = ev.clientY - r.top;
    const x = cx - ((cx - p.x) * s) / p.s;
    const y = cy - ((cy - p.y) * s) / p.s;
    this.pan.set({ x, y, s });
  }

  canvasDown(ev: PointerEvent, el: HTMLElement) {
    if ((ev.target as HTMLElement).closest('[data-dev]')) return;
    el.setPointerCapture?.(ev.pointerId);
    if (this.placing()) {
      const w = this.worldFromEvent(ev, el);
      const gx = Math.round(w.x / 24) * 24;
      const gy = Math.round(w.y / 24) * 24;
      const kind = this.placing()!;
      const name = kind.slice(0, 2).toUpperCase() + Math.floor(Math.random() * 90 + 10);
      void this.api.edit({ addDevices: [{ type: kind, name, x: gx, y: gy }] });
      this.placing.set(null);
      return;
    }
    this.panning = { x: this.pan().x, y: this.pan().y, px: ev.clientX, py: ev.clientY };
  }

  canvasMove(ev: PointerEvent) {
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

  canvasUp() {
    if (this.dragging) {
      const d = this.api.state()?.devices.find((x) => x.id === this.dragging!.id);
      if (d) {
        void this.api.edit(undefined, [{ id: d.id, x: d.x, y: d.y }]);
        if (this.isNarrow() && this.tapAt && Math.hypot(d.x - this.tapAt.x, d.y - this.tapAt.y) < 12) {
          this.mobileTab.set('inspect');
        }
      }
    }
    this.panning = null;
    this.dragging = null;
    this.tapAt = null;
  }

  startDrag(ev: PointerEvent, d: DeviceState) {
    ev.stopPropagation();
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    this.selectedId.set(d.id);
    this.termDevice.set(d.id);
    this.tapAt = { x: d.x, y: d.y };
    this.dragging = { id: d.id, ox: d.x - ev.clientX, oy: d.y - ev.clientY };
  }

  clickPort(ev: Event, d: DeviceState, iface: string) {
    ev.stopPropagation();
    if (!this.cableFrom) {
      this.cableFrom = { id: d.id, iface };
      return;
    }
    if (this.cableFrom.id === d.id) {
      this.cableFrom = { id: d.id, iface };
      return;
    }
    const a = `${this.devName(this.cableFrom.id)}:${this.cableFrom.iface}`;
    const b = `${d.name}:${iface}`;
    void this.api.edit({ addLinks: [{ a, b }] });
    this.cableFrom = null;
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
    this.canvasUp();
  }

  @HostListener('window:resize')
  onResize() {
    const narrow = window.innerWidth < 768;
    const was = this.isNarrow();
    this.isNarrow.set(narrow);
    if (narrow) this.eveOpen.set(false);
    else if (was) this.eveOpen.set(true);
  }
}
