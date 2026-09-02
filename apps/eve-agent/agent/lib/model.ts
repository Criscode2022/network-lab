/**
 * One model configuration for the root agent and every subagent.
 *
 * Primary: MiniMax M3. Fallbacks are cheap Gateway models tried in order when the primary is unavailable
 * or the call fails. Override without a redeploy: EVE_MODEL, EVE_FALLBACK_MODELS (comma-separated).
 * Do not add anthropic/claude-sonnet-4.5 — the free-tier AI Gateway returns MODEL_CALL_FAILED for it.
 */
const DEFAULT_MODEL = 'minimax/minimax-m3';
const DEFAULT_FALLBACKS = ['openai/gpt-5.4-mini', 'google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite', 'openai/gpt-4.1-mini'];

export const EVE_MODEL = process.env.EVE_MODEL?.trim() || DEFAULT_MODEL;

const fallbacks = (process.env.EVE_FALLBACK_MODELS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const chain = [EVE_MODEL, ...(fallbacks.length ? fallbacks : DEFAULT_FALLBACKS)].filter((m, i, a) => a.indexOf(m) === i);

/** Context window assumed for the primary model when the Gateway lookup is unavailable (tokens). */
export const EVE_CONTEXT_TOKENS = Number(process.env.EVE_CONTEXT_TOKENS) || 200_000;

export const modelConfig = {
  model: EVE_MODEL,
  modelContextWindowTokens: EVE_CONTEXT_TOKENS,
  modelOptions: {
    providerOptions: {
      gateway: {
        // Ordered fallback list: the Gateway moves to the next entry when a call fails.
        models: chain,
      },
    },
  },
  // Summarise older turns a little earlier than eve's 0.9 default so long troubleshooting sessions keep room for tool output.
  compaction: { thresholdPercent: 0.8 },
  // Long labs generate many tool calls; do not cap a session on tokens (the 30-day session timeout still applies).
  limits: { maxInputTokensPerSession: false as const, maxOutputTokensPerSession: false as const },
} as const;
