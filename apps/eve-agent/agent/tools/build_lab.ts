import { defineTool } from 'eve/tools';
import { always } from 'eve/tools/approval';
import { z } from 'zod';
import { mintConfirm, nest } from '../lib/nest.ts';

export default defineTool({
  description:
    'Create a new lab from a sentence and load it. labId is the labSessionId UUID from context (not the lab name). Do not pass a confirmToken — UI Approve already happened before this runs. Palette only; large offices become a small representative topology.',
  approval: always(),
  inputSchema: z.object({
    labId: z.string(),
    spec: z.string(),
  }),
  async execute(input) {
    const confirmToken = await mintConfirm(input.labId, 'build_lab');
    return nest('/eve/tools/build_lab', { labId: input.labId, spec: input.spec, confirmToken });
  },
});
