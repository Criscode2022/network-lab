import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, output, signal, viewChild } from '@angular/core';
import { NgClass } from '@angular/common';
import type { DeviceState } from './api';
import { Icon, KIND_ICON } from './icons';

export interface TermLine {
  text: string;
  /** Command echo (prompt + line). */
  cmd?: boolean;
  err?: boolean;
  /** UI notice, not device output. */
  sys?: boolean;
}

export type QuickCategoryId = 'common' | 'inspect' | 'network' | 'specific';

export interface QuickCommand {
  label: string;
  cmd: string;
  category: QuickCategoryId;
}

export const QUICK_CATEGORY_LABEL: Record<QuickCategoryId, string> = {
  common: 'Common',
  inspect: 'Inspect',
  network: 'Network',
  specific: 'Specific',
};

const QUICK_CATEGORY_TONE: Record<QuickCategoryId, string> = {
  common: 'text-ink-400',
  inspect: 'text-brand-400/80',
  network: 'text-ok-400/80',
  specific: 'text-eve-300/80',
};

const QUICK_CATEGORY_ORDER: QuickCategoryId[] = ['common', 'inspect', 'network', 'specific'];

const Q = (category: QuickCategoryId, label: string, cmd: string): QuickCommand => ({ category, label, cmd });

const LINUX_COMMON = [Q('common', 'help', 'help'), Q('common', 'hostname', 'hostname')];
const LINUX_INSPECT = [
  Q('inspect', 'ip addr', 'ip addr'),
  Q('inspect', 'ip link', 'ip link'),
  Q('inspect', 'ip route', 'ip route'),
  Q('inspect', 'tcpdump', 'tcpdump -c 10'),
];
const CISCO_COMMON = [
  Q('common', 'help', 'help'),
  Q('common', 'enable', 'enable'),
  Q('common', 'conf t', 'conf t'),
  Q('common', 'write', 'write'),
];

const QUICK_BY_KIND: Record<string, QuickCommand[]> = {
  workstation: [
    ...LINUX_COMMON,
    ...LINUX_INSPECT,
    Q('network', 'dhclient', 'dhclient'),
    Q('network', 'resolvectl', 'resolvectl'),
    Q('specific', 'wifi link', 'iw dev wlan0 link'),
    Q('specific', 'ss', 'ss'),
    Q('specific', 'hosts', 'cat /etc/hosts'),
  ],
  server: [
    ...LINUX_COMMON,
    ...LINUX_INSPECT,
    Q('network', 'dhclient', 'dhclient'),
    Q('specific', 'ss', 'ss'),
    Q('specific', 'start ssh', 'systemctl start ssh'),
    Q('specific', 'hosts', 'cat /etc/hosts'),
  ],
  router: [
    ...CISCO_COMMON,
    Q('inspect', 'show run', 'show run'),
    Q('inspect', 'show int', 'show int'),
    Q('network', 'show ip route', 'show ip route'),
    Q('network', 'show ipv6 route', 'show ipv6 route'),
    Q('specific', 'ospf neigh', 'show ip ospf neighbor'),
    Q('specific', 'ospf db', 'show ip ospf database'),
  ],
  firewall: [
    ...LINUX_COMMON,
    Q('inspect', 'ip addr', 'ip addr'),
    Q('inspect', 'ip route', 'ip route'),
    Q('inspect', 'show rules', 'show rules'),
    Q('specific', 'show run', 'show run'),
  ],
  ap: [
    Q('common', 'help', 'help'),
    Q('common', 'enable', 'enable'),
    Q('inspect', 'show run', 'show run'),
    Q('inspect', 'show ssid', 'show ssid'),
    Q('inspect', 'show int', 'show interface'),
    Q('specific', 'no shut', 'no shutdown'),
  ],
  wlc: [
    Q('common', 'help', 'help'),
    Q('common', 'enable', 'enable'),
    Q('inspect', 'show run', 'show run'),
    Q('specific', 'show ap', 'show ap summary'),
    Q('specific', 'show wlan', 'show wlan'),
  ],
  cloud: [
    ...LINUX_COMMON,
    Q('inspect', 'ip addr', 'ip addr'),
    Q('inspect', 'ip route', 'ip route'),
    Q('inspect', 'show run', 'show run'),
  ],
};

const QUICK_SWITCH: Record<string, QuickCommand[]> = {
  'managed-l2': [
    ...CISCO_COMMON,
    Q('inspect', 'show run', 'show run'),
    Q('inspect', 'show int', 'show int'),
    Q('inspect', 'show vlan', 'show vlan'),
    Q('inspect', 'show mac', 'show mac'),
    Q('specific', 'show trunk', 'show trunk'),
  ],
  multilayer: [
    ...CISCO_COMMON,
    Q('inspect', 'show run', 'show run'),
    Q('inspect', 'show int', 'show int'),
    Q('inspect', 'show vlan', 'show vlan'),
    Q('inspect', 'show mac', 'show mac'),
    Q('network', 'show ip route', 'show ip route'),
    Q('network', 'show ipv6 route', 'show ipv6 route'),
    Q('specific', 'dhcp bind', 'show ip dhcp binding'),
    Q('specific', 'show trunk', 'show trunk'),
  ],
};

function neighborIpv4(device: DeviceState, all: DeviceState[]): string | undefined {
  for (const iface of device.ifaces) {
    const peer = all.find((x) => x.id === iface.peer?.deviceId || x.name === iface.peer?.device);
    const ip = peer?.ifaces.find((p) => p.ipv4?.ip)?.ipv4?.ip;
    if (ip) return ip;
  }
  return undefined;
}

function canIcmp(device: DeviceState): boolean {
  if (device.kind === 'ap' || device.kind === 'wlc') return false;
  if (device.kind === 'switch') {
    return device.switchProfile === 'multilayer' || device.ifaces.some((i) => !!i.ipv4);
  }
  return true;
}

/** One-tap commands for the selected device. Every `cmd` is a real CLI line the engine understands. */
export function quickCommandsFor(device: DeviceState, all: DeviceState[] = []): QuickCommand[] {
  if (device.kind === 'switch') {
    const profile = device.switchProfile ?? 'managed-l2';
    if (profile === 'unmanaged') return [];
    return withContext(device, all, QUICK_SWITCH[profile] ?? QUICK_SWITCH['managed-l2']);
  }
  return withContext(device, all, QUICK_BY_KIND[device.kind] ?? []);
}

function withContext(device: DeviceState, all: DeviceState[], base: QuickCommand[]): QuickCommand[] {
  const extra: QuickCommand[] = [];
  const target = canIcmp(device) ? neighborIpv4(device, all) : undefined;
  if (target && !base.some((q) => q.cmd === `ping ${target}`)) {
    extra.push(Q('network', `ping ${target}`, `ping ${target}`));
  }
  if (device.kind === 'workstation' || device.kind === 'server' || device.kind === 'firewall') {
    for (const iface of device.ifaces) {
      if (iface.adminUp || extra.length > 2) continue;
      extra.push(Q('network', `up ${iface.name}`, `ip link set ${iface.name} up`));
    }
  }
  return extra.length ? [...base, ...extra] : base;
}

@Component({
  selector: 'nb-terminal',
  imports: [NgClass, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col bg-ink-950' },
  template: `
    <div class="flex shrink-0 items-center gap-1 border-b border-ink-800 px-1.5 py-1">
      <div class="scroll-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        @for (d of devices(); track d.id) {
          <button
            type="button"
            class="inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors"
            [ngClass]="d.id === deviceId() ? 'bg-ink-750 text-ink-50 shadow-sm' : 'text-ink-400 hover:bg-ink-850 hover:text-ink-200'"
            [attr.aria-pressed]="d.id === deviceId()"
            (click)="deviceChange.emit(d.id)"
          >
            <nb-icon [name]="kindIcon(d.kind)" [size]="12" />
            <span class="font-mono">{{ d.name }}</span>
          </button>
        }
      </div>
      <div class="flex shrink-0 items-center gap-0.5">
        <button type="button" class="btn btn-ghost btn-icon h-7 w-7" title="Clear output (Ctrl+L)" aria-label="Clear terminal" (click)="clear.emit()">
          <nb-icon name="eraser" [size]="13" />
        </button>
        <button type="button" class="btn btn-ghost btn-icon h-7 w-7" title="Cancel running ping (Ctrl+C)" aria-label="Cancel" (click)="cancel.emit()">
          <nb-icon name="x" [size]="13" />
        </button>
      </div>
    </div>

    <div #out class="term scroll-thin min-h-0 flex-1 overflow-auto px-3 py-2 text-[11.5px] leading-[1.55]" (click)="focus()">
      @if (!lines().length) {
        <div class="text-ink-500">Type <span class="text-ink-200">help</span> or tap a quick command. ↑/↓ recalls history, Tab completes.</div>
      }
      @for (line of lines(); track $index) {
        <pre
          class="whitespace-pre-wrap break-words"
          [ngClass]="line.err ? 'text-danger-300' : line.cmd ? 'text-brand-200' : line.sys ? 'text-ink-500 italic' : 'text-ok-300/90'"
        >{{ line.text }}</pre>
      }
      @if (busy()) {
        <div class="mt-1 flex items-center gap-2 text-ink-500"><span class="spinner"></span> running…</div>
      }
    </div>

    @if (quickGroups().length) {
      <div class="scroll-thin flex max-h-[4.25rem] shrink-0 flex-wrap content-start items-center gap-x-3 gap-y-1 overflow-y-auto border-t border-ink-800/80 px-2 py-1">
        @for (g of quickGroups(); track g.id) {
          <div class="flex min-w-0 items-center gap-1">
            <span class="shrink-0 text-[9px] font-semibold uppercase tracking-[0.14em]" [ngClass]="g.tone">{{ g.label }}</span>
            @for (q of g.items; track q.cmd) {
              <button
                type="button"
                class="shrink-0 rounded-md border border-ink-700 bg-ink-900 px-2 py-0.5 font-mono text-[10.5px] text-ink-200 transition-colors hover:border-brand-500/50 hover:text-brand-200"
                [title]="q.cmd"
                [disabled]="busy()"
                (click)="run.emit(q.cmd)"
              >
                {{ q.label }}
              </button>
            }
          </div>
        }
      </div>
    }

    <form class="flex shrink-0 items-center gap-2 border-t border-ink-800 bg-ink-900/60 px-3" (submit)="$event.preventDefault(); submit()">
      <span class="term max-w-[45%] shrink-0 truncate text-[11.5px] text-ok-400">{{ prompt() }}</span>
      <input
        #inp
        class="term min-h-9 min-w-0 flex-1 bg-transparent text-[11.5px] text-ink-50 outline-none placeholder:text-ink-600"
        [value]="text()"
        (input)="text.set($any($event.target).value)"
        name="cli"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        [placeholder]="deviceId() ? 'command…' : 'select a device'"
        [disabled]="!deviceId()"
        (keydown)="onKey($event)"
      />
      <button type="submit" class="btn btn-ghost btn-icon h-7 w-7 text-ink-400" aria-label="Run" title="Run (Enter)">
        <nb-icon name="arrow-right" [size]="14" />
      </button>
    </form>
  `,
})
export class Terminal {
  devices = input<DeviceState[]>([]);
  deviceId = input<string | null>(null);
  lines = input<TermLine[]>([]);
  prompt = input('#');
  busy = input(false);
  /** Words offered for Tab completion (from the cheat sheet of the current device kind). */
  vocab = input<string[]>([]);
  quick = input<QuickCommand[]>([]);
  quickGroups = computed(() => {
    const items = this.quick();
    return QUICK_CATEGORY_ORDER.map((id) => ({
      id,
      label: QUICK_CATEGORY_LABEL[id],
      tone: QUICK_CATEGORY_TONE[id],
      items: items.filter((q) => q.category === id),
    })).filter((g) => g.items.length);
  });

  deviceChange = output<string>();
  run = output<string>();
  clear = output<void>();
  cancel = output<void>();

  text = signal('');
  private history: string[] = [];
  private hIdx = -1;
  private draft = '';
  private out = viewChild<ElementRef<HTMLElement>>('out');
  private inp = viewChild<ElementRef<HTMLInputElement>>('inp');

  constructor() {
    effect(() => {
      this.lines();
      requestAnimationFrame(() => {
        const el = this.out()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
  }

  kindIcon(kind: string) {
    return KIND_ICON[kind] ?? 'pc';
  }

  focus() {
    this.inp()?.nativeElement.focus();
  }

  setText(t: string) {
    this.text.set(t);
    this.focus();
  }

  submit() {
    const line = this.text().trim();
    if (!line) return;
    if (this.history[this.history.length - 1] !== line) this.history.push(line);
    if (this.history.length > 200) this.history.shift();
    this.hIdx = -1;
    this.text.set('');
    this.run.emit(line);
  }

  onKey(ev: KeyboardEvent) {
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!this.history.length) return;
      if (this.hIdx === -1) {
        this.draft = this.text();
        this.hIdx = this.history.length - 1;
      } else if (this.hIdx > 0) this.hIdx--;
      this.text.set(this.history[this.hIdx]);
      return;
    }
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (this.hIdx === -1) return;
      if (this.hIdx < this.history.length - 1) {
        this.hIdx++;
        this.text.set(this.history[this.hIdx]);
      } else {
        this.hIdx = -1;
        this.text.set(this.draft);
      }
      return;
    }
    if (ev.key === 'Tab') {
      ev.preventDefault();
      this.complete();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'l') {
      ev.preventDefault();
      this.clear.emit();
    }
  }

  private complete() {
    const cur = this.text();
    const m = cur.match(/(\S+)$/);
    if (!m) return;
    const partial = m[1].toLowerCase();
    const hits = [...new Set(this.vocab())].filter((w) => w.toLowerCase().startsWith(partial) && w.toLowerCase() !== partial);
    if (!hits.length) return;
    if (hits.length === 1) {
      this.text.set(cur.slice(0, -m[1].length) + hits[0] + ' ');
      return;
    }
    const common = hits.reduce((acc, w) => {
      let i = 0;
      while (i < acc.length && i < w.length && acc[i].toLowerCase() === w[i].toLowerCase()) i++;
      return acc.slice(0, i);
    });
    if (common.length > m[1].length) this.text.set(cur.slice(0, -m[1].length) + common);
  }
}
