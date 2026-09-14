import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Locale } from './i18n/i18n';

/** Compact 4:3 country flags. SVG so they render on Windows (emoji flags often do not). */
@Component({
  selector: 'nb-flag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nb-flag inline-flex shrink-0 overflow-hidden rounded-[2px] ring-1 ring-white/20',
    style: 'line-height:0',
  },
  templateUrl: './flags.html',
})
export class Flag {
  public readonly locale = input.required<Locale>();
  public readonly width = input(18);
  public readonly height = input(13);
}
