/**
 * Enrollment, state, and the reset sequence.
 *
 * The theme running through all three: **the SDK reports asynchronously and the process
 * may not survive**. Nothing here resolves from a call returning, and nothing assumes
 * the next line will run.
 */

import NativeIntune from '../NativeIntune';
import { assertAccountId } from '../internal/errors';
import { toEnrollmentResult, toIntuneState } from '../internal/decode';
import type {
  EnrollmentResult,
  EnrollParams,
  IntuneState,
  ResetHandler,
  ResetParams,
} from '../types';

let resetHandler: ResetHandler | null = null;

/**
 * Clears the app's own local data during a reset. The module cannot do this for you — it
 * does not know what you store or where.
 *
 * Registered rather than passed to `reset` because a reset can be *resumed* at launch
 * from the journal, with no `reset` call in flight (SPEC §7).
 */
export function setResetHandler(handler: ResetHandler | null): void {
  resetHandler = handler;
}

/**
 * Resolves with a result for every outcome including failures — a non-success status is
 * data, not an exception. It only rejects for programming errors.
 *
 * Expect seconds, and a spinner: the promise settles when the SDK reports through its
 * delegate or notification, not when the underlying call returns.
 *
 * Read SPEC §8 before branching on `status`. `NotLicensed` and `NotTargeted` must not
 * block the user; `Failed` must.
 */
export async function enroll(params: EnrollParams): Promise<EnrollmentResult> {
  assertAccountId(params.accountId);
  return toEnrollmentResult(
    // '' rather than undefined: the Codegen spec has no optionals, so "not known" has to
    // be a value the native side can recognise.
    await NativeIntune.enroll({
      accountId: params.accountId,
      upn: params.upn ?? '',
    })
  );
}

/**
 * The reconciliation primitive, and the intended way to drive this module. Call it at
 * launch, compare against what your backend says the state should be, act on the
 * difference. It never rejects.
 */
export async function getState(): Promise<IntuneState> {
  return toIntuneState(await NativeIntune.getState());
}

/**
 * Unregisters, unenrolls, optionally wipes corporate data, and clears the runtime
 * configuration.
 *
 * **The process is expected to terminate during this call on Android** (SPEC §7). Do not
 * write code after `await reset(...)` that must run — put the continuation in the
 * launch-time reconciliation and let the journal resume it.
 */
export async function reset(params: ResetParams): Promise<void> {
  // The order below is SPEC §7's, and it is not the intuitive one. The unregister has to
  // happen before anything purges the account's tokens, and on Android the process is
  // expected to die during it — so local cleanup cannot come first, and cannot be
  // assumed to run at all. The journal carries the sequence across that death: if the
  // native call never returns, the next launch sees `pendingReset` and calls reset()
  // again with reason 'resume', landing back here.
  const state = await getState().catch(() => null);
  const accountId = state?.enrolledAccountId ?? null;

  await NativeIntune.reset(params);

  // Reached only if the process survived.
  const handler = resetHandler;
  if (handler !== null) {
    // Deliberately not caught: if the app cannot clear its own data, the journal stays
    // open and the reset is retried next launch rather than being marked done.
    await handler({ reason: params.reason, accountId });
  }

  await NativeIntune.completeReset();
}
