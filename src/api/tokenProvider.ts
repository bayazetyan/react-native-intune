/**
 * The MAM service token bridge (SPEC §13.4).
 *
 * The SDK asks for this token on a background thread, including on its own retry
 * schedule when no JS call is in flight — which is why it is a registration rather than
 * a callback parameter on `enroll`.
 *
 * The token never leaves the module: the provider's answer goes to native, native hands
 * it to the SDK, and it is never logged or returned to JS (CLAUDE.md rule 9).
 */

import NativeIntune from '../NativeIntune';
import { emitter } from '../internal/emitter';
import { str } from '../internal/decode';
import type { TokenProvider, TokenRequest } from '../types';

let tokenProvider: TokenProvider | null = null;

/**
 * Registers the provider for `authMode: 'external'`. Return `null` from it to say
 * "cannot get a token right now" — the SDK treats that as needing authorization rather
 * than as a hard failure.
 */
export function setTokenProvider(provider: TokenProvider | null): void {
  tokenProvider = provider;
}

/**
 * Subscribed at import time, not from `setTokenProvider`.
 *
 * If nothing answers, the SDK waits until the native timeout — 45s on iOS, and on
 * Android that is a *held background thread*. Replying "no provider" immediately turns a
 * stall into a fast, named failure.
 */
emitter.addListener('tokenRequest', (raw: object) => {
  const r = raw as Record<string, unknown>;
  const requestId = str(r.requestId);
  const request: TokenRequest = {
    resourceId: str(r.resourceId),
    tenantId: str(r.tenantId),
    authority: str(r.authority),
    accountId: str(r.accountId),
  };

  const active = tokenProvider;
  if (active === null) {
    NativeIntune.rejectToken({
      requestId,
      reason:
        "No token provider is registered. In authMode 'external' the app must call " +
        'setTokenProvider() before enrolling.',
    });
    return;
  }

  const respond = async () => {
    try {
      const token = await active(request);
      if (typeof token === 'string' && token.length > 0) {
        NativeIntune.resolveToken({ requestId, token });
      } else {
        NativeIntune.rejectToken({
          requestId,
          reason: 'token provider returned no token',
        });
      }
    } catch (e) {
      // The message reaches getDiagnostics and support logs, so pass the message and not
      // the error object — a nested response body can carry a token.
      NativeIntune.rejectToken({
        requestId,
        reason: e instanceof Error ? e.message : 'token provider threw',
      });
    }
  };

  // Nothing upstream can observe this promise: the SDK is waiting on the native side,
  // and every path above already answers it.
  respond().catch(() => {});
});
