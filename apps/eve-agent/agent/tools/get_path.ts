import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { nest } from '../lib/nest.ts';

export default defineTool({
  description: "Engine's real forwarding path or the drop reason (same reason as the packet inspector).",
  inputSchema: z.object({
    labId: z.string(),
    src: z.string(),
    dst: z.string(),
    proto: z.string().default('icmp'),
    family: z.enum(['v4', 'v6']).default('v4'),
  }),
  async execute(input) {
    return nest('/eve/tools/get_path', input);
  },
});
