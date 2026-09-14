import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import type { LabSummary } from './api';
import { Icon } from './icons';
import { I18n } from './i18n/i18n';
import type { MessageKey } from './i18n/en';

/** Header switcher for the numbered practice syllabus. */
@Component({
  selector: 'nb-lab-picker',
  imports: [NgClass, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative block min-w-0' },
  templateUrl: './lab-picker.html',
})
export class LabPicker {
  private readonly i18n = inject(I18n);

  protected t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  public readonly labs = input<LabSummary[]>([]);
  public readonly currentId = input<string | null>(null);
  public readonly currentName = input<string>('');
  public readonly passed = input<string[]>([]);
  public readonly compact = input(false);

  public readonly pick = output<string>();

  protected readonly open = signal(false);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly syllabus = computed(() => this.labs().filter((l) => !l.custom));
  protected readonly currentIndex = computed(() => this.syllabus().findIndex((l) => l.id === this.currentId()) + 1);
  protected readonly onSyllabus = computed(() => this.currentIndex() > 0);
  protected readonly passedCount = computed(() => this.syllabus().filter((l) => this.passed().includes(l.id)).length);
  protected readonly builtinCount = computed(() => this.syllabus().length);

  protected numberOf(id: string) {
    return this.syllabus().findIndex((l) => l.id === id) + 1;
  }

  protected choose(id: string) {
    this.open.set(false);
    this.pick.emit(id);
  }

  @HostListener('document:pointerdown', ['$event'])
  protected onDoc(ev: PointerEvent) {
    if (this.open() && !this.el.nativeElement.contains(ev.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEsc() {
    this.open.set(false);
  }
}
