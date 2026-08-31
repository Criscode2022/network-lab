import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { z } from 'zod';
import { nest } from '../lib/nest.ts';

export default defineTool({
  description: 'Create a new lab JSON from a sentence and load it. Requires confirmToken. Palette only.',
  approval: always(),
  inputSchema: z.object({
    labId: z.string(),
    spec: z.string(),
    confirmToken: z.string(),
  }),
  async execute(input) {
    return nest('/eve/tools/build_lab', input);
  },
});
