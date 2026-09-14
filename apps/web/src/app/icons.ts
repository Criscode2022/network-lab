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
  | 'redo'
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
  templateUrl: './icons.html',
})
export class Icon {
  public readonly name = input.required<IconName>();
  public readonly size = input(16);
  public readonly stroke = input(2);
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
