import { defineAgent } from 'eve';
import { modelConfig } from './lib/model.ts';

/** Model, fallbacks and limits live in lib/model.ts (shared with every subagent; env-overridable). */
export default defineAgent({
  ...modelConfig,
  model: modelConfig.model,
});
