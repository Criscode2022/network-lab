import { always, never, once } from 'eve/tools/approval';
import type { ApprovalPolicy } from 'eve/tools/approval';

/**
 * Approval policy for mutating tools (apply_lab_patch, apply_device_config, build_lab).
 *
 * EVE_APPROVAL selects the mode (EVE_REQUIRE_APPROVAL=1 still means `always`):
 *   auto      (default) never pause — the user asked for everything except questions to run unattended. Every change
 *             is still authorised server-side by a one-time confirmToken minted by the Eve host.
 *   dangerous pause only for calls the tool flags as destructive (replacing the lab, removing devices, `erase`…).
 *   once      pause the first time each tool is used in a session.
 *   always    pause on every call.
 *
 * The Angular drawer auto-answers approval requests unless the user switches that off, so `dangerous`/`once`/`always`
 * only add a click when the user wants one.
 */
export type ApprovalMode = 'auto' | 'dangerous' | 'once' | 'always';

export function approvalMode(): ApprovalMode {
  if (process.env.EVE_REQUIRE_APPROVAL === '1') return 'always';
  const m = (process.env.EVE_APPROVAL ?? 'auto').trim().toLowerCase();
  return m === 'dangerous' || m === 'once' || m === 'always' ? m : 'auto';
}

export interface MutationApprovalOptions<TInput> {
  /** Return a short reason when the call is destructive; used only in `dangerous` mode. */
  dangerous?: (input: TInput) => string | undefined;
}

export function mutationApproval<TInput = unknown>(opts: MutationApprovalOptions<TInput> = {}): ApprovalPolicy<TInput> {
  switch (approvalMode()) {
    case 'always':
      return always<TInput>();
    case 'once':
      return once<TInput>();
    case 'dangerous':
      return (ctx) => {
        const reason = ctx.toolInput === undefined ? undefined : opts.dangerous?.(ctx.toolInput as TInput);
        return reason ? { type: 'user-approval' } : { type: 'approved', reason: 'not destructive' };
      };
    default:
      return never<TInput>();
  }
}
