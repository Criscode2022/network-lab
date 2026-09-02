import { always, never } from 'eve/tools/approval';

/**
 * Mutating tools (apply_lab_patch, apply_device_config, build_lab) run without a human click by default:
 * every change is still authorised server-side by a one-time confirmToken minted by the host, and the
 * Angular drawer can re-enable its own approve step. Set EVE_REQUIRE_APPROVAL=1 to pause on each call.
 */
export function mutationApproval<TInput = unknown>() {
  return process.env.EVE_REQUIRE_APPROVAL === '1' ? always<TInput>() : never<TInput>();
}
