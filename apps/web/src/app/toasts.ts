import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { NgClass } from '@angular/common';
import { Icon, type IconName } from './icons';
import { I18n } from './i18n/i18n';

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
  templateUrl: './toasts.html',
})
export class Toasts {
  protected readonly i18n = inject(I18n);
  public readonly items = input<Toast[]>([]);
  public readonly bottom = input('1rem');
  public readonly dismiss = output<number>();

  protected icon(kind: ToastKind): IconName {
    return kind === 'success' ? 'circle-check' : kind === 'error' ? 'circle-x' : kind === 'warn' ? 'alert' : 'info';
  }

  protected runAction(t: Toast) {
    t.action?.run();
    this.dismiss.emit(t.id);
  }
}
