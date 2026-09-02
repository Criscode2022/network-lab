import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NgClass } from '@angular/common';
import { Icon, type IconName } from './icons';

export type ToastKind = 'info' | 'success' | 'error' | 'warn';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  action?: { label: string; run: () => void };
}

@Component({
  selector: 'nb-toasts',
  imports: [NgClass, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-3',
    '[style.bottom]': 'bottom()',
  },
  template: `
    @for (t of items(); track t.id) {
      <div
        class="pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border px-3 py-2.5 text-xs shadow-pop backdrop-blur animate-toast"
        role="status"
        [ngClass]="{
          'border-ink-700 bg-ink-800/95 text-ink-100': t.kind === 'info',
          'border-ok-500/40 bg-ink-800/95 text-ink-100': t.kind === 'success',
          'border-danger-500/50 bg-ink-800/95 text-ink-100': t.kind === 'error',
          'border-warn-500/50 bg-ink-800/95 text-ink-100': t.kind === 'warn',
        }"
      >
        <nb-icon
          [name]="icon(t.kind)"
          [size]="15"
          class="mt-0.5"
          [ngClass]="{
            'text-brand-300': t.kind === 'info',
            'text-ok-400': t.kind === 'success',
            'text-danger-400': t.kind === 'error',
            'text-warn-400': t.kind === 'warn',
          }"
        />
        <div class="min-w-0 flex-1 leading-5 break-words">{{ t.text }}</div>
        @if (t.action; as a) {
          <button type="button" class="btn btn-sm shrink-0 border-ink-600 bg-ink-700 text-brand-200 hover:bg-ink-600" (click)="runAction(t)">
            {{ a.label }}
          </button>
        }
        <button type="button" class="btn btn-ghost btn-icon h-6 w-6 shrink-0 text-ink-400" aria-label="Dismiss" (click)="dismiss.emit(t.id)">
          <nb-icon name="x" [size]="12" />
        </button>
      </div>
    }
  `,
})
export class Toasts {
  items = input<Toast[]>([]);
  bottom = input('1rem');
  dismiss = output<number>();

  icon(kind: ToastKind): IconName {
    return kind === 'success' ? 'circle-check' : kind === 'error' ? 'circle-x' : kind === 'warn' ? 'alert' : 'info';
  }

  runAction(t: Toast) {
    t.action?.run();
    this.dismiss.emit(t.id);
  }
}
