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
  template: `
    <svg
      [attr.width]="width()"
      [attr.height]="height()"
      viewBox="0 0 16 12"
      aria-hidden="true"
      focusable="false"
    >
      @switch (locale()) {
        @case ('en') {
          <svg:rect width="16" height="12" fill="#012169" />
          <svg:path d="M0 0l16 12M16 0L0 12" stroke="#fff" stroke-width="2.4" />
          <svg:path d="M0 0l16 12M16 0L0 12" stroke="#C8102E" stroke-width="1.4" />
          <svg:path d="M8 0v12M0 6h16" stroke="#fff" stroke-width="4" />
          <svg:path d="M8 0v12M0 6h16" stroke="#C8102E" stroke-width="2.4" />
        }
        @case ('es') {
          <svg:rect width="16" height="12" fill="#AA151B" />
          <svg:rect y="3" width="16" height="6" fill="#F1BF00" />
        }
        @case ('fr') {
          <svg:rect width="16" height="12" fill="#fff" />
          <svg:rect width="5.34" height="12" fill="#002395" />
          <svg:rect x="10.66" width="5.34" height="12" fill="#ED2939" />
        }
        @case ('de') {
          <svg:rect width="16" height="12" fill="#000" />
          <svg:rect y="4" width="16" height="4" fill="#DD0000" />
          <svg:rect y="8" width="16" height="4" fill="#FFCE00" />
        }
        @case ('pt') {
          <svg:rect width="16" height="12" fill="#FF0000" />
          <svg:rect width="6.4" height="12" fill="#006600" />
          <svg:circle cx="6.4" cy="6" r="2.2" fill="#FFCC00" />
          <svg:circle cx="6.4" cy="6" r="1.2" fill="#C8102E" />
        }
      }
    </svg>
  `,
})
export class Flag {
  locale = input.required<Locale>();
  width = input(18);
  height = input(13);
}
