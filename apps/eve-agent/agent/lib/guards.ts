/**
 * Input guards for mutating tools. They run before any network call so a bad model output costs nothing and the
 * message the model gets back says exactly what to change.
 */

/** Product scope: NetBench is a junior-admin lab. The API refuses these too, but failing early keeps the turn short. */
const OUT_OF_SCOPE = /\b(router bgp|neighbor .* remote-as|mpls|vxlan|nve|evpn|dot1x|radius-server|isis|eigrp)\b/i;

/** Commands that wipe or reboot a device — never something Eve should run unattended. */
const DESTRUCTIVE_CLI = /^(write erase|erase (startup-config|nvram)|reload|delete (flash|nvram)|format |rm -rf \/|mkfs|dd if=)/i;

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardError';
  }
}

const isUuidLike = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** labId must look like a session UUID, an engine lab id or a browser labKey — not a placeholder the model invented. */
export function guardLabId(labId: string): string {
  const id = labId.trim();
  if (!id || /^(labId|lab-?session-?id|<.*>|\{.*\}|undefined|null|string)$/i.test(id)) {
    throw new GuardError('labId is missing or a placeholder. Copy labSessionId from the newest [NetBench context] block.');
  }
  if (!isUuidLike(id) && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,80}$/.test(id)) {
    throw new GuardError(`labId "${id}" is not a session id, lab id or labKey. Use labSessionId from the newest [NetBench context] block.`);
  }
  return id;
}

/** Normalises CLI lines (trim, drop blanks) and rejects out-of-scope or destructive commands. */
export function guardCommands(commands: readonly string[]): string[] {
  const lines = commands.map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new GuardError('commands is empty after trimming — pass at least one CLI line.');
  if (lines.length > 60) throw new GuardError('commands has more than 60 lines — split the change into smaller apply_device_config calls.');
  for (const line of lines) {
    if (OUT_OF_SCOPE.test(line)) {
      throw new GuardError(`"${line}" is out of NetBench scope (no BGP/MPLS/VXLAN/802.1X/EIGRP). Use static routes or OSPF area 0.`);
    }
    if (DESTRUCTIVE_CLI.test(line)) {
      throw new GuardError(`"${line}" would wipe or reboot the device; NetBench never runs that unattended. Undo the specific lines instead (e.g. "no ip route …").`);
    }
    if (line.length > 400) throw new GuardError('a command line is longer than 400 characters — that is not a CLI line.');
  }
  return lines;
}

export interface PatchLike {
  addDevices?: readonly { name: string }[];
  removeDeviceIds?: readonly string[];
  addLinks?: readonly { a: string; b: string }[];
  removeLinks?: readonly string[];
  configs?: readonly { device: string; commands: readonly string[] }[];
}

/** A patch must do something, stay within lab limits and not contain out-of-scope config. Returns the patch with cleaned commands. */
export function guardPatch<T extends PatchLike>(patch: T): T {
  const ops =
    (patch.addDevices?.length ?? 0) +
    (patch.removeDeviceIds?.length ?? 0) +
    (patch.addLinks?.length ?? 0) +
    (patch.removeLinks?.length ?? 0) +
    (patch.configs?.length ?? 0);
  if (!ops) throw new GuardError('patch is empty — add devices, cables or configs, or use apply_device_config for a single device.');
  if ((patch.addDevices?.length ?? 0) > 40) throw new GuardError('addDevices exceeds 40 devices — NetBench labs hold at most 40 devices.');
  const seen = new Set<string>();
  for (const d of patch.addDevices ?? []) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/.test(d.name)) throw new GuardError(`device name "${d.name}" is invalid (letters, digits, - and _, max 24 chars).`);
    if (seen.has(d.name.toLowerCase())) throw new GuardError(`device name "${d.name}" is duplicated in addDevices.`);
    seen.add(d.name.toLowerCase());
  }
  for (const l of patch.addLinks ?? []) {
    if (!/^[^:\s]+:\S+$/.test(l.a) || !/^[^:\s]+:\S+$/.test(l.b)) {
      throw new GuardError(`cable "${l.a}" ↔ "${l.b}" must use "Name:port" on both ends, e.g. "PC1:eth0" ↔ "SW1:Gi0/1".`);
    }
  }
  if (!patch.configs) return patch;
  return { ...patch, configs: patch.configs.map((c) => ({ ...c, commands: guardCommands(c.commands) })) };
}

/** Reason a patch is destructive (used by the `dangerous` approval mode). */
export function patchDanger(patch: PatchLike): string | undefined {
  if (patch.removeDeviceIds?.length) return `removes ${patch.removeDeviceIds.length} device(s)`;
  if ((patch.removeLinks?.length ?? 0) > 2) return `removes ${patch.removeLinks!.length} cables`;
  return undefined;
}
