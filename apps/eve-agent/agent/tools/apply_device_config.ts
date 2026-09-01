import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { z } from 'zod';
import { mintConfirm, nest } from '../lib/nest.ts';

export default defineTool({
  description:
    'Run CLI commands on a node as if typed. labId is the labSessionId UUID from context. Do not pass a confirmToken — UI Approve already happened before this runs.',
  approval: always(),
  inputSchema: z.object({
    labId: z.string(),
    deviceId: z.string(),
    commands: z.array(z.string()),
  }),
  async execute(input) {
    const confirmToken = await mintConfirm(input.labId, 'apply_device_config');
    return nest('/eve/tools/apply_device_config', {
      labId: input.labId,
      deviceId: input.deviceId,
      commands: input.commands,
      confirmToken,
    });
  },
});
