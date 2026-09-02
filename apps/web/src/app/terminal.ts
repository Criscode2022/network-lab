import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, signal, viewChild } from '@angular/core';
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

/** One-tap commands per device kind. Every entry is a real CLI line the engine understands. */
export const QUICK_COMMANDS: Record<string, { label: string; cmd: string }[]> = {
  workstation: [
    { label: 'ip addr', cmd: 'ip addr' },
    { label: 'ip route', cmd: 'ip route' },
    { label: 'wifi link', cmd: 'iw dev wlan0 link' },
    { label: 'tcpdump', cmd: 'tcpdump -c 10' },
    { label: 'help', cmd: 'help' },
  ],
  server: [
    { label: 'ip addr', cmd: 'ip addr' },
    { label: 'ip route', cmd: 'ip route' },
    { label: 'sockets', cmd: 'ss' },
    { label: 'start ssh', cmd: 'systemctl start ssh' },
    { label: 'help', cmd: 'help' },
  ],
  switch: [
    { label: 'show run', cmd: 'show run' },
    { label: 'show vlan', cmd: 'show vlan' },
    { label: 'show mac', cmd: 'show mac' },
    { label: 'show int', cmd: 'show int' },
    { label: 'show trunk', cmd: 'show trunk' },
    { label: 'help', cmd: 'help' },
  ],
  router: [
    { label: 'show run', cmd: 'show run' },
    { label: 'show ip route', cmd: 'show ip route' },
    { label: 'ospf neighbor', cmd: 'show ip ospf neighbor' },
    { label: 'show ipv6 route', cmd: 'show ipv6 route' },
    { label: 'help', cmd: 'help' },
  ],
  firewall: [
    { label: 'show rules', cmd: 'show rules' },
    { label: 'ip addr', cmd: 'ip addr' },
    { label: 'ip route', cmd: 'ip route' },
    { label: 'help', cmd: 'help' },
  ],
  ap: [
    { label: 'show ssid', cmd: 'show ssid' },
    { label: 'show interface', cmd: 'show interface' },
    { label: 'help', cmd: 'help' },
  ],
  wlc: [
    { label: 'show ap summary', cmd: 'show ap summary' },
    { label: 'show wlan', cmd: 'show wlan' },
    { label: 'help', cmd: 'help' },
  ],
  cloud: [
    { label: 'show run', cmd: 'show run' },
    { label: 'help', cmd: 'help' },
  ],
};

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
        <div class="text-ink-500">Type <span class="text-ink-200">help</span> for this device’s commands. ↑/↓ recalls history, Tab completes.</div>
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

    @if (quick().length) {
      <div class="scroll-thin flex shrink-0 items-center gap-1 overflow-x-auto border-t border-ink-800/80 px-2 py-1">
        <span class="mr-1 shrink-0 text-[10px] text-ink-500">Quick</span>
        @for (q of quick(); track q.cmd) {
          <button
            type="button"
            class="shrink-0 rounded-md border border-ink-700 bg-ink-900 px-2 py-0.5 font-mono text-[10.5px] text-ink-200 transition-colors hover:border-brand-500/50 hover:text-brand-200"
            [disabled]="busy()"
            (click)="run.emit(q.cmd)"
          >
            {{ q.label }}
          </button>
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
  quick = input<{ label: string; cmd: string }[]>([]);

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
