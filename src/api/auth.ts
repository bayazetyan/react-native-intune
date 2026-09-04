/**
 * Sign-in, for `authMode: 'builtin'` — the module owns MSAL (SPEC §3).
 *
 * Two tokens exist and only one of them appears here: the MAM service token is acquired
 * internally and never crosses the bridge. Everything returned by these calls is for
 * *your* API's scopes (SPEC §3.5).
 */

import NativeIntune from '../NativeIntune';
import { assertAccountId } from '../internal/errors';
import { toAuthAccount, toAuthResult } from '../internal/decode';
import { enroll } from './enrollment';
import type {
  AcquireTokenParams,
  AuthAccount,
  AuthResult,
  EnrollmentResult,
  SignInParams,
  SignOutParams,
} from '../types';

/**
 * Uses the broker when one is present, which also gives device-wide SSO: a user already
 * signed into Outlook usually gets a token with no prompt at all.
 */
export async function signIn(params: SignInParams = {}): Promise<AuthResult> {
  return toAuthResult(await NativeIntune.signIn(params));
}

/**
 * Cache-first. Rejects with `E_INTERACTION_REQUIRED` when a prompt is needed — the normal
 * pattern is `signInSilent` first, `signIn` on that rejection.
 */
export async function signInSilent(
  params: SignInParams = {}
): Promise<AuthResult> {
  return toAuthResult(await NativeIntune.signInSilent(params));
}

/** For your own API's scopes, after sign-in. */
export async function acquireToken(
  params: AcquireTokenParams
): Promise<AuthResult> {
  return toAuthResult(await NativeIntune.acquireToken(params));
}

/**
 * Accounts with cached refresh tokens. Under single identity (SPEC §9) this holds at
 * most one; more than one means state a reset should have cleared.
 */
export async function getAccounts(): Promise<AuthAccount[]> {
  const accounts = await NativeIntune.getAccounts();
  return accounts.map(toAuthAccount);
}

/**
 * Removes the account from the MSAL cache. With `wipeIntune: true` it also runs the full
 * reset sequence, which is what you want on logout — and which means **the process may
 * terminate during this call on Android.**
 */
export function signOut(params: SignOutParams): Promise<void> {
  assertAccountId(params.accountId);
  return NativeIntune.signOut(params);
}

/** The common path in one call. Use the primitives when you need a step in between. */
export async function signInAndEnroll(
  params: SignInParams = {}
): Promise<{ auth: AuthResult; enrollment: EnrollmentResult }> {
  const auth = await signIn(params);
  const enrollment = await enroll({ accountId: auth.accountId });
  return { auth, enrollment };
}
