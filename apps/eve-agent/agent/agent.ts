import { defineAgent } from 'eve';

/** MiniMax M3 is the default. Keep cheap Gateway fallbacks if M3 is unavailable. Do not set Claude Sonnet — free-tier AI Gateway returns MODEL_CALL_FAILED. */
export default defineAgent({
  model: 'minimax/minimax-m3',
  modelOptions: {
    providerOptions: {
      gateway: {
        models: ['minimax/minimax-m3', 'openai/gpt-5.4-mini', 'google/gemini-2.5-flash', 'openai/gpt-4.1-mini'],
      },
    },
  },
});
