import { defineAgent } from 'eve';

export default defineAgent({
  description: 'Build a lab from a sentence using only the eight device types. Emits lab JSON / build_lab. Optional broken-on-purpose fault.',
  model: 'minimax/minimax-m3',
});
