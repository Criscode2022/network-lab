import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import type { PacketEvent } from './api';
import { Icon } from './icons';
import { I18n } from './i18n/i18n';
import type { MessageKey } from './i18n/en';

/** Packet inspector + engine activity log. Drops always show the engine's reason verbatim. */
@Component({
  selector: 'nb-packets',
  imports: [FormsModule, NgClass, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 min-w-0 flex-col bg-ink-900/60' },
  templateUrl: './packets.html',
})
export class Packets {
  readonly i18n = inject(I18n);

  t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

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
      const time = Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(this.i18n.locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
