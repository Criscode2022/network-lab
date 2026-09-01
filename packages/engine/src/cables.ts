import type { CableMedia, DeviceKind } from './types.ts';

export const CABLE_MEDIA: CableMedia[] = ['ethernet', 'straight', 'crossover', 'fiber'];

export function isIntermediary(kind: DeviceKind): boolean {
  return kind === 'switch';
}

export function fiberCapable(kind: DeviceKind): boolean {
  return kind === 'switch' || kind === 'router' || kind === 'firewall' || kind === 'ap' || kind === 'wlc';
}

/** CCNA-style: unlike devices need straight-through; like devices need crossover. */
export function neededCable(a: DeviceKind, b: DeviceKind): 'straight' | 'crossover' {
  return isIntermediary(a) === isIntermediary(b) ? 'crossover' : 'straight';
}

export function cableLabel(cable: CableMedia | undefined): string {
  switch (cable) {
    case 'straight':
      return 'Straight-through';
    case 'crossover':
      return 'Crossover';
    case 'fiber':
      return 'Fiber';
    default:
      return 'Ethernet';
  }
}

export function cableCarrier(
  cable: CableMedia | undefined,
  a: DeviceKind,
  b: DeviceKind,
): { ok: boolean; reason?: string } {
  const c = cable ?? 'ethernet';
  if (c === 'ethernet') return { ok: true };
  if (c === 'fiber') {
    if (!fiberCapable(a) || !fiberCapable(b)) {
      return { ok: false, reason: 'fiber needs SFP-capable ports (switch, router, firewall, AP, WLC)' };
    }
    return { ok: true };
  }
  const need = neededCable(a, b);
  if (c === need) return { ok: true };
  return { ok: false, reason: `wrong cable (${c}; ${a} ↔ ${b} needs ${need})` };
}
