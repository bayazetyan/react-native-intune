/**
 * Rejections. Every one carries a stable code from SPEC §13.6 — never a raw platform
 * error, because a code is something a consumer can branch on and a platform message is
 * not.
 */

import type { IntuneErrorCode } from '../types';

export class IntuneError extends Error {
  readonly code: IntuneErrorCode;
  readonly nativeCode?: string;
  readonly nativeMessage?: string;

  constructor(
    code: IntuneErrorCode,
    message: string,
    native?: { nativeCode?: string; nativeMessage?: string }
  ) {
    super(message);
    this.name = 'IntuneError';
    this.code = code;
    this.nativeCode = native?.nativeCode;
    this.nativeMessage = native?.nativeMessage;
  }
}

/** Entra object ID. Deliberately strict — see below. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The UPN-based SDK APIs are deprecated, so the module identifies accounts by object ID
 * only (SPEC §13.2). Catching a UPN here gives a named error at the call site instead of
 * an opaque SDK failure minutes later, in a tenant you cannot reach.
 */
export function assertAccountId(accountId: string): void {
  if (!GUID.test(accountId)) {
    throw new IntuneError(
      'E_INVALID_ACCOUNT_ID',
      `accountId must be an Entra object ID (GUID), got "${accountId}". ` +
        `If this looks like an email address, you passed a UPN — use the object ID.`
    );
  }
}
