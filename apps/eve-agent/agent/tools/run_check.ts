import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { nest } from '../lib/nest.ts';

export default defineTool({
  description: 'Run built-in lab assertions or report ping failures with exact reasons.',
  inputSchema: z.object({ labId: z.string() }),
  async execute({ labId }) {
    return nest('/eve/tools/run_check', { labId });
  },
});
