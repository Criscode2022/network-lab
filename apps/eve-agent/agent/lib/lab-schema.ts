import { z } from 'zod';

const deviceKind = z.enum(['workstation', 'server', 'switch', 'router', 'firewall', 'ap', 'wlc', 'cloud']);

const check = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping'), src: z.string(), dst: z.string(), family: z.enum(['v4', 'v6']).optional() }),
  z.object({ type: z.literal('ssh'), src: z.string(), dst: z.string(), expect: z.enum(['allow', 'deny']) }),
  z.object({ type: z.literal('wifi-associated'), client: z.string() }),
  z.object({ type: z.literal('dhcp-bound'), device: z.string() }),
  z.object({ type: z.literal('ospf-full'), a: z.string(), b: z.string() }),
]);

/**
 * Full lab JSON the builder may hand to build_lab. Mirrors packages/engine LabJson; Nest re-validates
 * ports, duplicates and out-of-scope config and reports startup lines the device CLIs reject.
 */
export const labJsonSchema = z.object({
  name: z.string().min(1).max(80),
  goal: z.string().max(400).optional(),
  description: z.string().max(400).optional(),
  devices: z
    .array(
      z.object({
        kind: deviceKind,
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
