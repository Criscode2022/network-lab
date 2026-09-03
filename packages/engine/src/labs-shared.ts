import type { LabJson, LabPatch } from './types.ts';

/** `enable`, `conf t`, …body, `end` — the shape every Cisco startup block in the curriculum uses. */
export const cisco = (...body: string[]): string[] => ['enable', 'conf t', ...body, 'end'];

/** Switch with ports Gi0/1..Gi0/n enabled, no VLANs (plain L2). */
export const swPorts = (n: number): string[] => cisco(...Array.from({ length: n }, (_, i) => [`int Gi0/${i + 1}`, 'no shut']).flat());
export const SW_TWO_PORTS = swPorts(2);

/** Linux host with one address, link up and (optionally) a default gateway. */
export const linuxHost = (cidr: string, gw?: string, ...extra: string[]): string[] => [
  `ip addr add ${cidr} dev eth0`,
  'ip link set eth0 up',
  ...(gw ? [`ip route add default via ${gw}`] : []),
  ...extra,
];

/** Access port in a VLAN, enabled. */
export const access = (port: string, vlan: number): string[] => [`int ${port}`, 'switchport mode access', `switchport access vlan ${vlan}`, 'no shut'];
/** 802.1Q trunk carrying the given VLANs, enabled. */
export const trunk = (port: string, vlans: number[]): string[] => [`int ${port}`, 'switchport mode trunk', `switchport trunk allowed vlan ${vlans.join(',')}`, 'no shut'];
/** Router-on-a-stick sub-interface. */
export const subif = (port: string, vlan: number, ip: string, mask = '255.255.255.0'): string[] => [`int ${port}.${vlan}`, `encapsulation dot1Q ${vlan}`, `ip address ${ip} ${mask}`];

/** Commands the engine only accepts once every device has booted (they need a peer to answer). */
const POST_ONLY = /^(nmcli\s+wifi\s+connect|dhclient)\b/;

/**
 * Bakes an exercise's solution into its startup config and returns the working topology as a model lab.
 * Only additive solutions (configs / addLinks / addDevices) can be derived; removals throw so nobody ships
 * a "model" whose config literally contains `no ip route …` clean-ups.
 */
export function modelFromExercise(
  exercise: LabJson,
  meta: { id: string; name: string; goal: string; description?: string; level?: LabJson['level']; topics?: string[] },
): LabJson {
  const sol = exercise.solution;
  if (!sol) throw new Error(`${exercise.id}: cannot derive a model from an exercise without a solution`);
  const patch: LabPatch = sol.patch;
  if (patch.removeDeviceIds?.length || patch.removeLinks?.length) throw new Error(`${exercise.id}: derive only supports additive solutions`);
  const devices = exercise.devices.map((d) => ({ ...d, startup: [...(d.startup ?? [])], ...(d.post ? { post: [...d.post] } : {}) }));
  for (const add of patch.addDevices ?? []) {
    devices.push({
      kind: add.type,
      ...(add.switchProfile ? { switchProfile: add.switchProfile } : {}),
      name: add.name,
      x: add.x ?? 80,
      y: add.y ?? 80,
      startup: [],
    });
  }
  for (const cfg of patch.configs ?? []) {
    const dev = devices.find((d) => d.name.toLowerCase() === cfg.device.toLowerCase());
    if (!dev) throw new Error(`${exercise.id}: solution configures unknown device ${cfg.device}`);
    for (const line of cfg.commands) {
      if (POST_ONLY.test(line)) {
        dev.post = [...(dev.post ?? []).filter((l) => l !== line), line];
      } else dev.startup.push(line);
    }
  }
  const { solution: _solution, modelId: _modelId, ...rest } = exercise;
  void _solution;
  void _modelId;
  return {
    ...rest,
    id: meta.id,
    name: meta.name,
    goal: meta.goal,
    ...(meta.description ? { description: meta.description } : {}),
    kind: 'model',
    level: meta.level ?? exercise.level,
    topics: meta.topics ?? exercise.topics,
    devices,
    links: [...exercise.links, ...(patch.addLinks ?? [])],
  };
}
