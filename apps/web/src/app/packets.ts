import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import type { PacketEvent } from './api';
import { Icon } from './icons';

/** Packet inspector + engine activity log. Drops always show the engine's reason verbatim. */
@Component({
  selector: 'nb-packets',
  imports: [FormsModule, NgClass, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 min-w-0 flex-col bg-ink-900/60' },
  template: `
    <div class="flex shrink-0 items-center gap-1 border-b border-ink-800 px-2 py-1">
      <div class="seg">
        <button type="button" class="seg-item" [ngClass]="{ 'seg-item-on': tab() === 'packets' }" (click)="tab.set('packets')">
          <nb-icon name="activity" [size]="12" /> Packets
          @if (packets().length) {
            <span class="rounded-full bg-ink-600 px-1.5 text-[9.5px] text-ink-100">{{ packets().length }}</span>
          }
        </button>
        <button type="button" class="seg-item" [ngClass]="{ 'seg-item-on': tab() === 'log' }" (click)="tab.set('log')">
          <nb-icon name="list" [size]="12" /> Log
        </button>
      </div>
      @if (tab() === 'packets') {
        <div class="relative ml-auto min-w-0 flex-1 max-w-48">
          <nb-icon name="search" [size]="12" class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            class="field min-h-7 pl-7 text-[11px]"
            [ngModel]="q()"
            (ngModelChange)="q.set($event)"
            name="pktq"
            placeholder="filter…"
            autocomplete="off"
          />
        </div>
        <button
          type="button"
          class="btn btn-sm shrink-0"
          [ngClass]="dropsOnly() ? 'bg-danger-500/15 text-danger-300' : 'btn-ghost text-ink-400'"
          [attr.aria-pressed]="dropsOnly()"
          (click)="dropsOnly.set(!dropsOnly())"
          title="Show only dropped packets"
        >
          drops
        </button>
        @if (focusDevice(); as fd) {
          <button
            type="button"
            class="btn btn-sm shrink-0 font-mono"
            [ngClass]="onlyFocus() ? 'bg-brand-500/15 text-brand-200' : 'btn-ghost text-ink-400'"
            [attr.aria-pressed]="onlyFocus()"
            (click)="onlyFocusChange.emit(!onlyFocus())"
            [title]="'Capture: only packets seen at ' + fd"
          >
            {{ fd }}
          </button>
        }
      }
    </div>

    @if (tab() === 'packets') {
      <div class="scroll-thin min-h-0 flex-1 overflow-auto p-1.5">
        @if (!filtered().length) {
          <div class="flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center text-ink-500">
            <nb-icon name="activity" [size]="22" class="text-ink-600" />
            <div class="text-[11px] leading-snug">
              {{ packets().length ? 'No packets match this filter.' : 'Run a ping or Check and every hop shows up here with the exact drop reason.' }}
            </div>
          </div>
        }
        @for (p of filtered(); track p.id) {
          <div
            class="mb-1 rounded-lg border transition-colors"
            [ngClass]="selected()?.id === p.id ? 'border-brand-500/50 bg-ink-800/80' : 'border-transparent hover:bg-ink-800/50'"
          >
            <button type="button" class="flex w-full items-start gap-2 px-2 py-1.5 text-left" (click)="toggle(p)">
              <span class="mt-0.5 chip shrink-0" [ngClass]="!p.drop ? 'chip-ok' : isPolicy(p) ? 'chip-warn' : 'chip-danger'">{{ !p.drop ? 'ok' : isPolicy(p) ? 'denied' : 'drop' }}</span>
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-1.5 font-mono text-[10.5px]">
                  <span class="rounded bg-ink-700/80 px-1 text-[9.5px] uppercase text-ink-200">{{ p.proto }}</span>
                  <span class="truncate text-ink-100">{{ addrLine(p) }}</span>
                  @if (p.simulated) {
                    <span class="chip chip-warn">simulated</span>
                  }
                </div>
                <div class="truncate text-[10.5px] text-ink-400">
                  {{ p.from.device }}<span class="text-ink-600">:{{ p.from.iface }}</span>
                  @if (p.to) {
                    → {{ p.to.device }}<span class="text-ink-600">:{{ p.to.iface }}</span>
                  }
                  · {{ p.reason }}
                </div>
              </div>
            </button>
            @if (selected()?.id === p.id) {
              <div class="border-t border-ink-700/60 px-2 py-2 text-[10.5px] leading-5 text-ink-200">
                <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <span class="text-ink-500">Result</span>
                  <span [ngClass]="p.drop ? 'text-danger-300' : 'text-ok-300'">{{ p.drop ? 'dropped' : 'forwarded' }} — {{ p.reason }}</span>
                  <span class="text-ink-500">Hop</span>
                  <span class="font-mono">{{ p.from.device }}:{{ p.from.iface }}{{ p.to ? ' → ' + p.to.device + ':' + p.to.iface : '' }}</span>
                  @if (p.srcIp || p.dstIp) {
                    <span class="text-ink-500">{{ p.srcIp?.includes(':') ? 'IPv6' : 'IPv4' }}</span>
                    <span class="font-mono">{{ p.srcIp ?? '—' }} → {{ p.dstIp ?? '—' }}</span>
                  }
                  @if (advanced()) {
                    <span class="text-ink-500">MAC</span>
                    <span class="font-mono">{{ p.srcMac }} → {{ p.dstMac }}</span>
                    <span class="text-ink-500">L2</span>
                    <span class="font-mono">VLAN {{ p.vlan ?? '—' }} · SSID {{ p.ssid ?? '—' }} · TTL {{ p.ttl ?? '—' }}</span>
                  }
                </div>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <button type="button" class="btn btn-sm btn-secondary" (click)="replay.emit(p)">
                    <nb-icon name="play" [size]="11" /> Show on canvas
                  </button>
                  <button type="button" class="btn btn-sm btn-eve" (click)="explain.emit(p)">
                    <nb-icon name="sparkles" [size]="11" /> Ask Agent why
                  </button>
                </div>
              </div>
            }
          </div>
        }
      </div>
    } @else {
      <div class="scroll-thin min-h-0 flex-1 overflow-auto p-2 font-mono text-[10.5px] leading-5">
        @if (!log().length) {
          <div class="px-2 py-6 text-center text-ink-500">Engine activity (adds, cables, configs, checks) appears here.</div>
        }
        @for (e of logRows(); track $index) {
          <div class="flex gap-2 text-ink-300">
            <span class="shrink-0 text-ink-600">{{ e.time }}</span>
            <span class="min-w-0 break-words">{{ e.msg }}</span>
          </div>
        }
      </div>
    }
  `,
})
export class Packets {
  packets = input<PacketEvent[]>([]);
  selected = input<PacketEvent | null>(null);
  advanced = input(false);
  log = input<{ t: string; msg: string }[]>([]);
  /** Selected device name; enables the “capture on this device” toggle. */
  focusDevice = input<string | null>(null);
  onlyFocus = input(false);

  onlyFocusChange = output<boolean>();
  select = output<PacketEvent | null>();
  explain = output<PacketEvent>();
  replay = output<PacketEvent>();

  tab = signal<'packets' | 'log'>('packets');
  dropsOnly = signal(false);
  q = signal('');

  filtered = computed(() => {
    const drops = this.dropsOnly();
    const q = this.q().trim().toLowerCase();
    const rows = [...this.packets()].reverse();
    return rows.filter((p) => {
      if (drops && !p.drop) return false;
      if (!q) return true;
      const hay = `${p.proto} ${p.srcIp ?? ''} ${p.dstIp ?? ''} ${p.from.device} ${p.to?.device ?? ''} ${p.reason} ${p.srcMac} ${p.dstMac}`.toLowerCase();
      return hay.includes(q);
    });
  });

  logRows = computed(() =>
    [...this.log()].reverse().map((e) => {
      const d = new Date(e.t);
      const time = Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return { time, msg: e.msg };
    }),
  );

  addrLine(p: PacketEvent) {
    const src = p.srcIp || (this.advanced() ? p.srcMac : '');
    const dst = p.dstIp || (this.advanced() ? p.dstMac : '');
    return src && dst ? `${src} → ${dst}` : p.proto === 'arp' ? 'who-has / is-at' : '';
  }

  toggle(p: PacketEvent) {
    this.select.emit(this.selected()?.id === p.id ? null : p);
  }

  /** ACL/firewall drops are configured decisions; shown as “denied” rather than a fault. */
  isPolicy(p: PacketEvent) {
    return p.reason.startsWith('ACL drop');
  }
}
