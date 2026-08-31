import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { nest } from '../lib/nest.ts';

export default defineTool({
  description: 'Read devices, links, wifi associations, iface up/down, addressing, VLAN mode, OSPF neighbors, last check.',
  inputSchema: z.object({ labId: z.string() }),
  async execute({ labId }) {
    return nest('/eve/tools/get_lab_state', { labId });
  },
});
