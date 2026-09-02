import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import type { LabSummary, SavedLab } from './api';
import { Icon } from './icons';

/** Header lab switcher: builtin curriculum with pass badges, plus the signed-in user's saved labs. */
@Component({
  selector: 'nb-lab-picker',
  imports: [NgClass, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative block min-w-0' },
  template: `
    <button
      type="button"
      class="btn btn-secondary max-w-full min-w-0 justify-between gap-2 md:min-w-56"
      [class.min-h-9]="compact()"
      aria-haspopup="listbox"
      [attr.aria-expanded]="open()"
      (click)="open.set(!open())"
    >
      <span class="flex min-w-0 items-center gap-2">
        @if (currentIndex() > 0) {
          <span class="chip chip-brand shrink-0 px-1.5">{{ currentIndex() }}</span>
        } @else if (currentId() && labs().length) {
          <span class="chip chip-muted shrink-0 px-1.5">custom</span>
        }
        <span class="truncate">{{ currentName() || 'Choose a lab' }}</span>
      </span>
      <nb-icon name="chevron-down" [size]="14" class="shrink-0 text-ink-400 transition-transform" [class.rotate-180]="open()" />
    </button>

    @if (open()) {
      <div
        class="card absolute left-0 z-40 mt-1.5 w-[min(92vw,26rem)] overflow-hidden animate-pop"
        [ngClass]="alignRight() ? 'right-0 left-auto' : ''"
        role="listbox"
      >
        <div class="flex items-center justify-between border-b border-ink-700 px-3 py-2">
          <div>
            <div class="text-xs font-semibold text-ink-50">Labs</div>
            <div class="text-[10.5px] text-ink-400">{{ passedCount() }} of {{ builtinCount() }} passed</div>
          </div>
          <div class="h-1.5 w-28 overflow-hidden rounded-full bg-ink-700">
            <div class="h-full rounded-full bg-ok-400 transition-all" [style.width.%]="builtinCount() ? (passedCount() / builtinCount()) * 100 : 0"></div>
          </div>
        </div>
        <div class="scroll-thin max-h-[60dvh] overflow-auto p-1.5">
          @for (l of labs(); track l.id) {
            <button
              type="button"
              class="menu-item items-start"
              [ngClass]="{ 'bg-ink-800 ring-1 ring-brand-500/40': l.id === currentId() }"
              role="option"
              [attr.aria-selected]="l.id === currentId()"
              (click)="choose(l.id)"
            >
              <span
                class="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold"
                [ngClass]="passed().includes(l.id) ? 'bg-ok-500/20 text-ok-300' : 'bg-ink-700 text-ink-300'"
              >
                @if (passed().includes(l.id)) {
                  <nb-icon name="check" [size]="12" />
                } @else if (l.custom) {
                  <nb-icon name="pencil" [size]="11" />
                } @else {
                  {{ numberOf(l.id) }}
                }
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-xs font-medium text-ink-50">{{ l.name }}</span>
                <span class="mt-0.5 line-clamp-2 block text-[10.5px] leading-snug text-ink-400">{{ l.goal }}</span>
              </span>
            </button>
          }
          @if (signedIn()) {
            <div class="mt-2 mb-1 flex items-center justify-between px-2.5">
              <span class="section-title">My labs</span>
              <span class="text-[10px] text-ink-500">{{ mine().length }}</span>
            </div>
            @for (m of mine(); track m.id) {
              <div class="menu-item group items-center pr-1" [ngClass]="{ 'bg-ink-800 ring-1 ring-brand-500/40': m.id === currentId() }">
                <button type="button" class="flex min-w-0 flex-1 items-start gap-2 text-left" (click)="pickMine.emit(m.id)">
                  <nb-icon name="save" [size]="14" class="mt-0.5 shrink-0 text-ink-400" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-xs font-medium text-ink-50">{{ m.name }}</span>
                    <span class="block text-[10px] text-ink-500">{{ when(m.updatedAt) }} · {{ m.json.devices?.length ?? 0 }} devices</span>
                  </span>
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-icon h-7 w-7 text-ink-500 hover:text-danger-300"
                  aria-label="Delete saved lab"
                  title="Delete saved lab"
                  (click)="deleteMine.emit(m.id)"
                >
                  <nb-icon name="trash" [size]="13" />
                </button>
              </div>
            } @empty {
              <p class="px-2.5 pb-2 text-[10.5px] text-ink-500">Nothing saved yet. Use ⋯ → Save a copy.</p>
            }
          }
        </div>
      </div>
    }
  `,
})
export class LabPicker {
  labs = input<LabSummary[]>([]);
  currentId = input<string | null>(null);
  currentName = input<string>('');
  passed = input<string[]>([]);
  mine = input<SavedLab[]>([]);
  signedIn = input(false);
  compact = input(false);
  alignRight = input(false);

  pick = output<string>();
  pickMine = output<string>();
  deleteMine = output<string>();

  open = signal(false);
  private el = inject<ElementRef<HTMLElement>>(ElementRef);

  private builtin = computed(() => this.labs().filter((l) => !l.custom));
  currentIndex = computed(() => this.builtin().findIndex((l) => l.id === this.currentId()) + 1);
  passedCount = computed(() => this.builtin().filter((l) => this.passed().includes(l.id)).length);
  builtinCount = computed(() => this.builtin().length);

  numberOf(id: string) {
    return this.builtin().findIndex((l) => l.id === id) + 1;
  }

  choose(id: string) {
    this.open.set(false);
    this.pick.emit(id);
  }

  when(iso: string) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
    return d.toLocaleDateString();
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
