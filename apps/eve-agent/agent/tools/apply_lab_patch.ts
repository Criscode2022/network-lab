import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { z } from 'zod';
import { mintConfirm, nest } from '../lib/nest.ts';

export default defineTool({
  description:
    'Add/remove devices or cables, set iface mode/SSID. labId is the labSessionId UUID from context. Do not pass a confirmToken — UI Approve already happened before this runs.',
  approval: always(),
  inputSchema: z.object({
    labId: z.string(),
    patch: z.object({
      addDevices: z.array(z.object({ type: z.string(), name: z.string(), x: z.number().optional(), y: z.number().optional() })).optional(),
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
