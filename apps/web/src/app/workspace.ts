import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import { Api, PALETTE, type DeviceState, type PacketEvent } from './api';

@Component({
  selector: 'app-workspace',
  imports: [FormsModule, NgClass],
  templateUrl: './workspace.html',
})
export class Workspace implements OnInit {
  readonly api = inject(Api);
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
  eveOpen = signal(true);
  eveMsgs = signal<{ role: 'user' | 'eve'; text: string }[]>([]);
  eveInput = '';
  buildPrompt = '';
  pending = signal<{ title: string; patch?: unknown; deviceId?: string; commands?: string[] } | null>(null);
  authOpen = signal(false);
  email = '';
  password = '';
  animPkts = signal<{ id: string; x1: number; y1: number; x2: number; y2: number; drop?: boolean }[]>([]);

  selected = computed(() => this.api.state()?.devices.find((d) => d.id === this.selectedId()) ?? null);

  async ngOnInit() {
    const b = await this.api.builtins();
    this.labs.set(b.labs);
    await this.api.open('lab-1-first-ipv4-ping');
    const first = this.api.state()?.devices[0];
    if (first) {
      this.selectedId.set(first.id);
      this.termDevice.set(first.id);
      this.termLines.set([{ text: `Connected to ${first.hostname}. Type help.` }]);
    }
    window.addEventListener('keydown', this.onKey);
    setInterval(() => {
      const st = this.api.state();
      if (!st) return;
      localStorage.setItem('nb_autosave', JSON.stringify({ id: st.id, sessionId: this.api.sessionId(), at: Date.now() }));
      void this.api.save().catch(() => undefined);
    }, 12000);
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
  }

  worldFromEvent(ev: MouseEvent, el: HTMLElement) {
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

  canvasDown(ev: MouseEvent, el: HTMLElement) {
    if ((ev.target as HTMLElement).closest('[data-dev]')) return;
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

  canvasMove(ev: MouseEvent) {
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
      if (d) void this.api.edit(undefined, [{ id: d.id, x: d.x, y: d.y }]);
    }
    this.panning = null;
    this.dragging = null;
  }

  startDrag(ev: MouseEvent, d: DeviceState) {
    ev.stopPropagation();
    this.selectedId.set(d.id);
    this.termDevice.set(d.id);
    this.dragging = { id: d.id, ox: d.x - ev.clientX, oy: d.y - ev.clientY };
  }

  clickPort(ev: MouseEvent, d: DeviceState, iface: string) {
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
    const sid = this.api.sessionId();
    this.eveMsgs.update((m) => [...m, { role: 'user', text: pkt ? `Explain this packet` : `Explain ${sel?.name ?? 'the lab'}` }]);
    try {
      const state = await this.api.eveTool('get_lab_state', { labId: sid });
      let extra = '';
      if (sel) extra = JSON.stringify(await this.api.eveTool('get_device', { labId: sid, deviceId: sel.id }));
      if (pkt) extra += `\npacket: ${pkt.reason}`;
      const chk = (state as { lastCheck?: { results?: { reason: string; ok: boolean }[] } }).lastCheck;
      const verdict = chk?.results?.find((r) => !r.ok)?.reason ?? 'No failing check. Inspect interfaces and the last packet reason.';
      const text = `${verdict}\n\nPath/config cite: ${sel ? sel.name + ' ' + (sel.ifaces.map((i) => i.name + (i.ipv4 ? '=' + i.ipv4.ip : '')).join(', ')) : 'canvas'}${pkt ? `\nPacket: ${pkt.proto} ${pkt.srcIp ?? ''} → ${pkt.dstIp ?? ''} ttl ${pkt.ttl ?? '—'} ${pkt.simulated ? '[simulated]' : ''}\n${pkt.reason}` : ''}\n\nNext command: help`;
      this.eveMsgs.update((m) => [...m, { role: 'eve', text: extra ? text : text }]);
      if (sel) await this.api.highlight([sel.id]);
    } catch (e) {
      this.eveMsgs.update((m) => [...m, { role: 'eve', text: String(e) }]);
    }
  }

  async fixLab() {
    const sid = this.api.sessionId();
    this.eveMsgs.update((m) => [...m, { role: 'user', text: 'Fix my lab' }]);
    const chk = await this.api.eveTool('run_check', { labId: sid }) as { ok: boolean; results: { reason: string; ok: boolean }[] };
    if (chk.ok) {
      this.eveMsgs.update((m) => [...m, { role: 'eve', text: 'Check already passes. No patch.' }]);
      return;
    }
    const reason = chk.results.filter((r) => !r.ok).map((r) => r.reason).join('; ');
    this.eveMsgs.update((m) => [
      ...m,
      { role: 'eve', text: `Failure: ${reason}\nI will not guess — use get_lab_state/run_check. Typical junior fixes: no shutdown, trunk vs access, gateway, OSPF network, nmcli wifi connect, ACL direction.` },
    ]);
    if (/down/i.test(reason)) {
      this.pending.set({ title: 'Apply no shutdown on the down interface', commands: ['enable', 'conf t', 'int Gi0/2', 'no shutdown'], deviceId: 'sw1' });
    }
  }

  async buildFromPrompt() {
    const spec = this.buildPrompt.trim();
    if (!spec) return;
    this.eveMsgs.update((m) => [...m, { role: 'user', text: `Build: ${spec}` }]);
    if (/bgp|mpls|vxlan|802\.1x/i.test(spec)) {
      this.eveMsgs.update((m) => [...m, { role: 'eve', text: 'NetBench does not implement BGP/MPLS/VXLAN/802.1X. Use OSPF area 0 and the eight device types instead.' }]);
      return;
    }
    this.pending.set({ title: 'Replace canvas with dual-stack office lab', patch: { __build: spec } });
    this.eveMsgs.update((m) => [...m, { role: 'eve', text: 'Prepared a dual-stack office (SW, R, AP, server, 2 PCs). Confirm to replace the canvas.' }]);
  }

  async applyPending() {
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
      this.eveMsgs.update((m) => [...m, { role: 'eve', text: 'Applied. Re-running check…' }]);
      await this.doCheck();
    } catch (e) {
      this.eveMsgs.update((m) => [...m, { role: 'eve', text: String(e) }]);
    }
    this.pending.set(null);
  }

  discardPending() {
    this.pending.set(null);
    this.eveMsgs.update((m) => [...m, { role: 'eve', text: 'Discarded pending change.' }]);
  }

  async sendEve() {
    const t = this.eveInput.trim();
    if (!t) return;
    this.eveInput = '';
    this.eveMsgs.update((m) => [...m, { role: 'user', text: t }]);
    if (/bgp|mpls|vxlan/i.test(t)) {
      this.eveMsgs.update((m) => [...m, { role: 'eve', text: 'I only know this product. BGP/MPLS/VXLAN are out of scope — use OSPF area 0.' }]);
      return;
    }
    if (/fix/i.test(t)) return this.fixLab();
    if (/build/i.test(t)) {
      this.buildPrompt = t;
      return this.buildFromPrompt();
    }
    return this.explain();
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
}
