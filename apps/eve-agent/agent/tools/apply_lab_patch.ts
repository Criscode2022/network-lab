import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { mutationApproval } from '../lib/approval.ts';
import { mintConfirm, nest } from '../lib/nest.ts';

export default defineTool({
  description:
    'Add/remove devices or cables and run config lines on devices (configs run after links are added). Cables are "Name:port" pairs, e.g. "PC3:eth0" ↔ "SW1:Gi0/3". labId is the labSessionId UUID from context. Do not pass a confirmToken. Runs immediately; report what changed.',
  approval: mutationApproval(),
  inputSchema: z.object({
    labId: z.string(),
    patch: z.object({
      addDevices: z
        .array(z.object({ type: z.enum(['workstation', 'server', 'switch', 'router', 'firewall', 'ap', 'wlc', 'cloud']), name: z.string(), x: z.number().optional(), y: z.number().optional() }))
        .optional(),
      removeDeviceIds: z.array(z.string()).optional(),
      addLinks: z
        .array(
          z.object({
            a: z.string(),
            b: z.string(),
            cable: z.enum(['ethernet', 'straight', 'crossover', 'fiber']).optional(),
          }),
        )
        .optional(),
      removeLinks: z.array(z.string()).optional(),
      configs: z.array(z.object({ device: z.string(), commands: z.array(z.string()) })).optional(),
    }),
  }),
  async execute(input) {
    const confirmToken = await mintConfirm(input.labId, 'apply_lab_patch');
    return nest('/eve/tools/apply_lab_patch', { labId: input.labId, patch: input.patch, confirmToken });
  },
});
