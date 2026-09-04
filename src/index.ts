/**
 * Public API. Everything strict lives here; `NativeIntune.ts` stays loose because
 * Codegen requires it (CLAUDE.md rule 11).
 *
 * What this layer owns:
 *   - applying defaults, so the native side never guesses one
 *   - narrowing native strings to enums, with `Unknown` instead of a throw
 *   - a typed event emitter
 *   - wrapping `resolveToken` / `rejectToken`, which are not public API
 *
 * See SPEC §13 for the reference. A method that exists here but not there does not
 * exist — they change in the same commit.
 */

import { NativeEventEmitter, Platform } from 'react-native';
import type { EmitterSubscription } from 'react-native';

import NativeIntune from './NativeIntune';
import {
  EnrollmentStatus,
  FileProtectionLevel,
  ResetStage,
  type AcquireTokenParams,
  type AuthAccount,
  type AuthResult,
  type BrokerStatus,
  type Diagnostics,
  type EnrollmentResult,
  type EnrollParams,
  type IntuneConfig,
  type IntuneErrorCode,
  type IntuneEvents,
  type IntuneState,
  type PolicySnapshot,
  type ResetHandler,
  type ResetParams,
  type SignInParams,
  type SignOutParams,
  type TokenProvider,
  type TokenRequest,
} from './types';

export * from './types';

// ---------------------------------------------------------------- errors

/** Rejection carrying one of the stable codes in SPEC §13.6. */
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

// ---------------------------------------------------------------- narrowing

/**
 * Unknown native values map to `Unknown` rather than throwing, so an SDK update that
 * adds a status cannot crash a shipped app (SPEC §13.7).
 */
const ENROLLMENT_STATUSES = new Set<string>(Object.values(EnrollmentStatus));

function toEnrollmentStatus(value: unknown): EnrollmentStatus {
  return typeof value === 'string' && ENROLLMENT_STATUSES.has(value)
    ? (value as EnrollmentStatus)
    : EnrollmentStatus.Unknown;
}

const RESET_STAGES = new Set<string>(Object.values(ResetStage));

function toResetStage(value: unknown): ResetStage | null {
  return typeof value === 'string' && RESET_STAGES.has(value)
    ? (value as ResetStage)
    : null;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

function strRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

/** Accepts an Entra object ID only. UPN-based SDK APIs are deprecated (SPEC §13.2). */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertAccountId(accountId: string): void {
  if (!GUID.test(accountId)) {
    throw new IntuneError(
      'E_INVALID_ACCOUNT_ID',
      `accountId must be an Entra object ID (GUID), got "${accountId}". ` +
        `If this looks like an email address, you passed a UPN — use the object ID.`
    );
  }
}

// ---------------------------------------------------------------- decoding

function toEnrollmentResult(raw: object): EnrollmentResult {
  const r = raw as Record<string, unknown>;
  return {
    status: toEnrollmentStatus(r.status),
    accountId: nullableStr(r.accountId),
    nativeCode: str(r.nativeCode),
    nativeMessage: str(r.nativeMessage),
    restartRequired: bool(r.restartRequired),
  };
}

function toIntuneState(raw: object): IntuneState {
  const r = raw as Record<string, unknown>;
  return {
    configured: bool(r.configured),
    configuredTenantId: nullableStr(r.configuredTenantId),
    registeredAccountIds: strArray(r.registeredAccountIds),
    enrolledAccountId: nullableStr(r.enrolledAccountId),
    status: r.status == null ? null : toEnrollmentStatus(r.status),
    pendingReset: toResetStage(r.pendingReset),
  };
}

function toPolicySnapshot(raw: object): PolicySnapshot {
  const r = raw as Record<string, unknown>;
  return {
    // Permissive defaults, not `false`: an unmanaged app restricts nothing, and a
    // missing field must not silently hide a control the SDK is not blocking.
    isManaged: bool(r.isManaged),
    canSaveToLocal: bool(r.canSaveToLocal, true),
    canSaveToPersonal: bool(r.canSaveToPersonal, true),
    canOpenFromUnmanaged: bool(r.canOpenFromUnmanaged, true),
    screenshotAllowed: bool(r.screenshotAllowed, true),
    raw: strRecord(r.raw),
  };
}

function toBrokerStatus(raw: object): BrokerStatus {
  const r = raw as Record<string, unknown>;
  return {
    brokerAvailable: bool(r.brokerAvailable),
    companyPortalInstalled: bool(r.companyPortalInstalled),
    authenticatorInstalled: bool(r.authenticatorInstalled),
    required: bool(r.required, Platform.OS === 'android'),
  };
}

function toAuthResult(raw: object): AuthResult {
  const r = raw as Record<string, unknown>;
  return {
    accountId: str(r.accountId),
    tenantId: str(r.tenantId),
    username: str(r.username),
    accessToken: str(r.accessToken),
    idToken: nullableStr(r.idToken),
    expiresOn: typeof r.expiresOn === 'number' ? r.expiresOn : 0,
    scopes: strArray(r.scopes),
  };
}

function toAuthAccount(raw: object): AuthAccount {
  const r = raw as Record<string, unknown>;
  return {
    accountId: str(r.accountId),
    tenantId: str(r.tenantId),
    username: str(r.username),
  };
}

// ---------------------------------------------------------------- events

/**
 * Constructed at import time, not on first use: a service-initiated wipe can arrive
 * before the app has called anything (SPEC §4.4). Events fired before JS subscribes are
 * queued natively rather than dropped.
 */
const emitter = new NativeEventEmitter(NativeIntune);

function subscribe<K extends keyof IntuneEvents>(
  event: K,
  decode: (raw: object) => IntuneEvents[K],
  listener: (payload: IntuneEvents[K]) => void
): EmitterSubscription {
  return emitter.addListener(event, (raw: object) => listener(decode(raw)));
}

export function onEnrollmentResult(
  listener: (result: EnrollmentResult) => void
): EmitterSubscription {
  return subscribe('enrollmentResult', toEnrollmentResult, listener);
}

export function onUnenrollmentResult(
  listener: (result: EnrollmentResult) => void
): EmitterSubscription {
  return subscribe('unenrollmentResult', toEnrollmentResult, listener);
}

export function onPolicyChanged(
  listener: (policy: PolicySnapshot) => void
): EmitterSubscription {
  return subscribe('policyChanged', toPolicySnapshot, listener);
}

export function onBrokerStatusChanged(
  listener: (status: BrokerStatus) => void
): EmitterSubscription {
  return subscribe('brokerStatusChanged', toBrokerStatus, listener);
}

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

export function onRestartRequired(
  listener: (request: { reason: string }) => void
): EmitterSubscription {
  return subscribe(
    'restartRequired',
    (raw) => ({ reason: str((raw as Record<string, unknown>).reason) }),
    listener
  );
}

// ---------------------------------------------------------------- token provider

let tokenProvider: TokenProvider | null = null;

/**
 * Registers the MAM service token provider for `authMode: 'external'`.
 *
 * The SDK asks on a background thread, including on its own retry schedule when no JS
 * call is in flight, which is why this is a registration and not a callback parameter on
 * `enroll` (SPEC §13.4). Return `null` to say "cannot get a token right now".
 *
 * The token never crosses back out of the module: it goes straight to the SDK.
 */
export function setTokenProvider(provider: TokenProvider | null): void {
  tokenProvider = provider;
}

/**
 * Subscribed at import time, not from `setTokenProvider`.
 *
 * The SDK asks on its own schedule, and if nothing answers it blocks until the native
 * timeout — 45s on iOS, and a held background thread on Android. Answering "no provider"
 * immediately turns that into a fast, named failure instead of a stall.
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
      // The reason string reaches getDiagnostics and support logs, so it must not be
      // the raw error object — that can carry a token in a nested response body.
      NativeIntune.rejectToken({
        requestId,
        reason: e instanceof Error ? e.message : 'token provider threw',
      });
    }
  };

  // Nothing upstream can observe this promise — the SDK is waiting on the native side,
  // and every failure path above already calls rejectToken.
  respond().catch(() => {});
});

// ---------------------------------------------------------------- reset handler

let resetHandler: ResetHandler | null = null;

/**
 * Clears the app's own local data during a reset. The module cannot do this for you —
 * it does not know what you store or where.
 *
 * Registered rather than passed to `reset` because a reset can be *resumed* at launch
 * from the journal, with no `reset` call in flight (SPEC §7).
 */
export function setResetHandler(handler: ResetHandler | null): void {
  resetHandler = handler;
}

// ---------------------------------------------------------------- lifecycle

/**
 * Configures the SDK for one customer tenant. Every other method rejects with
 * `E_NOT_CONFIGURED` until this resolves.
 *
 * Calling it with a different `tenantId` than the active one rejects with
 * `E_RESET_REQUIRED`: silently reconfiguring would leave the old tenant enrolled.
 */
export function configure(config: IntuneConfig): Promise<void> {
  return NativeIntune.configure({
    clientId: config.clientId,
    tenantId: config.tenantId,
    authority: config.authority,
    redirectUri: config.redirectUri,
    authMode: config.authMode ?? 'builtin',
    verboseLogging: config.verboseLogging ?? false,
    restartHandledByApp: config.restartHandledByApp ?? false,
    maxFileProtectionLevel:
      config.maxFileProtectionLevel ?? FileProtectionLevel.Complete,
    // Throws on integration bugs that would otherwise leave data unprotected, so it is
    // on in development and must never ship enabled.
    strictMode: config.strictMode ?? __DEV__,
    keychainGroupOverride: config.keychainGroupOverride ?? '',
    telemetryEnabled: config.telemetryEnabled ?? true,
    // Flattened because Codegen takes no nested optionals; '' means "leave the SDK's
    // default alone", which is not the same as a colour.
    brandingBackground: config.branding?.background ?? '',
    brandingForeground: config.branding?.foreground ?? '',
    brandingAccent: config.branding?.accent ?? '',
    brandingSecondaryBackground: config.branding?.secondaryBackground ?? '',
    brandingSecondaryForeground: config.branding?.secondaryForeground ?? '',
  });
}

/** SDK linked and platform prerequisites met. Gate the whole Intune path on this. */
export function isSupported(): Promise<boolean> {
  return NativeIntune.isSupported();
}

export async function getBrokerStatus(): Promise<BrokerStatus> {
  return toBrokerStatus(await NativeIntune.getBrokerStatus());
}

/** Rejects with `E_NOT_NEEDED` when a broker is already present. */
export function openBrokerInstall(): Promise<void> {
  return NativeIntune.openBrokerInstall();
}

// ---------------------------------------------------------------- auth

export async function signIn(params: SignInParams = {}): Promise<AuthResult> {
  return toAuthResult(await NativeIntune.signIn(params));
}

/**
 * Cache-first. Rejects with `E_INTERACTION_REQUIRED` when a prompt is needed — the
 * normal pattern is `signInSilent` first, `signIn` on that rejection.
 */
export async function signInSilent(
  params: SignInParams = {}
): Promise<AuthResult> {
  return toAuthResult(await NativeIntune.signInSilent(params));
}

/** For your own API's scopes. The MAM service token is acquired internally, never here. */
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

// ---------------------------------------------------------------- enrollment

/**
 * Resolves with a result for every outcome including failures — a non-success status is
 * data, not an exception. Expect seconds, and a spinner: the promise settles when the
 * SDK reports via its delegate or notification, not when the call returns.
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

/** The reconciliation primitive. Call it at launch and act on the difference. */
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
  // Order matters and is not the intuitive one (SPEC §7). The unregister has to happen
  // before anything purges the account's tokens, and on Android the process is expected
  // to die during it — so local cleanup cannot come first, and cannot be assumed to run
  // at all. The journal carries the sequence across that death: if this call never
  // returns, the next launch sees `pendingReset` and calls reset() again with reason
  // 'resume', landing back here.
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

/** Convenience for the common path. Use the primitives when you need a step between. */
export async function signInAndEnroll(
  params: SignInParams = {}
): Promise<{ auth: AuthResult; enrollment: EnrollmentResult }> {
  const auth = await signIn(params);
  const enrollment = await enroll({ accountId: auth.accountId });
  return { auth, enrollment };
}

// ---------------------------------------------------------------- policy

/**
 * For adapting your own UI. PIN prompts, screenshot blocking and encryption are enforced
 * inside the SDK and never surface here — do not implement enforcement from these.
 */
export async function getPolicy(): Promise<PolicySnapshot> {
  return toPolicySnapshot(await NativeIntune.getPolicy());
}

/** Safe to attach to a support ticket: no tokens, no UPNs. */
export async function getDiagnostics(): Promise<Diagnostics> {
  return strRecord(await NativeIntune.getDiagnostics());
}

// ---------------------------------------------------------------- default export

/**
 * Namespace export, so both styles work:
 *
 *     import Intune from 'react-native-intune';        Intune.configure(...)
 *     import { configure } from 'react-native-intune'; configure(...)
 *
 * The namespace form is what SPEC §13 and the README use. Named imports stay available
 * because they are the ones a bundler can tree-shake.
 */
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
  getState,
  reset,
  getPolicy,
  getDiagnostics,
  setTokenProvider,
  setResetHandler,
  onEnrollmentResult,
  onUnenrollmentResult,
  onPolicyChanged,
  onWipeRequested,
  onRestartRequired,
  onBrokerStatusChanged,
} as const;

export default Intune;
