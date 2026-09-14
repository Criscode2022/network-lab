import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import type { SavedLab } from './api';
import { Icon } from './icons';
import { I18n } from './i18n/i18n';
import type { MessageKey } from './i18n/en';
import { labBlurb } from './lab-library';

/** Header switcher for saved custom labs (guest browser or account). */
@Component({
  selector: 'nb-mine-picker',
  imports: [NgClass, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative block min-w-0' },
  templateUrl: './mine-picker.html',
})
export class MinePicker {
  readonly i18n = inject(I18n);

  t(key: MessageKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  mine = input<SavedLab[]>([]);
  currentId = input<string | null>(null);
  localOnly = input(false);
  compact = input(false);

  pick = output<string>();
  deleteMine = output<string>();
  openLibrary = output<void>();

  open = signal(false);
  private el = inject<ElementRef<HTMLElement>>(ElementRef);

  current = computed(() => this.mine().find((m) => m.id === this.currentId()));
  active = computed(() => !!this.current());

  blurb(lab: SavedLab): string {
    return labBlurb(lab);
  }

  choose(id: string) {
    this.open.set(false);
    this.pick.emit(id);
  }

  openAll() {
    this.open.set(false);
    this.openLibrary.emit();
  }

  when(iso: string) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return this.t('lab.justNow');
    if (diff < 3_600_000) return this.t('lab.minAgo', { n: Math.round(diff / 60_000) });
    if (diff < 86_400_000) return this.t('lab.hAgo', { n: Math.round(diff / 3_600_000) });
    return d.toLocaleDateString(this.i18n.locale());
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
