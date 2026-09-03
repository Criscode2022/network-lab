import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import { Icon, KIND_ICON } from './icons';

/** Searchable command reference per device kind. Clicking a row drops the command into the terminal. */
@Component({
  selector: 'nb-cheat-sheet',
  imports: [FormsModule, NgClass, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop flex items-end justify-center p-3 sm:items-center" (click)="close.emit()">
      <div
        class="card flex max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden animate-pop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nb-cheat-title"
        (click)="$event.stopPropagation()"
      >
        <div class="flex items-center gap-2 border-b border-ink-700 px-4 py-3">
          <nb-icon name="book" [size]="16" class="text-brand-300" />
          <h2 id="nb-cheat-title" class="text-sm font-semibold text-ink-50">Command reference</h2>
          <span class="text-[10.5px] text-ink-500">click a command to put it in the terminal</span>
          <button type="button" class="btn btn-ghost btn-icon ml-auto" aria-label="Close" (click)="close.emit()">
            <nb-icon name="x" [size]="16" />
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-1.5 border-b border-ink-800 px-3 py-2">
          @for (k of kinds(); track k.id) {
            <button
              type="button"
              class="inline-flex min-h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors"
              [ngClass]="k.id === kind() ? 'bg-ink-700 text-ink-50' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'"
              (click)="kindChange.emit(k.id)"
            >
              <nb-icon [name]="icon(k.kind)" [size]="12" /> {{ k.label }}
            </button>
          }
          <div class="relative ml-auto w-full sm:w-48">
            <nb-icon name="search" [size]="12" class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-500" />
            <input class="field min-h-8 pl-7" [ngModel]="q()" (ngModelChange)="q.set($event)" name="cheatq" placeholder="search commands…" autocomplete="off" />
          </div>
        </div>
        <div class="scroll-thin min-h-0 flex-1 overflow-auto p-2">
          @if (loading()) {
            <div class="flex items-center gap-2 px-3 py-6 text-xs text-ink-400"><span class="spinner"></span> Loading…</div>
          } @else if (!filtered().length) {
            <div class="px-3 py-6 text-center text-xs text-ink-500">No commands match “{{ q() }}”.</div>
          }
          @for (r of filtered(); track r.cmd) {
            <button
              type="button"
              class="group flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-ink-800"
              (click)="run.emit(firstWords(r.cmd))"
              [title]="'Insert ' + firstWords(r.cmd)"
            >
              <code class="min-w-0 flex-1 font-mono text-[11.5px] text-brand-200 break-words">{{ r.cmd }}</code>
              <span class="min-w-0 flex-1 text-[11px] leading-snug text-ink-300">{{ r.help }}</span>
              <nb-icon name="terminal" [size]="13" class="mt-0.5 shrink-0 text-ink-600 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          }
        </div>
      </div>
    </div>
  `,
})
export class CheatSheet {
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
