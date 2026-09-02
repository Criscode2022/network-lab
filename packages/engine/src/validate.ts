import { CABLE_MEDIA } from './cables.ts';
import { Engine } from './engine.ts';
import { DEVICE_KINDS, KIND_PORTS, type CableMedia, type DeviceKind, type LabCheck, type LabJson } from './types.ts';

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

  return {
    ok: true,
    lab: {
      schemaVersion: 1,
      id,
      name,
      ...(typeof raw.description === 'string' && raw.description ? { description: raw.description } : {}),
      ...(typeof raw.goal === 'string' && raw.goal ? { goal: raw.goal } : {}),
      ...(typeof raw.differsNote === 'string' && raw.differsNote ? { differsNote: raw.differsNote } : {}),
      devices,
      links,
      checks,
    },
  };
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
