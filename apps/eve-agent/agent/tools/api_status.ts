import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { API, RETRIES, TIMEOUT_MS, apiHealth, nest } from '../lib/nest.ts';
import { MODEL_CHAIN, currentIndex } from '../lib/model.ts';

/**
 * Read-only diagnostics: is the NetBench API reachable, which build is it, does it know this lab session, and which
 * model is Eve running on. Lets Eve say "the platform is down" or "your lab session expired" instead of guessing.
 */
export default defineTool({
  description:
    'Check whether the NetBench API is reachable and which build it runs, whether the given labId still resolves to a live lab session, and which AI model Eve is currently using. Call this when a tool fails with a network, 404 or 5xx error before telling the user what is wrong.',
  inputSchema: z.object({
    labId: z.string().optional().describe('labSessionId from the newest [NetBench context] block, to check the session too'),
  }),
  async execute({ labId }) {
    const health = await apiHealth(true);
    let session: { ok: boolean; detail: string; labId?: string; devices?: number } = { ok: false, detail: 'not checked (no labId)' };
    if (labId && health.ok) {
      try {
        const st = await nest<{ labId?: string; devices?: unknown[] }>('/eve/tools/get_lab_state', { labId });
        session = { ok: true, detail: 'session is live', labId: st.labId, devices: Array.isArray(st.devices) ? st.devices.length : undefined };
      } catch (e) {
        session = { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    } else if (labId) {
      session = { ok: false, detail: 'skipped: API unhealthy' };
    }
    const idx = currentIndex();
    // An API whose /api/health lacks the eveTools flag predates this agent: it has no /eve/tools/confirm route and
    // cannot resolve the browser labKey the UI now sends as labSessionId, so mutations 404 and the session looks gone.
    const outdated = health.ok && health.eveTools !== true;
    return {
      api: { url: API, ...health, retriesPerCall: RETRIES, timeoutMs: TIMEOUT_MS },
      session,
      model: { current: MODEL_CHAIN[idx], position: `${idx + 1}/${MODEL_CHAIN.length}`, chain: MODEL_CHAIN },
      verdict: !health.ok
        ? 'The NetBench API is down or unreachable — this is a platform problem, not a lab problem. Tell the user to retry in a minute.'
        : outdated
          ? 'The NetBench API is up but running an older build than this Eve agent: it lacks /api/eve/tools/confirm and labKey session resolution, so every mutating tool returns 404 and the lab session reports "not found". This is one deployment problem — the operator must redeploy apps/api from main (then /api/health shows eveTools: true). Reloading the lab in the UI will not help; say exactly that and do not retry.'
          : labId && !session.ok
            ? 'The API is up but this lab session is gone (expired or the API restarted). Re-read labSessionId from the newest [NetBench context] block; the UI recreates the session automatically.'
            : 'Everything is reachable. If a tool still fails, the problem is in the request content (see the error message).',
    };
  },
});
