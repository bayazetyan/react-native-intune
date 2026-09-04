/**
 * Reading policy, and reading the module's own state for a support bundle.
 */

import NativeIntune from '../NativeIntune';
import { strRecord, toPolicySnapshot } from '../internal/decode';
import type { Diagnostics, PolicySnapshot } from '../types';

/**
 * For adapting your own UI — hiding an export button, disabling a share sheet.
 *
 * **PIN prompts, screenshot blocking and encryption are enforced inside the SDK and
 * never surface here.** Do not attempt to implement enforcement from these booleans.
 */
export async function getPolicy(): Promise<PolicySnapshot> {
  return toPolicySnapshot(await NativeIntune.getPolicy());
}

/** Safe to attach to a support ticket: no tokens, no UPNs. */
export async function getDiagnostics(): Promise<Diagnostics> {
  return strRecord(await NativeIntune.getDiagnostics());
}
