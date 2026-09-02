import { defineAgent } from 'eve';
import { modelConfig } from '../../lib/model.ts';

export default defineAgent({
  description: 'Explain why a ping, OSPF neighbor, or packet failed. Read-only: get_lab_state, get_path, get_device, list_commands.',
  ...modelConfig,
  model: modelConfig.model,
});
