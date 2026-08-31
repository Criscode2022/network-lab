import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { z } from 'zod';
import { nest } from '../lib/nest.ts';

export default defineTool({
  description: 'Run CLI commands on a node as if typed. Requires UI confirm + confirmToken.',
  approval: always(),
  inputSchema: z.object({
    labId: z.string(),
    deviceId: z.string(),
    commands: z.array(z.string()),
    confirmToken: z.string(),
  }),
  async execute(input) {
    return nest('/eve/tools/apply_device_config', input);
  },
});
