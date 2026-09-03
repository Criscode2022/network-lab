import { CABLE_MEDIA } from './cables.ts';
import { Engine } from './engine.ts';
import {
  DEVICE_KINDS,
  KIND_PORTS,
  LAB_KINDS,
  LAB_LEVELS,
  type CableMedia,
  type DeviceKind,
  type LabCheck,
  type LabJson,
  type LabKind,
  type LabLevel,
  type LabPatch,
  type LabSolution,
} from './types.ts';

export const MAX_LAB_DEVICES = 40;
export const MAX_LAB_LINKS = 80;
const OUT_OF_SCOPE = /\b(bgp|mpls|vxlan|802\.1x|dot1x)\b/i;
const CHECK_TYPES = new Set(['ping', 'ssh', 'wifi-associated', 'dhcp-bound', 'ospf-full']);

type Ok = { ok: true; lab: LabJson };
type Bad = { ok: false; error: string };

function isStrArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Structural validation of a full lab JSON (what Eve's builder or an upload hands us).
 * Checks kinds, unique names, ports, cable media, check shapes and the out-of-scope word list.
 * It does not run the lab — use `labStartupErrors` for that.
 */
export function validateLab(input: unknown): Ok | Bad {
  if (!input || typeof input !== 'object') return { ok: false, error: 'lab must be an object' };
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.devices)) return { ok: false, error: 'lab.devices must be an array' };
  if (!Array.isArray(raw.links)) return { ok: false, error: 'lab.links must be an array' };
  if (raw.devices.length === 0) return { ok: false, error: 'lab needs at least one device' };
  if (raw.devices.length > MAX_LAB_DEVICES) return { ok: false, error: `too many devices (${raw.devices.length} > ${MAX_LAB_DEVICES})` };
  if (raw.links.length > MAX_LAB_LINKS) return { ok: false, error: `too many links (${raw.links.length} > ${MAX_LAB_LINKS})` };

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Custom lab';
  const id =
    typeof raw.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(raw.id)
      ? raw.id
      : `nb-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'lab'}-${Date.now().toString(36)}`;

  const devices: LabJson['devices'] = [];
  const names = new Set<string>();
  for (const d of raw.devices as unknown[]) {
    if (!d || typeof d !== 'object') return { ok: false, error: 'device entries must be objects' };
    const rec = d as Record<string, unknown>;
    const kind = rec.kind as DeviceKind;
    if (!DEVICE_KINDS.includes(kind)) return { ok: false, error: `unknown device kind "${String(rec.kind)}" (allowed: ${DEVICE_KINDS.join(', ')})` };
    if (typeof rec.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/.test(rec.name)) return { ok: false, error: `device name "${String(rec.name)}" must be 1-24 letters, digits, - or _` };
    if (names.has(rec.name.toLowerCase())) return { ok: false, error: `duplicate device name ${rec.name}` };
    names.add(rec.name.toLowerCase());
    const startup = rec.startup === undefined ? [] : rec.startup;
    const post = rec.post === undefined ? undefined : rec.post;
    if (!isStrArray(startup)) return { ok: false, error: `${rec.name}: startup must be a string array` };
    if (post !== undefined && !isStrArray(post)) return { ok: false, error: `${rec.name}: post must be a string array` };
    for (const line of [...startup, ...(post ?? [])]) {
      if (OUT_OF_SCOPE.test(line)) return { ok: false, error: `${rec.name}: "${line}" — NetBench does not implement BGP/MPLS/VXLAN/802.1X` };
    }
    devices.push({
      ...(typeof rec.id === 'string' ? { id: rec.id } : {}),
      kind,
      name: rec.name,
      x: typeof rec.x === 'number' && Number.isFinite(rec.x) ? rec.x : 80 + (devices.length % 5) * 180,
      y: typeof rec.y === 'number' && Number.isFinite(rec.y) ? rec.y : 60 + Math.floor(devices.length / 5) * 160,
      ...(typeof rec.hostname === 'string' && rec.hostname ? { hostname: rec.hostname } : {}),
      startup,
      ...(post && post.length ? { post } : {}),
    });
  }

  const byName = new Map(devices.map((d) => [d.name.toLowerCase(), d]));
  const links: LabJson['links'] = [];
  const usedPorts = new Set<string>();
  const endpoint = (s: unknown, where: string): { key: string; text: string } | Bad => {
    if (typeof s !== 'string') return { ok: false, error: `${where}: link endpoints must be "Name:iface" strings` };
    const i = s.lastIndexOf(':');
    if (i <= 0) return { ok: false, error: `${where}: "${s}" is not Name:iface` };
    const dev = byName.get(s.slice(0, i).toLowerCase());
    if (!dev) return { ok: false, error: `${where}: unknown device in "${s}"` };
    const iface = s.slice(i + 1);
    const port = KIND_PORTS[dev.kind].find((p) => p.toLowerCase() === iface.toLowerCase());
    if (!port) return { ok: false, error: `${where}: ${dev.name} has no port ${iface} (has ${KIND_PORTS[dev.kind].join(', ')})` };
    if (port === 'wlan0') return { ok: false, error: `${where}: wlan0 is a radio — Wi-Fi clients associate with nmcli, they are not cabled` };
    return { key: `${dev.name}:${port}`, text: `${dev.name}:${port}` };
  };
  for (const l of raw.links as unknown[]) {
    if (!l || typeof l !== 'object') return { ok: false, error: 'link entries must be objects' };
    const rec = l as Record<string, unknown>;
    const a = endpoint(rec.a, 'link a');
    if ('ok' in a) return a;
    const b = endpoint(rec.b, 'link b');
    if ('ok' in b) return b;
    if (a.key.split(':')[0] === b.key.split(':')[0]) return { ok: false, error: `link ${a.text} — ${b.text} connects a device to itself` };
    for (const k of [a.key, b.key]) {
      if (usedPorts.has(k)) return { ok: false, error: `port ${k} is cabled twice` };
      usedPorts.add(k);
    }
    let cable: CableMedia | undefined;
    if (rec.cable !== undefined) {
      if (typeof rec.cable !== 'string' || !CABLE_MEDIA.includes(rec.cable as CableMedia)) return { ok: false, error: `unknown cable "${String(rec.cable)}"` };
      cable = rec.cable as CableMedia;
    }
    links.push({ a: a.text, b: b.text, ...(cable ? { cable } : {}) });
  }

  const checks: LabCheck[] = [];
  const rawChecks = raw.checks === undefined ? [] : raw.checks;
  if (!Array.isArray(rawChecks)) return { ok: false, error: 'lab.checks must be an array' };
  const knownDevice = (v: unknown) => typeof v === 'string' && byName.has(v.toLowerCase());
  for (const c of rawChecks as unknown[]) {
    if (!c || typeof c !== 'object') return { ok: false, error: 'check entries must be objects' };
    const rec = c as Record<string, unknown>;
    if (!CHECK_TYPES.has(String(rec.type))) return { ok: false, error: `unknown check type "${String(rec.type)}"` };
    switch (rec.type) {
      case 'ping':
        if (!knownDevice(rec.src) || typeof rec.dst !== 'string' || !rec.dst) return { ok: false, error: 'ping check needs src (a device name) and dst (address or device)' };
        checks.push({ type: 'ping', src: rec.src as string, dst: rec.dst, ...(rec.family === 'v6' ? { family: 'v6' as const } : { family: 'v4' as const }) });
        break;
      case 'ssh':
        if (!knownDevice(rec.src) || typeof rec.dst !== 'string' || !rec.dst) return { ok: false, error: 'ssh check needs src and dst' };
        checks.push({ type: 'ssh', src: rec.src as string, dst: rec.dst, expect: rec.expect === 'deny' ? 'deny' : 'allow' });
        break;
      case 'wifi-associated':
        if (!knownDevice(rec.client)) return { ok: false, error: 'wifi-associated check needs client (a device name)' };
        checks.push({ type: 'wifi-associated', client: rec.client as string });
        break;
      case 'dhcp-bound':
        if (!knownDevice(rec.device)) return { ok: false, error: 'dhcp-bound check needs device' };
        checks.push({ type: 'dhcp-bound', device: rec.device as string });
        break;
      case 'ospf-full':
        if (!knownDevice(rec.a) || !knownDevice(rec.b)) return { ok: false, error: 'ospf-full check needs routers a and b' };
        checks.push({ type: 'ospf-full', a: rec.a as string, b: rec.b as string });
        break;
    }
  }

  let kind: LabKind | undefined;
  if (raw.kind !== undefined) {
    if (!LAB_KINDS.includes(raw.kind as LabKind)) return { ok: false, error: `unknown lab kind "${String(raw.kind)}" (allowed: ${LAB_KINDS.join(', ')})` };
    kind = raw.kind as LabKind;
  }
  let level: LabLevel | undefined;
  if (raw.level !== undefined) {
    if (!LAB_LEVELS.includes(raw.level as LabLevel)) return { ok: false, error: `unknown lab level "${String(raw.level)}" (allowed: ${LAB_LEVELS.join(', ')})` };
    level = raw.level as LabLevel;
  }
  let topics: string[] | undefined;
  if (raw.topics !== undefined) {
    if (!isStrArray(raw.topics) || raw.topics.length > 12 || raw.topics.some((t) => !/^[a-z0-9][a-z0-9-]{0,23}$/.test(t))) {
      return { ok: false, error: 'lab.topics must be up to 12 lowercase tags (letters, digits, -)' };
    }
    topics = raw.topics;
  }
  let modelId: string | undefined;
  if (raw.modelId !== undefined) {
    if (typeof raw.modelId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(raw.modelId)) return { ok: false, error: 'lab.modelId must be a lab id' };
    modelId = raw.modelId;
  }
  let solution: LabSolution | undefined;
  if (raw.solution !== undefined) {
    const s = validateSolution(raw.solution, byName, usedPorts);
    if ('ok' in s) return s;
    solution = s.solution;
  }
  if (kind === 'exercise' && !solution) return { ok: false, error: 'an exercise lab needs a solution (summary, hints, patch)' };

  return {
    ok: true,
    lab: {
      schemaVersion: 1,
      id,
      name,
      ...(typeof raw.description === 'string' && raw.description ? { description: raw.description } : {}),
      ...(typeof raw.goal === 'string' && raw.goal ? { goal: raw.goal } : {}),
      ...(typeof raw.differsNote === 'string' && raw.differsNote ? { differsNote: raw.differsNote } : {}),
      ...(kind ? { kind } : {}),
      ...(level ? { level } : {}),
      ...(topics && topics.length ? { topics } : {}),
      ...(modelId ? { modelId } : {}),
      ...(solution ? { solution } : {}),
      devices,
      links,
      checks,
    },
  };
}

/**
 * A solution is a lab patch plus prose. Device names must exist in the lab (or be added by the patch),
 * links must use free ports, and no command may name out-of-scope tech.
 */
function validateSolution(input: unknown, byName: Map<string, LabJson['devices'][number]>, usedPorts: Set<string>): { solution: LabSolution } | Bad {
  if (!input || typeof input !== 'object') return { ok: false, error: 'lab.solution must be an object' };
  const raw = input as Record<string, unknown>;
  if (typeof raw.summary !== 'string' || !raw.summary.trim()) return { ok: false, error: 'solution.summary must be a non-empty string' };
  const hints = raw.hints === undefined ? [] : raw.hints;
  if (!isStrArray(hints) || hints.length > 8) return { ok: false, error: 'solution.hints must be up to 8 strings' };
  if (!raw.patch || typeof raw.patch !== 'object') return { ok: false, error: 'solution.patch must be an object' };
  const p = raw.patch as Record<string, unknown>;
  const patch: LabPatch = {};
  const names = new Set(byName.keys());

  if (p.addDevices !== undefined) {
    if (!Array.isArray(p.addDevices)) return { ok: false, error: 'solution.patch.addDevices must be an array' };
    patch.addDevices = [];
    for (const d of p.addDevices as unknown[]) {
      const rec = (d ?? {}) as Record<string, unknown>;
      if (!DEVICE_KINDS.includes(rec.type as DeviceKind)) return { ok: false, error: `solution adds a device of unknown type "${String(rec.type)}"` };
      if (typeof rec.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/.test(rec.name)) return { ok: false, error: 'solution.patch.addDevices entries need a valid name' };
      if (names.has(rec.name.toLowerCase())) return { ok: false, error: `solution adds ${rec.name}, which already exists` };
      names.add(rec.name.toLowerCase());
      patch.addDevices.push({
        type: rec.type as DeviceKind,
        name: rec.name,
        ...(typeof rec.x === 'number' ? { x: rec.x } : {}),
        ...(typeof rec.y === 'number' ? { y: rec.y } : {}),
      });
    }
  }
  if (p.removeDeviceIds !== undefined) {
    if (!isStrArray(p.removeDeviceIds)) return { ok: false, error: 'solution.patch.removeDeviceIds must be a string array' };
    patch.removeDeviceIds = p.removeDeviceIds;
  }
  if (p.addLinks !== undefined) {
    if (!Array.isArray(p.addLinks)) return { ok: false, error: 'solution.patch.addLinks must be an array' };
    patch.addLinks = [];
    const taken = new Set(usedPorts);
    for (const l of p.addLinks as unknown[]) {
      const rec = (l ?? {}) as Record<string, unknown>;
      const ends: string[] = [];
      for (const side of ['a', 'b'] as const) {
        const s = rec[side];
        if (typeof s !== 'string' || s.lastIndexOf(':') <= 0) return { ok: false, error: `solution link ${side} must be "Name:iface"` };
        const i = s.lastIndexOf(':');
        const devName = s.slice(0, i);
        const dev = byName.get(devName.toLowerCase());
        const added = patch.addDevices?.find((d) => d.name.toLowerCase() === devName.toLowerCase());
        const kind = dev?.kind ?? added?.type;
        if (!kind) return { ok: false, error: `solution link: unknown device in "${s}"` };
        const port = KIND_PORTS[kind].find((x) => x.toLowerCase() === s.slice(i + 1).toLowerCase());
        if (!port || port === 'wlan0') return { ok: false, error: `solution link: ${devName} has no cable port ${s.slice(i + 1)}` };
        const key = `${dev?.name ?? added!.name}:${port}`;
        if (taken.has(key)) return { ok: false, error: `solution link: port ${key} is already cabled` };
        taken.add(key);
        ends.push(key);
      }
      if (ends[0].split(':')[0] === ends[1].split(':')[0]) return { ok: false, error: `solution link ${ends[0]} — ${ends[1]} connects a device to itself` };
      let cable: CableMedia | undefined;
      if (rec.cable !== undefined) {
        if (typeof rec.cable !== 'string' || !CABLE_MEDIA.includes(rec.cable as CableMedia)) return { ok: false, error: `solution link: unknown cable "${String(rec.cable)}"` };
        cable = rec.cable as CableMedia;
      }
      patch.addLinks.push({ a: ends[0], b: ends[1], ...(cable ? { cable } : {}) });
    }
  }
  if (p.removeLinks !== undefined) {
    if (!isStrArray(p.removeLinks)) return { ok: false, error: 'solution.patch.removeLinks must be a string array' };
    patch.removeLinks = p.removeLinks;
  }
  if (p.configs !== undefined) {
    if (!Array.isArray(p.configs)) return { ok: false, error: 'solution.patch.configs must be an array' };
    patch.configs = [];
    for (const c of p.configs as unknown[]) {
      const rec = (c ?? {}) as Record<string, unknown>;
      if (typeof rec.device !== 'string' || !names.has(rec.device.toLowerCase())) return { ok: false, error: `solution config: unknown device "${String(rec.device)}"` };
      if (!isStrArray(rec.commands) || !rec.commands.length) return { ok: false, error: `solution config for ${rec.device}: commands must be a non-empty string array` };
      for (const line of rec.commands) {
        if (OUT_OF_SCOPE.test(line)) return { ok: false, error: `solution config for ${rec.device}: "${line}" — NetBench does not implement BGP/MPLS/VXLAN/802.1X` };
      }
      patch.configs.push({ device: rec.device, commands: rec.commands });
    }
  }
  if (!patch.addDevices?.length && !patch.removeDeviceIds?.length && !patch.addLinks?.length && !patch.removeLinks?.length && !patch.configs?.length) {
    return { ok: false, error: 'solution.patch must change something (configs, addLinks, …)' };
  }
  return { solution: { summary: raw.summary.trim(), hints, patch } };
}

/** Replays every startup/post line on a fresh engine and reports the ones the device CLI rejects. */
export function labStartupErrors(lab: LabJson): { device: string; line: string; error: string }[] {
  const out: { device: string; line: string; error: string }[] = [];
  const e = Engine.fromLab({ ...lab, devices: lab.devices.map((d) => ({ ...d, startup: [], post: [] })) });
  for (const d of lab.devices) {
    const dev = e.find(d.name);
    if (!dev) continue;
    for (const line of d.startup ?? []) {
      const r = e.exec(dev.id, line);
      if (r.error) out.push({ device: d.name, line, error: r.output });
    }
  }
  e.converge();
  for (const d of lab.devices) {
    const dev = e.find(d.name);
    if (!dev) continue;
    for (const line of d.post ?? []) {
      const r = e.exec(dev.id, line);
      if (r.error) out.push({ device: d.name, line, error: r.output });
    }
  }
  return out;
}
