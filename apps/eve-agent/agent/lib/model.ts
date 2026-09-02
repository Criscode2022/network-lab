import { defineDynamic } from 'eve';
import { modelState, processHint } from './model-state.ts';

/**
 * Model selection for Eve and her subagents.
 *
 * Two layers of fallback:
 *  1. AI Gateway routing — every call carries `providerOptions.gateway.models`, so a provider error is retried by the
 *     gateway on the next model in the chain within the same request.
 *  2. Eve-level rotation — when a step still fails (gateway down, quota, model removed, malformed tool calls…) the
 *     hook in agent/hooks/model-fallback.ts advances the durable per-session index and the dynamic resolver below
 *     picks the next model for the retried step. Primary is retried again after EVE_MODEL_RECOVER_MS.
 *
 * Overrides: EVE_MODEL (primary), EVE_FALLBACK_MODELS (comma list), EVE_CONTEXT_TOKENS (cap),
 * EVE_MODEL_RECOVER_MINUTES.
 */

const DEFAULT_MODEL = 'minimax/minimax-m3';

/** Different providers on purpose, so a single vendor outage never empties the chain. All support tool calling. */
const DEFAULT_FALLBACKS = [
  'openai/gpt-5.6-luna',
  'google/gemini-3.7-flash',
  'zai/glm-5.3-flash',
  'deepseek/deepseek-v4-flash',
  'openai/gpt-5.4-mini',
];

/** Context windows from the AI Gateway catalog (tokens). Unknown ids fall back to EVE_CONTEXT_TOKENS. */
const CONTEXT_WINDOW: Record<string, number> = {
  'minimax/minimax-m3': 512_000,
  'minimax/minimax-m3-free': 1_048_576,
  'minimax/minimax-m2.7': 204_800,
  'openai/gpt-5.6-luna': 1_050_000,
  'openai/gpt-5.6-luna-fast': 1_050_000,
  'openai/gpt-5.4-mini': 400_000,
  'openai/gpt-5.4-nano': 400_000,
  'openai/gpt-4.1-mini': 1_047_576,
  'google/gemini-3.7-flash': 1_000_000,
  'google/gemini-3.5-flash': 1_000_000,
  'google/gemini-3.5-flash-lite': 1_000_000,
  'google/gemini-2.5-flash': 1_000_000,
  'zai/glm-5.3-flash': 1_000_000,
  'zai/glm-5.1': 200_000,
  'deepseek/deepseek-v4-flash': 1_000_000,
  'deepseek/deepseek-v4-pro': 1_000_000,
};

const list = (raw: string | undefined) =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const EVE_MODEL = process.env.EVE_MODEL?.trim() || DEFAULT_MODEL;

const fallbacks = process.env.EVE_FALLBACK_MODELS === undefined ? DEFAULT_FALLBACKS : list(process.env.EVE_FALLBACK_MODELS);

/** Primary first, then fallbacks, no duplicates. Never empty. */
export const MODEL_CHAIN: readonly string[] = [...new Set([EVE_MODEL, ...fallbacks])];

/** Upper bound for the context window Eve assumes (keeps compaction sane for huge-window models). */
export const EVE_CONTEXT_TOKENS = Math.max(32_000, Number(process.env.EVE_CONTEXT_TOKENS) || 200_000);

/** After this long on a fallback model, the session tries the primary again. */
export const EVE_MODEL_RECOVER_MS = Math.max(1, Number(process.env.EVE_MODEL_RECOVER_MINUTES) || 15) * 60_000;

export const contextWindowFor = (model: string): number => Math.min(CONTEXT_WINDOW[model] ?? EVE_CONTEXT_TOKENS, EVE_CONTEXT_TOKENS);

export const clampIndex = (i: number): number => (Number.isFinite(i) && i > 0 ? Math.min(Math.trunc(i), MODEL_CHAIN.length - 1) : 0);

export interface ModelSelection {
  model: string;
  modelContextWindowTokens: number;
  modelOptions: { providerOptions: { gateway: { models: readonly string[] } } };
}

/** Selection for chain position `index`; gateway fallbacks are the rest of the chain, wrapping around. */
export function modelSelection(index: number): ModelSelection {
  const i = clampIndex(index);
  const model = MODEL_CHAIN[i]!;
  const rest = [...MODEL_CHAIN.slice(i + 1), ...MODEL_CHAIN.slice(0, i)];
  return {
    model,
    modelContextWindowTokens: contextWindowFor(model),
    modelOptions: { providerOptions: { gateway: { models: rest } } },
  };
}

const hintFresh = () => processHint.at > 0 && Date.now() - processHint.at < EVE_MODEL_RECOVER_MS;

/** Chain position for the current session: durable state, else the process-wide hint, else the primary. */
export function currentIndex(): number {
  let s: ReturnType<typeof modelState.get> | undefined;
  try {
    s = modelState.get();
  } catch {
    // Outside an eve session context (e.g. compile-time evaluation): no durable state to read.
  }
  if (s && s.failures > 0) {
    if (s.index > 0 && Date.now() - s.lastFailureAt >= EVE_MODEL_RECOVER_MS) return 0;
    return clampIndex(s.index);
  }
  return hintFresh() ? clampIndex(processHint.index) : 0;
}

const resolve = () => modelSelection(currentIndex());

/** Dynamic model: re-evaluated for every step so a mid-turn failure switches model for the retried step. */
export const dynamicModel = defineDynamic({
  events: {
    'session.started': resolve,
    'turn.started': resolve,
    'step.started': resolve,
  },
});

/** Shared agent config: dynamic model, earlier compaction than eve's 0.9 default, no per-session token ceiling. */
export const modelConfig = {
  model: dynamicModel,
  compaction: { thresholdPercent: 0.8 },
  limits: { maxInputTokensPerSession: false as const, maxOutputTokensPerSession: false as const },
} as const;
