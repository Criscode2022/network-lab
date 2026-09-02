import { defineHook } from 'eve/hooks';
import { MODEL_CHAIN, clampIndex } from './model.ts';
import { modelState, processHint } from './model-state.ts';

/**
 * Eve-level model rotation. Re-exported as `hooks/model-fallback.ts` by the root agent and every subagent (subagent
 * hooks only fire inside their own scope).
 *
 *  - step.started   → remember which model the step runs on.
 *  - step.failed / turn.failed with a model failure code → advance the durable chain index; the next step (eve's own
 *    retry or the client's re-send) resolves the next model via lib/model.ts.
 *  - step.completed → confirm the model that worked (also ends a primary recovery attempt successfully).
 *
 * Hooks that throw fail the turn, so every handler swallows its own errors.
 */

/** eve failure codes that mean "the model call itself failed" (provider, gateway, quota, empty response…). */
const MODEL_FAILURE_CODES = new Set(['MODEL_CALL_FAILED', 'MODEL_STREAM_FAILED', 'EMPTY_MODEL_RESPONSE']);

const isModelFailure = (code: string) => MODEL_FAILURE_CODES.has(code) || /MODEL|PROVIDER|GATEWAY|UPSTREAM/i.test(code);

const indexOf = (model: string) => MODEL_CHAIN.indexOf(model);

function onModelFailure(turnId: string, code: string, message: string, agent: string): void {
  try {
    const s = modelState.get();
    if (s.lastHandledTurn === turnId && s.lastCode === code) return;

    const failedModel = s.activeModel || MODEL_CHAIN[clampIndex(s.index)]!;
    const failedIndex = indexOf(failedModel) === -1 ? clampIndex(s.index) : indexOf(failedModel);
    // A failed primary-recovery attempt goes back to the fallback that was working, not to the next in line.
    const next = failedIndex === 0 && s.index > 0 ? clampIndex(s.index) : (failedIndex + 1) % MODEL_CHAIN.length;
    const now = Date.now();

    modelState.update((cur) => ({
      ...cur,
      index: next,
      failures: cur.failures + 1,
      lastFailureAt: now,
      lastCode: code,
      lastFailedModel: failedModel,
      lastHandledTurn: turnId,
    }));
    processHint.index = next;
    processHint.at = now;

    console.warn(
      `[eve:${agent}] model ${failedModel} failed (${code}: ${message.slice(0, 200)}); ` +
        `switching to ${MODEL_CHAIN[next]} (${next + 1}/${MODEL_CHAIN.length})`,
    );
  } catch (err) {
    console.warn('[eve] model-fallback hook could not record failure', err);
  }
}

export const modelFallbackHook = defineHook({
  events: {
    'step.started'(event) {
      try {
        const model = event.data.modelId;
        modelState.update((cur) => (cur.activeModel === model ? cur : { ...cur, activeModel: model }));
      } catch {
        // observe-only
      }
    },
    'step.completed'(event, ctx) {
      try {
        const s = modelState.get();
        const k = indexOf(s.activeModel);
        if (k === -1 || k === s.index) return;
        modelState.update((cur) => ({ ...cur, index: k }));
        if (k === 0) {
          processHint.index = 0;
          processHint.at = 0;
          console.info(`[eve:${ctx.agent.name}] primary model ${s.activeModel} recovered (turn ${event.data.turnId})`);
        }
      } catch {
        // observe-only
      }
    },
    'step.failed'(event, ctx) {
      if (isModelFailure(event.data.code)) onModelFailure(event.data.turnId, event.data.code, event.data.message, ctx.agent.name);
    },
    'turn.failed'(event, ctx) {
      if (isModelFailure(event.data.code)) onModelFailure(event.data.turnId, event.data.code, event.data.message, ctx.agent.name);
    },
  },
});

export default modelFallbackHook;
