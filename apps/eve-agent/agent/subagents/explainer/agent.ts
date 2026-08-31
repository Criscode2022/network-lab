import { defineAgent } from 'eve';

export default defineAgent({
  description: 'Explain why a ping, OSPF neighbor, or packet failed. Read-only: get_lab_state, get_path, get_device, list_commands.',
  model: 'anthropic/claude-sonnet-4.5',
});
