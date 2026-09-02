import { defineState } from 'eve/context';

/**
 * Position in the model chain for one durable session, plus the bookkeeping the fallback hook needs.
 * Written by lib/model-fallback-hook.ts, read by the dynamic model resolver in lib/model.ts.
 */
export interface ModelFallbackState {
  /** Index into MODEL_CHAIN currently in use. */
  index: number;
  /** Model id the last started step ran on (from step.started). */
  activeModel: string;
  /** Model failures seen in this session (never reset; diagnostics only). */
  failures: number;
  /** Epoch ms of the last model failure that moved the index. */
  lastFailureAt: number;
  /** eve failure code of that failure (MODEL_CALL_FAILED, …). */
  lastCode: string;
  /** Model id that failed last. */
  lastFailedModel: string;
  /** Turn id of the last failure handled, so step.failed + turn.failed for one turn count once. */
  lastHandledTurn: string;
}

export const initialModelState = (): ModelFallbackState => ({
  index: 0,
  activeModel: '',
  failures: 0,
  lastFailureAt: 0,
  lastCode: '',
  lastFailedModel: '',
  lastHandledTurn: '',
});

export const modelState = defineState<ModelFallbackState>('netbench.model-fallback', initialModelState);

/**
 * Process-wide hint: the chain position that last worked in this Node process. Durable state is per session and never
 * shared with subagents, so without this every new (sub)session would start at the primary again while it is down.
 * Best effort only — a cold start forgets it, which is fine because the durable state takes over per session.
 */
export const processHint: { index: number; at: number } = { index: 0, at: 0 };
