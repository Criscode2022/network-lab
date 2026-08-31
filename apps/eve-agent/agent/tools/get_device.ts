import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { nest } from '../lib/nest.ts';

export default defineTool({
  description: 'Running-config, startup-config, ARP/NDP, MAC table, wifi association for one node.',
  inputSchema: z.object({ labId: z.string(), deviceId: z.string() }),
  async execute(input) {
    return nest('/eve/tools/get_device', input);
  },
});
