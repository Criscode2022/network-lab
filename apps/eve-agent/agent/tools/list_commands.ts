import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { nest } from '../lib/nest.ts';

export default defineTool({
  description: 'Allowed CLI for a device type so you never teach a command the terminal will reject.',
  inputSchema: z.object({
    deviceType: z.enum(['workstation', 'server', 'switch', 'router', 'firewall', 'ap', 'wlc', 'cloud']),
    switchProfile: z.enum(['unmanaged', 'managed-l2', 'multilayer']).optional(),
  }),
  async execute({ deviceType, switchProfile }) {
    return nest('/eve/tools/list_commands', { deviceType, switchProfile });
  },
});
