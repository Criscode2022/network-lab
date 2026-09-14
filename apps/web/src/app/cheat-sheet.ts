import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import { Icon, KIND_ICON } from './icons';
import { I18n } from './i18n/i18n';
import type { MessageKey } from './i18n/en';

/** Searchable command reference per device kind. Clicking a row drops the command into the terminal. */
@Component({
  selector: 'nb-cheat-sheet',
  imports: [FormsModule, NgClass, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cheat-sheet.html',
})
export class CheatSheet {
  readonly i18n = inject(I18n);

  t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  kind = input('workstation');
  kinds = input<{ id: string; kind: string; label: string }[]>([]);
  rows = input<{ cmd: string; help: string }[]>([]);
  loading = input(false);

  close = output<void>();
  kindChange = output<string>();
  run = output<string>();

  q = signal('');

  filtered = computed(() => {
    const q = this.q().trim().toLowerCase();
    if (!q) return this.rows();
    return this.rows().filter((r) => `${r.cmd} ${r.help}`.toLowerCase().includes(q));
  });

  icon(kind: string) {
    return KIND_ICON[kind] ?? 'pc';
  }

  /** Strip placeholders like `[add ADDR/P dev IF]` or `A.B.C.D` so what lands in the terminal is typeable. */
  firstWords(cmd: string) {
    return cmd
      .split('|')[0]
      .replace(/\[.*?]/g, '')
      .split(/\s+/)
      .filter((w) => w && !/[A-Z]/.test(w))
      .join(' ')
      .trim() || cmd;
  }
}
