import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'pc'
  | 'server'
  | 'switch'
  | 'router'
  | 'firewall'
  | 'ap'
  | 'wlc'
  | 'cloud'
  | 'check'
  | 'x'
  | 'plus'
  | 'minus'
  | 'fit'
  | 'reset'
  | 'trash'
  | 'terminal'
  | 'activity'
  | 'sparkles'
  | 'help'
  | 'chevron-down'
  | 'chevron-right'
  | 'keyboard'
  | 'download'
  | 'upload'
  | 'book'
  | 'user'
  | 'logout'
  | 'zap'
  | 'route'
  | 'refresh'
  | 'wifi'
  | 'unplug'
  | 'plug'
  | 'alert'
  | 'info'
  | 'search'
  | 'send'
  | 'more'
  | 'layers'
  | 'inspect'
  | 'network'
  | 'circle-check'
  | 'circle-x'
  | 'flag'
  | 'arrow-right'
  | 'grip'
  | 'eraser'
  | 'wrench'
  | 'bulb'
  | 'hammer'
  | 'play'
  | 'list'
  | 'copy'
  | 'link'
  | 'power'
  | 'menu'
  | 'save'
  | 'tidy'
  | 'eye'
  | 'eye-off'
  | 'clock'
  | 'undo'
  | 'basic'
  | 'expand'
  | 'collapse'
  | 'pencil'
  | 'file'
  | 'command'
  | 'bookmark'
  | 'diff'
  | 'stethoscope'
  | 'palette';

/** Inline stroke icons (24×24 grid, Lucide-style). Color follows `currentColor`. */
@Component({
  selector: 'nb-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0 items-center justify-center leading-none' },
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="stroke()"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      @switch (name()) {
        @case ('pc') {
          <svg:rect width="20" height="14" x="2" y="3" rx="2" />
          <svg:path d="M8 21h8M12 17v4" />
        }
        @case ('server') {
          <svg:rect width="20" height="8" x="2" y="2" rx="2" />
          <svg:rect width="20" height="8" x="2" y="14" rx="2" />
          <svg:path d="M6 6h.01M6 18h.01" />
        }
        @case ('switch') {
          <svg:rect x="2" y="9" width="20" height="8" rx="2" />
          <svg:path d="M6 13h.01M10 13h.01M14 13h.01M18 13h.01" />
          <svg:path d="M8 5h8M14 3l2 2-2 2" />
        }
        @case ('router') {
          <svg:circle cx="12" cy="12" r="9" />
          <svg:path d="M7 10h10M14 7l3 3-3 3" />
          <svg:path d="M17 14H7M10 17l-3-3 3-3" />
        }
        @case ('firewall') {
          <svg:rect width="18" height="18" x="3" y="3" rx="2" />
          <svg:path d="M3 9h18M3 15h18M8 3v6M16 3v6M12 9v6M8 15v6M16 15v6" />
        }
        @case ('ap') {
          <svg:path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9" />
          <svg:path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5" />
          <svg:circle cx="12" cy="9" r="2" />
          <svg:path d="M16.2 4.8c2 2 2.26 5.11.8 7.47" />
          <svg:path d="M19.1 1.9a9.9 9.9 0 0 1 0 14.1" />
          <svg:path d="M9.5 18h5M8 22l4-11 4 11" />
        }
        @case ('wlc') {
          <svg:rect x="3" y="12" width="18" height="8" rx="2" />
          <svg:path d="M7 16h.01M11 16h.01" />
          <svg:path d="M8.5 8.5a5 5 0 0 1 7 0" />
          <svg:path d="M5.5 5.5a9.5 9.5 0 0 1 13 0" />
        }
        @case ('cloud') {
          <svg:path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        }
        @case ('check') {
          <svg:path d="M20 6 9 17l-5-5" />
        }
        @case ('x') {
          <svg:path d="M18 6 6 18M6 6l12 12" />
        }
        @case ('plus') {
          <svg:path d="M5 12h14M12 5v14" />
        }
        @case ('minus') {
          <svg:path d="M5 12h14" />
        }
        @case ('fit') {
          <svg:path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
        }
        @case ('reset') {
          <svg:path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <svg:path d="M3 3v5h5" />
        }
        @case ('trash') {
          <svg:path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        }
        @case ('terminal') {
          <svg:path d="m4 17 6-6-6-6M12 19h8" />
        }
        @case ('activity') {
          <svg:path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
        }
        @case ('sparkles') {
          <svg:path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
          <svg:path d="M20 3v4M22 5h-4" />
        }
        @case ('help') {
          <svg:circle cx="12" cy="12" r="10" />
          <svg:path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
        }
        @case ('chevron-down') {
          <svg:path d="m6 9 6 6 6-6" />
        }
        @case ('chevron-right') {
          <svg:path d="m9 18 6-6-6-6" />
        }
        @case ('keyboard') {
          <svg:rect width="20" height="16" x="2" y="4" rx="2" />
          <svg:path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
        }
        @case ('download') {
          <svg:path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
        }
        @case ('upload') {
          <svg:path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        }
        @case ('book') {
          <svg:path d="M12 7v14" />
          <svg:path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
        }
        @case ('user') {
          <svg:path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <svg:circle cx="12" cy="7" r="4" />
        }
        @case ('logout') {
          <svg:path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
        }
        @case ('zap') {
          <svg:path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
        }
        @case ('route') {
          <svg:circle cx="6" cy="19" r="3" />
          <svg:path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
          <svg:circle cx="18" cy="5" r="3" />
        }
        @case ('refresh') {
          <svg:path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5" />
          <svg:path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" />
        }
        @case ('wifi') {
          <svg:path d="M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.859a10 10 0 0 1 14 0M8.5 16.429a5 5 0 0 1 7 0" />
        }
        @case ('unplug') {
          <svg:path d="m19 5 3-3M2 22l3-3" />
          <svg:path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
          <svg:path d="M7.5 13.5 10 11M10.5 16.5 13 14" />
          <svg:path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
        }
        @case ('plug') {
          <svg:path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
        }
        @case ('alert') {
          <svg:path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01" />
        }
        @case ('info') {
          <svg:circle cx="12" cy="12" r="10" />
          <svg:path d="M12 16v-4M12 8h.01" />
        }
        @case ('search') {
          <svg:circle cx="11" cy="11" r="8" />
          <svg:path d="m21 21-4.3-4.3" />
        }
        @case ('send') {
          <svg:path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
          <svg:path d="m21.854 2.147-10.94 10.939" />
        }
        @case ('more') {
          <svg:circle cx="12" cy="12" r="1" />
          <svg:circle cx="19" cy="12" r="1" />
          <svg:circle cx="5" cy="12" r="1" />
        }
        @case ('layers') {
          <svg:path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
          <svg:path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
          <svg:path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
        }
        @case ('inspect') {
          <svg:rect width="18" height="18" x="3" y="3" rx="2" />
          <svg:path d="M15 3v18" />
        }
        @case ('network') {
          <svg:rect x="16" y="16" width="6" height="6" rx="1" />
          <svg:rect x="2" y="16" width="6" height="6" rx="1" />
          <svg:rect x="9" y="2" width="6" height="6" rx="1" />
          <svg:path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8" />
        }
        @case ('circle-check') {
          <svg:circle cx="12" cy="12" r="10" />
          <svg:path d="m9 12 2 2 4-4" />
        }
        @case ('circle-x') {
          <svg:circle cx="12" cy="12" r="10" />
          <svg:path d="m15 9-6 6M9 9l6 6" />
        }
        @case ('flag') {
          <svg:path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" />
        }
        @case ('arrow-right') {
          <svg:path d="M5 12h14M12 5l7 7-7 7" />
        }
        @case ('grip') {
          <svg:circle cx="12" cy="9" r="1" />
          <svg:circle cx="19" cy="9" r="1" />
          <svg:circle cx="5" cy="9" r="1" />
          <svg:circle cx="12" cy="15" r="1" />
          <svg:circle cx="19" cy="15" r="1" />
          <svg:circle cx="5" cy="15" r="1" />
        }
        @case ('eraser') {
          <svg:path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21" />
          <svg:path d="m5.082 11.09 8.828 8.828" />
        }
        @case ('wrench') {
          <svg:path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        }
        @case ('bulb') {
          <svg:path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4" />
        }
        @case ('hammer') {
          <svg:path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9M18 15l4-4" />
          <svg:path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5" />
        }
        @case ('play') {
          <svg:path d="M6 3l14 9-14 9z" />
        }
        @case ('list') {
          <svg:path d="M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13" />
        }
        @case ('copy') {
          <svg:rect width="14" height="14" x="8" y="8" rx="2" />
          <svg:path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        }
        @case ('link') {
          <svg:path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <svg:path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        }
        @case ('power') {
          <svg:path d="M12 2v10M18.4 6.6a9 9 0 1 1-12.77.04" />
        }
        @case ('menu') {
          <svg:path d="M4 12h16M4 6h16M4 18h16" />
        }
        @case ('save') {
          <svg:path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
          <svg:path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7" />
        }
        @case ('tidy') {
          <svg:rect width="7" height="7" x="3" y="3" rx="1" />
          <svg:rect width="7" height="7" x="14" y="3" rx="1" />
          <svg:rect width="7" height="7" x="14" y="14" rx="1" />
          <svg:rect width="7" height="7" x="3" y="14" rx="1" />
        }
        @case ('eye') {
          <svg:path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
          <svg:circle cx="12" cy="12" r="3" />
        }
        @case ('eye-off') {
          <svg:path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49M14.084 14.158a3 3 0 0 1-4.242-4.242" />
          <svg:path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143M2 2l20 20" />
        }
        @case ('clock') {
          <svg:circle cx="12" cy="12" r="10" />
          <svg:path d="M12 6v6l4 2" />
        }
        @case ('undo') {
          <svg:path d="M3 7v6h6" />
          <svg:path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
        }
        @case ('basic') {
          <svg:rect width="14" height="20" x="5" y="2" rx="2" />
          <svg:path d="M12 18h.01" />
        }
        @case ('expand') {
          <svg:path d="M15 3h6v6M21 3l-7 7M3 21l7-7M9 21H3v-6" />
        }
        @case ('collapse') {
          <svg:path d="m14 10 7-7M20 10h-6V4M3 21l7-7M4 14h6v6" />
        }
        @case ('pencil') {
          <svg:path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
          <svg:path d="m15 5 4 4" />
        }
        @case ('file') {
          <svg:path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <svg:path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8" />
        }
        @case ('command') {
          <svg:path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
        }
        @case ('bookmark') {
          <svg:path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
        }
        @case ('diff') {
          <svg:path d="M12 3v14M5 10h14M5 21h14" />
        }
        @case ('stethoscope') {
          <svg:path d="M11 2v2M5 2v2M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1" />
          <svg:path d="M8 15a6 6 0 0 0 12 0v-3" />
          <svg:circle cx="20" cy="10" r="2" />
        }
        @case ('palette') {
          <svg:circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
          <svg:circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
          <svg:circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
          <svg:circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
          <svg:path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
        }
      }
    </svg>
  `,
})
export class Icon {
  name = input.required<IconName>();
  size = input(16);
  stroke = input(2);
}

export const KIND_ICON: Record<string, IconName> = {
  workstation: 'pc',
  server: 'server',
  switch: 'switch',
  router: 'router',
  firewall: 'firewall',
  ap: 'ap',
  wlc: 'wlc',
  cloud: 'cloud',
};
