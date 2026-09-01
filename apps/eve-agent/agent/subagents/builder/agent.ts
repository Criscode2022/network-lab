import { defineAgent } from 'eve';

export default defineAgent({
  description: 'Build a lab from a sentence using only the eight device types. Emits lab JSON / build_lab. Optional broken-on-purpose fault.',
  model: 'openai/gpt-5.4-mini',
});
