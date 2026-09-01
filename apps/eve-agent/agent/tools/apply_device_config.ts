import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { z } from 'zod';
import { mintConfirm, nest } from '../lib/nest.ts';

export default defineTool({
  description: 'Run CLI commands on a node as if typed. Requires UI HITL confirm.',
  approval: always(),
  inputSchema: z.object({
    labId: z.string(),
    deviceId: z.string(),
    commands: z.array(z.string()),
    confirmToken: z.string().optional(),
  }),
  async execute(input) {
    const confirmToken = input.confirmToken || (await mintConfirm(input.labId, 'apply_device_config'));
    return nest('/eve/tools/apply_device_config', { ...input, confirmToken });
  },
});
