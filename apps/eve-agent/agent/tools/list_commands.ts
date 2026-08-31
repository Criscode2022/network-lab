import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { nest } from '../lib/nest.ts';

export default defineTool({
  description: 'Allowed CLI for a device type so you never teach a command the terminal will reject.',
  inputSchema: z.object({
    deviceType: z.enum(['workstation', 'server', 'switch', 'router', 'firewall', 'ap', 'wlc', 'cloud']),
  }),
  async execute({ deviceType }) {
    return nest('/eve/tools/list_commands', { deviceType });
  },
});
