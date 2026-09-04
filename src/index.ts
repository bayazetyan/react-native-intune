/**
 * Public API for react-native-intune. See SPEC §13 for the reference — a method that
 * exists here but not there does not exist, and the two change in the same commit.
 *
 * This file is deliberately only a surface. The work is one directory down:
 *
 * ```
 * src/
 *   NativeIntune.ts        Codegen spec — the only file Codegen reads, deliberately loose
 *   types.ts               every public type and enum
 *   api/
 *     lifecycle.ts         configure, isSupported, broker presence
 *     auth.ts              sign-in, tokens for your own API   (authMode 'builtin')
 *     enrollment.ts        enroll, getState, reset
 *     policy.ts            getPolicy, getDiagnostics
 *     events.ts            subscriptions
 *     tokenProvider.ts     the MAM service token bridge       (authMode 'external')
 *   internal/
 *     decode.ts            bridge Object -> typed, with deliberate fallbacks
 *     errors.ts            IntuneError and the accountId guard
 *     emitter.ts           the single NativeEventEmitter
 * ```
 *
 * Both import styles work and neither is preferred:
 *
 * ```ts
 * import Intune from 'react-native-intune';          Intune.configure(...)
 * import { configure } from 'react-native-intune';   configure(...)
 * ```
 */

export * from './types';
export { IntuneError } from './internal/errors';

import {
  configure,
  getBrokerStatus,
  isSupported,
  openBrokerInstall,
} from './api/lifecycle';
import {
  acquireToken,
  getAccounts,
  signIn,
  signInAndEnroll,
  signInSilent,
  signOut,
} from './api/auth';
import {
  enroll,
  enrollInteractive,
  getState,
  reset,
  setResetHandler,
} from './api/enrollment';
import { getDiagnostics, getPolicy } from './api/policy';
import {
  onBrokerStatusChanged,
  onEnrollmentResult,
  onPolicyChanged,
  onRestartRequired,
  onUnenrollmentResult,
  onWipeRequested,
} from './api/events';
import { setTokenProvider } from './api/tokenProvider';

export {
  // setup
  configure,
  isSupported,
  getBrokerStatus,
  openBrokerInstall,
  // auth — authMode 'builtin'
  signIn,
  signInSilent,
  signInAndEnroll,
  acquireToken,
  getAccounts,
  signOut,
  // enrollment and reset
  enroll,
  enrollInteractive,
  getState,
  reset,
  setResetHandler,
  // policy
  getPolicy,
  getDiagnostics,
  // token bridge — authMode 'external'
  setTokenProvider,
  // events
  onEnrollmentResult,
  onUnenrollmentResult,
  onPolicyChanged,
  onWipeRequested,
  onRestartRequired,
  onBrokerStatusChanged,
};

const Intune = {
  configure,
  isSupported,
  getBrokerStatus,
  openBrokerInstall,
  signIn,
  signInSilent,
  signInAndEnroll,
  acquireToken,
  getAccounts,
  signOut,
  enroll,
  enrollInteractive,
  getState,
  reset,
  setResetHandler,
  getPolicy,
  getDiagnostics,
  setTokenProvider,
  onEnrollmentResult,
  onUnenrollmentResult,
  onPolicyChanged,
  onWipeRequested,
  onRestartRequired,
  onBrokerStatusChanged,
} as const;

export default Intune;
