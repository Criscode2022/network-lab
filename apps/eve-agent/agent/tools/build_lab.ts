import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { z } from 'zod';
import { mintConfirm, nest } from '../lib/nest.ts';

export default defineTool({
  description: 'Create a new lab JSON from a sentence and load it. Requires UI HITL. Palette only.',
  approval: always(),
  inputSchema: z.object({
    labId: z.string(),
    spec: z.string(),
    confirmToken: z.string().optional(),
  }),
  async execute(input) {
    const confirmToken = input.confirmToken || (await mintConfirm(input.labId, 'build_lab'));
    return nest('/eve/tools/build_lab', { ...input, confirmToken });
  },
});
