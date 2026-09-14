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
  readonly i18n = inject(I18n);

  t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  labs = input<LabSummary[]>([]);
  currentId = input<string | null>(null);
  currentName = input<string>('');
  passed = input<string[]>([]);
  compact = input(false);

  pick = output<string>();

  open = signal(false);
  private el = inject<ElementRef<HTMLElement>>(ElementRef);

  syllabus = computed(() => this.labs().filter((l) => !l.custom));
  currentIndex = computed(() => this.syllabus().findIndex((l) => l.id === this.currentId()) + 1);
  onSyllabus = computed(() => this.currentIndex() > 0);
  passedCount = computed(() => this.syllabus().filter((l) => this.passed().includes(l.id)).length);
  builtinCount = computed(() => this.syllabus().length);

  numberOf(id: string) {
    return this.syllabus().findIndex((l) => l.id === id) + 1;
  }

  choose(id: string) {
    this.open.set(false);
    this.pick.emit(id);
  }

  @HostListener('document:pointerdown', ['$event'])
  onDoc(ev: PointerEvent) {
    if (this.open() && !this.el.nativeElement.contains(ev.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEsc() {
    this.open.set(false);
  }
}
