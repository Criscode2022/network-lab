import { z } from 'zod';

const deviceKind = z.enum(['workstation', 'server', 'switch', 'router', 'firewall', 'ap', 'wlc', 'cloud']);
const switchProfile = z.enum(['unmanaged', 'managed-l2', 'multilayer']);

const check = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping'), src: z.string(), dst: z.string(), family: z.enum(['v4', 'v6']).optional() }),
  z.object({ type: z.literal('ssh'), src: z.string(), dst: z.string(), expect: z.enum(['allow', 'deny']) }),
  z.object({ type: z.literal('wifi-associated'), client: z.string() }),
  z.object({ type: z.literal('dhcp-bound'), device: z.string() }),
  z.object({ type: z.literal('ospf-full'), a: z.string(), b: z.string() }),
]);

const deviceName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/);

/** Same shape as apply_lab_patch: what to add/remove/configure to fix an exercise. */
const solutionPatch = z.object({
  addDevices: z.array(z.object({ type: deviceKind, switchProfile: switchProfile.optional(), name: deviceName, x: z.number().optional(), y: z.number().optional() })).max(10).optional(),
  removeDeviceIds: z.array(z.string()).max(10).optional(),
  addLinks: z.array(z.object({ a: z.string(), b: z.string(), cable: z.enum(['ethernet', 'straight', 'crossover', 'fiber']).optional() })).max(20).optional(),
  removeLinks: z.array(z.string()).max(20).optional(),
  configs: z.array(z.object({ device: z.string(), commands: z.array(z.string()).min(1).max(40) })).max(20).optional(),
  setSwitchProfiles: z.array(z.object({ device: z.string(), switchProfile })).max(10).optional(),
});

/**
 * Full lab JSON the builder may hand to build_lab. Mirrors packages/engine LabJson; Nest re-validates
 * ports, duplicates and out-of-scope config and reports startup lines the device CLIs reject.
 */
export const labJsonSchema = z.object({
  name: z.string().min(1).max(80),
  goal: z.string().max(400).optional(),
  description: z.string().max(400).optional(),
  /** model (default): passes Check as shipped. exercise: ships broken and MUST carry a solution. */
  kind: z.enum(['model', 'exercise']).optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
  topics: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/)).max(12).optional(),
  /** Exercise only: the official fix (applying `patch` to the shipped lab makes every check pass). */
  solution: z
    .object({
      summary: z.string().min(1).max(600),
      hints: z.array(z.string().max(300)).max(8),
      patch: solutionPatch,
    })
    .optional(),
  devices: z
    .array(
      z.object({
        kind: deviceKind,
        /** Only for kind=switch. Absent keeps backward-compatible managed Layer 2 behavior. */
        switchProfile: switchProfile.optional(),
        name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/),
        x: z.number().optional(),
        y: z.number().optional(),
        hostname: z.string().optional(),
        /** CLI lines run at boot (Linux `ip …`, Cisco `enable`, `conf t`, …, `end`). */
        startup: z.array(z.string()).optional(),
        /** Lines run after every device booted (nmcli wifi connect, dhclient). */
        post: z.array(z.string()).optional(),
      }),
    )
    .min(1)
    .max(40),
  links: z.array(z.object({ a: z.string(), b: z.string(), cable: z.enum(['ethernet', 'straight', 'crossover', 'fiber']).optional() })).max(80),
  checks: z.array(check).max(12).optional(),
});

export type LabJsonInput = z.infer<typeof labJsonSchema>;
