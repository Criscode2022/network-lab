import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { nest } from '../lib/nest.ts';

export default defineTool({
  description: 'Pulse the named devices on the canvas.',
  inputSchema: z.object({ labId: z.string(), deviceIds: z.array(z.string()) }),
  async execute(input) {
    return nest('/eve/tools/highlight_devices', input);
  },
});
