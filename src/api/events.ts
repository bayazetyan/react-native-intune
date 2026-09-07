/**
 * Typed subscriptions.
 *
 * Every one of these can fire without the app having called anything: the SDK enrolls on
 * its own retry schedule, an administrator can change policy, and a wipe is
 * service-initiated. Subscribe at startup, not when you happen to be waiting (SPEC §4.4).
 */

import type { EmitterSubscription } from 'react-native';

import { emitter } from '../internal/emitter';
import {
  nullableStr,
  toBrokerStatus,
  toEnrollmentResult,
  toPolicySnapshot,
  toRestartReason,
} from '../internal/decode';
import type {
  BrokerStatus,
  EnrollmentResult,
  IntuneEvents,
  PolicySnapshot,
  RestartRequest,
} from '../types';

function subscribe<K extends keyof IntuneEvents>(
  event: K,
  decode: (raw: object) => IntuneEvents[K],
  listener: (payload: IntuneEvents[K]) => void
): EmitterSubscription {
  return emitter.addListener(event, (raw: object) => listener(decode(raw)));
}

/** Also fires for the SDK's own background enrollment retries, which have no caller. */
export function onEnrollmentResult(
  listener: (result: EnrollmentResult) => void
): EmitterSubscription {
  return subscribe('enrollmentResult', toEnrollmentResult, listener);
}

/** The terminal state of a reset. */
export function onUnenrollmentResult(
  listener: (result: EnrollmentResult) => void
): EmitterSubscription {
  return subscribe('unenrollmentResult', toEnrollmentResult, listener);
}

/** An administrator changed policy — re-read whatever UI you gate on it. */
export function onPolicyChanged(
  listener: (policy: PolicySnapshot) => void
): EmitterSubscription {
  return subscribe('policyChanged', toPolicySnapshot, listener);
}

/** The user installed or removed Company Portal. */
export function onBrokerStatusChanged(
  listener: (status: BrokerStatus) => void
): EmitterSubscription {
  return subscribe('brokerStatusChanged', toBrokerStatus, listener);
}

/** **Service-initiated.** Can arrive with no prior app call at all. */
export function onWipeRequested(
  listener: (request: { accountId: string | null }) => void
): EmitterSubscription {
  return subscribe(
    'wipeRequested',
    (raw) => ({
      accountId: nullableStr((raw as Record<string, unknown>).accountId),
    }),
    listener
  );
}

/** iOS, on first policy application. See `configure({ restartHandledByApp })`. */
export function onRestartRequired(
  listener: (request: RestartRequest) => void
): EmitterSubscription {
  return subscribe(
    'restartRequired',
    (raw) => ({
      reason: toRestartReason((raw as Record<string, unknown>).reason),
    }),
    listener
  );
}
