import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { z } from 'zod';
import { nest } from '../lib/nest.ts';

export default defineTool({
  description: 'Add/remove devices or cables, set iface mode/SSID. Schema-validated. Requires confirmToken.',
  approval: always(),
  inputSchema: z.object({
    labId: z.string(),
    confirmToken: z.string(),
    patch: z.object({
      addDevices: z.array(z.object({ type: z.string(), name: z.string(), x: z.number().optional(), y: z.number().optional() })).optional(),
      removeDeviceIds: z.array(z.string()).optional(),
      addLinks: z.array(z.object({ a: z.string(), b: z.string() })).optional(),
      removeLinks: z.array(z.string()).optional(),
      configs: z.array(z.object({ device: z.string(), commands: z.array(z.string()) })).optional(),
    }),
  }),
  async execute(input) {
    return nest('/eve/tools/apply_lab_patch', input);
  },
});
