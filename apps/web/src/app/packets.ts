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
  private readonly i18n = inject(I18n);

  protected t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  public readonly packets = input<PacketEvent[]>([]);
  public readonly selected = input<PacketEvent | null>(null);
  public readonly advanced = input(false);
  public readonly log = input<{ t: string; msg: string }[]>([]);
  /** Selected device name; enables the “capture on this device” toggle. */
  public readonly focusDevice = input<string | null>(null);
  public readonly onlyFocus = input(false);

  public readonly onlyFocusChange = output<boolean>();
  public readonly select = output<PacketEvent | null>();
  public readonly explain = output<PacketEvent>();
  public readonly replay = output<PacketEvent>();

  protected readonly tab = signal<'packets' | 'log'>('packets');
  protected readonly dropsOnly = signal(false);
  protected readonly q = signal('');

  protected readonly filtered = computed(() => {
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

  protected readonly logRows = computed(() =>
    [...this.log()].reverse().map((e) => {
      const d = new Date(e.t);
      const time = Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(this.i18n.locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return { time, msg: e.msg };
    }),
  );

  protected addrLine(p: PacketEvent) {
    const src = p.srcIp || (this.advanced() ? p.srcMac : '');
    const dst = p.dstIp || (this.advanced() ? p.dstMac : '');
    return src && dst ? `${src} → ${dst}` : p.proto === 'arp' ? 'who-has / is-at' : '';
  }

  protected toggle(p: PacketEvent) {
    this.select.emit(this.selected()?.id === p.id ? null : p);
  }

  /** ACL/firewall drops are configured decisions; shown as “denied” rather than a fault. */
  protected isPolicy(p: PacketEvent) {
    return p.reason.startsWith('ACL drop');
  }
}
