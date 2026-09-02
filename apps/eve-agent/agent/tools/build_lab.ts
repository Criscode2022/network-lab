import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { mutationApproval } from '../lib/approval.ts';
import { labJsonSchema } from '../lib/lab-schema.ts';
import { mintConfirm, nest } from '../lib/nest.ts';

export default defineTool({
  description:
    'Replace the current lab with a new one. Two modes: `spec` (a short sentence, e.g. "two VLANs, one router, wifi on VLAN 20") for quick small labs, or `lab` (full lab JSON: devices with startup config, links as "Name:port", checks) for anything specific or large — up to 40 devices, multiple VLANs, several routers, OSPF area 0, NAT, firewall, Wi-Fi. labId is the labSessionId UUID from context. Do not pass confirmToken. Returns the built lab, `check` (immediate result), and `startupErrors` (lines a device CLI rejected — fix and rebuild if any).',
  approval: mutationApproval(),
  inputSchema: z.object({
    labId: z.string(),
    spec: z.string().optional(),
    lab: labJsonSchema.optional(),
  }),
  async execute(input) {
    if (!input.spec && !input.lab) throw new Error('Pass either spec (a sentence) or lab (full lab JSON).');
    const confirmToken = await mintConfirm(input.labId, 'build_lab');
    return nest('/eve/tools/build_lab', { labId: input.labId, spec: input.spec, lab: input.lab, confirmToken });
  },
});
