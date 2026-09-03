import { CABLE_MEDIA } from './cables.ts';
import { DEVICE_KINDS, SWITCH_PROFILES, type CableMedia, type DeviceKind, type LabPatch, type SwitchProfile } from './types.ts';

export function validatePatch(input: unknown): { ok: true; patch: LabPatch } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'patch must be an object' };
  const p = input as Record<string, unknown>;
  const extra = Object.keys(p).filter(
    (k) => !['addDevices', 'removeDeviceIds', 'addLinks', 'removeLinks', 'configs'].includes(k),
  );
  if (extra.length) return { ok: false, error: `unknown patch fields: ${extra.join(', ')}` };
  const patch: LabPatch = {};
  if (p.addDevices !== undefined) {
    if (!Array.isArray(p.addDevices)) return { ok: false, error: 'addDevices must be an array' };
    patch.addDevices = [];
    for (const d of p.addDevices) {
      if (!d || typeof d !== 'object') return { ok: false, error: 'invalid addDevices item' };
      const rec = d as Record<string, unknown>;
      const type = rec.type as DeviceKind;
      if (!DEVICE_KINDS.includes(type)) return { ok: false, error: `unknown device type ${String(rec.type)}` };
      if (rec.switchProfile !== undefined && type !== 'switch') return { ok: false, error: 'switchProfile is only valid for switches' };
      const switchProfile = rec.switchProfile as SwitchProfile | undefined;
      if (type === 'switch' && switchProfile !== undefined && !SWITCH_PROFILES.includes(switchProfile)) {
        return { ok: false, error: `unknown switchProfile ${String(rec.switchProfile)}` };
      }
      if (typeof rec.name !== 'string' || !rec.name) return { ok: false, error: 'device name required' };
      patch.addDevices.push({
        type,
        name: rec.name,
        ...(switchProfile ? { switchProfile } : {}),
        x: typeof rec.x === 'number' ? rec.x : 80,
        y: typeof rec.y === 'number' ? rec.y : 80,
      });
    }
  }
  if (p.removeDeviceIds !== undefined) {
    if (!Array.isArray(p.removeDeviceIds) || p.removeDeviceIds.some((x) => typeof x !== 'string')) {
      return { ok: false, error: 'removeDeviceIds must be string[]' };
    }
    patch.removeDeviceIds = p.removeDeviceIds as string[];
  }
  if (p.addLinks !== undefined) {
    if (!Array.isArray(p.addLinks)) return { ok: false, error: 'addLinks must be an array' };
    patch.addLinks = [];
    for (const l of p.addLinks) {
      const rec = l as Record<string, unknown>;
      if (typeof rec?.a !== 'string' || typeof rec?.b !== 'string') return { ok: false, error: 'link needs a and b as Name:iface' };
      let cable: CableMedia | undefined;
      if (rec.cable !== undefined) {
        if (typeof rec.cable !== 'string' || !CABLE_MEDIA.includes(rec.cable as CableMedia)) {
          return { ok: false, error: `unknown cable ${String(rec.cable)}` };
        }
        cable = rec.cable as CableMedia;
      }
      patch.addLinks.push({ a: rec.a, b: rec.b, ...(cable ? { cable } : {}) });
    }
  }
  if (p.removeLinks !== undefined) {
    if (!Array.isArray(p.removeLinks)) return { ok: false, error: 'removeLinks must be string[]' };
    patch.removeLinks = p.removeLinks as string[];
  }
  if (p.configs !== undefined) {
    if (!Array.isArray(p.configs)) return { ok: false, error: 'configs must be an array' };
    patch.configs = [];
    for (const c of p.configs) {
      const rec = c as Record<string, unknown>;
      if (typeof rec?.device !== 'string' || !Array.isArray(rec.commands)) {
        return { ok: false, error: 'config needs device and commands[]' };
      }
      if ((rec.commands as unknown[]).some((x) => typeof x !== 'string')) return { ok: false, error: 'commands must be strings' };
      patch.configs.push({ device: rec.device, commands: rec.commands as string[] });
    }
  }
  return { ok: true, patch };
}
