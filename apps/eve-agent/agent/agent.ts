import { defineAgent } from 'eve';

export default defineAgent({
  name: 'Eve',
  model: 'anthropic/claude-sonnet-4.5',
  description: 'NetBench lab instructor for junior network and systems administrators.',
});
