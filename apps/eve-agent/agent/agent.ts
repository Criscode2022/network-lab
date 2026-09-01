import { defineAgent } from 'eve';

/** Free-tier AI Gateway rejects Claude Sonnet; mini is in the product palette and allowed. */
export default defineAgent({
  model: 'openai/gpt-5.4-mini',
  modelOptions: {
    providerOptions: {
      gateway: {
        models: ['openai/gpt-5.4-mini', 'google/gemini-2.5-flash', 'openai/gpt-4.1-mini'],
      },
    },
  },
});
