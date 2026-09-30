/**
 * Public types and enums. Hand-written, unlike `NativeIntune.ts` which Codegen reads.
 *
 * The split exists because Codegen accepts only `boolean | number | string | Object |
 * Array | Promise | void` and no literal unions, so the bridge spec has to stay loose.
 * Everything strict lives here and in `index.ts`. Nothing in the public API is `any`.
 *
 * This file is the semver contract described in SPEC §13. Adding to it is a minor;
 * changing or removing anything is a major. `PolicySnapshot.raw` is explicitly excluded.
 */

// ---------------------------------------------------------------- enums

/**
 * Normalized enrollment outcome. The two platforms report different enums — iOS 28
 * codes, Android 10 — and both are mapped onto this set natively. See SPEC §4.1 for the
 * full table; `EnrollmentResult.nativeCode` always carries the raw platform constant.
 *
 * The blocking distinction in SPEC §8 is load-bearing and easy to get backwards:
 * `NotLicensed` and `NotTargeted` must NOT block the user, `Failed` must.
 *
 * Gains members in minor versions, as Microsoft's SDKs add statuses — give a `switch`
 * over it a `default`, and treat what lands there as not blocking. See
 * [Versioning](https://bayazetyan.github.io/react-native-intune/docs/versioning).
 */
export enum EnrollmentStatus {
  Succeeded = 'succeeded',
  /** Tenant is MAM-enabled but the user has no Intune licence. Must NOT block. */
  NotLicensed = 'notLicensed',
  /** Licensed, but no App Protection Policy targets the user. Must NOT block. */
  NotTargeted = 'notTargeted',
  /** Licensed and targeted, but enrollment failed. This one DOES block. */
  Failed = 'failed',
  /** Android reports this itself; on iOS it is our own state while the delegate is pending. */
  Pending = 'pending',
  AuthorizationNeeded = 'authorizationNeeded',
  /** Android only. iOS uses Authenticator as a broker and has no equivalent code. */
  CompanyPortalRequired = 'companyPortalRequired',
  WrongUser = 'wrongUser',
  Unenrolled = 'unenrolled',
  UnenrollmentFailed = 'unenrollmentFailed',
  /**
   * Any native value the mapping does not cover. Unknown values map here rather than
   * throwing, so an SDK update that adds a status cannot crash a shipped app.
   */
  Unknown = 'unknown',
}

/** Journal stage of an unfinished reset. See SPEC §7. */
export enum ResetStage {
  Unregistering = 'unregistering',
  CleaningAuth = 'cleaningAuth',
  CleaningLocal = 'cleaningLocal',
}

/**
 * iOS `MaxFileProtectionLevel`. The default makes protected files unreadable roughly ten
 * seconds after the device locks, which breaks local databases; an app with lock-screen
 * UI wants `CompleteUntilFirstUserAuthentication`. See SPEC §5.2.
 */
export enum FileProtectionLevel {
  Complete = 'complete',
  CompleteUnlessOpen = 'completeUnlessOpen',
  CompleteUntilFirstUserAuthentication = 'completeUntilFirstUserAuthentication',
  None = 'none',
}

/**
 * Why a reset was started. Recorded in the journal and surfaced in `getDiagnostics`.
 *
 * camelCase, like every other string value in this API. Before 1.0 these were
 * snake_case (`remote_wipe`); a journal written by an older version is still read, and
 * its reason reported in the new spelling.
 *
 * Gains members in minor versions — give a `switch` over it a `default`.
 */
export type ResetReason =
  | 'logout'
  | 'tenantChanged'
  | 'intuneDisabled'
  | 'remoteWipe'
  | 'accountSwitch'
  | 'supportReset'
  | 'resume';

/**
 * Who owns MSAL. `'builtin'` — the module — is the default and the only mode supported
 * in 1.x.
 *
 * `'external'` is for apps that already have their own MSAL and answer the SDK's token
 * requests themselves.
 * **Not supported in 1.x.** `authMode: 'external'` is kept working in the code, but it has
 * not been run on a device against a tenant, so it is undocumented and outside the semver
 * contract — it may change in any release. It is planned for 2.0.
 */
export type AuthMode = 'builtin' | 'external';

// ---------------------------------------------------------------- config

export type IntuneConfig = {
  /** Entra application (client) ID, GUID. */
  clientId: string;
  /** Entra directory (tenant) ID, GUID. */
  tenantId: string;
  /** e.g. `https://login.microsoftonline.com/<tenantId>` */
  authority: string;
  /** Must match the platform format — see the README. */
  redirectUri: string;
  /** Default `'builtin'`, and the only value supported in 1.x. */
  authMode?: AuthMode;
  /** Default `false`. */
  verboseLogging?: boolean;
  /** iOS only. Default `false`. See SPEC §5.2 and open question O-C. */
  restartHandledByApp?: boolean;
  /** iOS only. Default `Complete`, which is the SDK's own default. */
  maxFileProtectionLevel?: FileProtectionLevel;
  /** Android only. Default `__DEV__`. Throws on integration bugs, so never ship it on. */
  strictMode?: boolean;
  /**
   * iOS only. MSAL's keychain access group. Leave unset unless the app already uses a
   * custom one: the module sets `ADALCacheKeychainGroupOverride` from this same value in
   * the same code path, so the two can never disagree (SPEC §5.1.2).
   */
  keychainGroupOverride?: string;
  /** Default `true`, matching the SDK. Set `false` to opt out of Microsoft telemetry. */
  telemetryEnabled?: boolean;
  /**
   * Colours for the screens the SDK draws itself — the PIN prompt, the blur overlay, the
   * policy and diagnostics screens. Anything left unset keeps Microsoft's default.
   *
   * These are the SDK's own UI, not yours: it renders them over your app and you cannot
   * restyle them any other way (SPEC §15 P4).
   */
  branding?: Branding;
};

/** Hex strings, e.g. `#1B5E20`. */
export type Branding = {
  background?: string;
  foreground?: string;
  accent?: string;
  secondaryBackground?: string;
  secondaryForeground?: string;
};

// ---------------------------------------------------------------- auth

export type SignInPrompt =
  'selectAccount' | 'login' | 'consent' | 'whenRequired';

export type SignInParams = {
  /** Scopes for your own API. The MAM service scopes are added internally. */
  scopes?: string[];
  /** Pre-fill the account, e.g. from an email field. */
  loginHint?: string;
  prompt?: SignInPrompt;
};

export type AcquireTokenParams = {
  scopes: string[];
  accountId?: string;
};

export type AuthResult = {
  /** Entra object ID. This is what `enroll` takes — never the UPN. */
  accountId: string;
  tenantId: string;
  /** UPN. Display only; never log or persist it (SPEC §16, CLAUDE.md rule 3). */
  username: string;
  /** For the scopes you asked for. Never the MAM service token. */
  accessToken: string;
  idToken: string | null;
  /** Unix seconds. */
  expiresOn: number;
  scopes: string[];
};

export type AuthAccount = {
  accountId: string;
  tenantId: string;
  username: string;
};

export type EnrollParams = {
  /** Entra object ID. Never a UPN — that is what `upn` below is for. */
  accountId: string;
  /**
   * @internal
   *
   * **Android, `authMode: 'external'` only** — outside the contract in 1.x, see `AuthMode`.
   * `registerAccountForMAM` takes the UPN as
   * well as the object ID and will not accept null for it, and in `external` mode the
   * module has no MSAL cache to resolve one from.
   *
   * Leave it unset in `builtin` mode — the module reads it from its own MSAL account.
   * iOS never needs it: `registerAndEnrollAccountId:` takes the object ID alone and the
   * SDK resolves the UPN itself. See SPEC §6.3.
   */
  upn?: string;
};

export type EnrollInteractiveParams = {
  /**
   * The account's UPN. Leave unset to let the SDK ask for it — it shows its own sign-in
   * screen either way.
   */
  upn?: string;
};

export type SignOutParams = {
  accountId: string;
  /** Also runs the full reset sequence. On Android the process may terminate. */
  wipeIntune: boolean;
};

// ---------------------------------------------------------------- state

export type BrokerStatus = {
  /** Any usable broker is present. */
  brokerAvailable: boolean;
  companyPortalInstalled: boolean;
  /** iOS only; always `false` on Android. */
  authenticatorInstalled: boolean;
  /** `true` on Android — enrollment is impossible without a broker. */
  required: boolean;
};

export type EnrollmentResult = {
  status: EnrollmentStatus;
  accountId: string | null;
  /**
   * Raw platform constant *name*, e.g. `LicensedNotTargeted`. For support bundles.
   *
   * **Outside the semver contract.** It is the SDK's own name and changes when
   * Microsoft's SDK does — log it, do not branch on it. Branch on `status`. See
   * [Versioning](https://bayazetyan.github.io/react-native-intune/docs/versioning).
   */
  nativeCode: string;
  /**
   * SDK debug string. Safe to log — contains no token.
   *
   * **Outside the semver contract**, like `nativeCode`.
   */
  nativeMessage: string;
  restartRequired: boolean;
};

/**
 * The reconciliation primitive, and the intended way to drive this module. Read it at
 * launch, compare against what your backend says the state should be, act on the
 * difference. Do not drive enrollment from lifecycle hooks: the process can die
 * mid-operation and only a state comparison recovers from that. See SPEC §13.2.
 */
export type IntuneState = {
  configured: boolean;
  configuredTenantId: string | null;
  /**
   * What the SDK reports as registered. An array because that is the SDK's shape; with
   * one identity per installation it holds zero or one account in practice, and more
   * than one means an earlier registration was left behind.
   */
  registeredAccountIds: string[];
  enrolledAccountId: string | null;
  /** `null` means no account is registered. */
  status: EnrollmentStatus | null;
  /** Non-null means a reset is unfinished and must be resumed (SPEC §7). */
  pendingReset: ResetStage | null;
  /**
   * Why that unfinished reset started, from the journal.
   *
   * Pass it back as `reset({ reason })` when resuming, so the reset handler sees what
   * actually happened rather than `'resume'`. It is the difference between telling a user
   * their administrator revoked access and telling them nothing — and on the path that
   * matters most, a service-initiated wipe, the process dies before the handler ever runs
   * in the original call, so the resume is the only place it can be said.
   */
  pendingResetReason: ResetReason | null;
};

export type ResetParams = {
  wipe: boolean;
  reason: ResetReason;
};

// ---------------------------------------------------------------- policy

/**
 * Only what an app needs to adapt its own UI — hiding an export button, disabling a
 * share sheet. **PIN prompts, screenshot blocking and encryption are enforced inside the
 * SDK and never surface here.** Do not try to implement enforcement from these booleans.
 *
 * Deliberately short: every field is a support obligation.
 *
 * There is no clipboard field, and there cannot be one. Neither platform exposes a
 * clipboard policy getter — the restriction is enforced inside the SDK and is not
 * queryable — so `canSaveToPersonal` and `canOpenFromUnmanaged` serve the same
 * "adapt your UI" purpose using values both platforms can actually answer (SPEC §4.3).
 *
 * When no policy applies, every field is permissive rather than `false`: reporting
 * `false` would hide functionality that nothing is restricting.
 */
export type PolicySnapshot = {
  isManaged: boolean;
  /** Save into the app's own storage. */
  canSaveToLocal: boolean;
  /**
   * Save out to a personal, unmanaged destination. Gate an export or "save a copy"
   * control on this.
   */
  canSaveToPersonal: boolean;
  /** Bring data in from an unmanaged location. Gate an import control on this. */
  canOpenFromUnmanaged: boolean;
  screenshotAllowed: boolean;
  /**
   * Everything else the SDK reports. **Excluded from semver** — unstable, debug only.
   * Anything you come to depend on must be promoted to a typed field first.
   */
  raw: Record<string, string>;
};

/**
 * Opaque key/value for support bundles. Contains no tokens and no UPNs.
 *
 * **Outside the semver contract**: the keys follow whatever is useful to diagnose and
 * may change in any release. See [Versioning](https://bayazetyan.github.io/react-native-intune/docs/versioning).
 */
export type Diagnostics = Record<string, string>;

// ---------------------------------------------------------------- events

/**
 * Payload of a native-initiated MAM service token request, for `authMode: 'external'`.
 *
 * @internal Outside the contract in 1.x — see `AuthMode`.
 */
export type TokenRequest = {
  resourceId: string;
  tenantId: string;
  authority: string;
  accountId: string;
};

/**
 * Return the access token, or `null` to signal "cannot get a token right now". Runs on a
 * background thread's behalf, and the SDK may ask with no JS call in flight.
 *
 * @internal Outside the contract in 1.x — see `AuthMode`.
 */
export type TokenProvider = (
  request: TokenRequest
) => Promise<string | null> | string | null;

export type ResetHandlerContext = {
  reason: ResetReason;
  accountId: string | null;
};

/** Clear the app's own local data. If it throws, the journal stays open and retries. */
export type ResetHandler = (
  context: ResetHandlerContext
) => Promise<void> | void;

export type WipeRequest = { accountId: string | null };

/**
 * Why the SDK wants the app restarted.
 *
 * One value today, because that is the only case the SDK reports: policy arrived for the
 * first time. Typed as a union rather than `string` so a consumer can switch on it, with
 * `unknown` for a value a future SDK adds — an unrecognised reason must not break a
 * shipped app, and a restart is still a restart.
 */
export type RestartReason = 'policyAppliedFirstTime' | 'unknown';

export type RestartRequest = { reason: RestartReason };

/** Event names and their payloads, used to type the emitter in `index.ts`. */
export type IntuneEvents = {
  enrollmentResult: EnrollmentResult;
  policyChanged: PolicySnapshot;
  unenrollmentResult: EnrollmentResult;
  wipeRequested: WipeRequest;
  restartRequired: RestartRequest;
  /** @internal The `external` token bridge — outside the contract in 1.x. */
  tokenRequest: TokenRequest & { requestId: string };
  brokerStatusChanged: BrokerStatus;
};

// ---------------------------------------------------------------- errors

/**
 * Stable rejection codes. A non-success enrollment *status* is data and resolves; these
 * mean the caller did something wrong or the environment is broken. See SPEC §13.6.
 *
 * `E_NATIVE` appearing in logs is a signal to extend the native mapping table, not an
 * acceptable steady state.
 *
 * Gains members in minor versions — give a `switch` over it a `default`. See
 * [Versioning](https://bayazetyan.github.io/react-native-intune/docs/versioning).
 */
export type IntuneErrorCode =
  | 'E_NOT_CONFIGURED'
  | 'E_RESET_REQUIRED'
  | 'E_SDK_UNAVAILABLE'
  | 'E_BROKER_MISSING'
  | 'E_INVALID_ACCOUNT_ID'
  // The next three are reached only with authMode 'external', outside the contract in 1.x.
  | 'E_TOKEN_PROVIDER_FAILED'
  | 'E_TOKEN_PROVIDER_MISSING'
  | 'E_EXTERNAL_AUTH_MODE'
  | 'E_INTERACTION_REQUIRED'
  | 'E_NO_ACTIVITY'
  | 'E_USER_CANCELLED'
  | 'E_RESET_IN_PROGRESS'
  | 'E_ALREADY_ENROLLED'
  | 'E_NOT_NEEDED'
  /**
   * `configure()` disagrees with the host app's Info.plist. iOS only. Raised for a
   * hardcoded `ADAL*` identity key next to a runtime override (the known cause of
   * enrollment failing with `AuthRequired`), or for a `keychainGroupOverride` /
   * `maxFileProtectionLevel` that the plist does not match — neither of those two has a
   * runtime setter, so the module can only refuse to let them disagree.
   */
  | 'E_PLIST_CONFLICT'
  /**
   * Android only. `MAMEnrollmentManager.registerAccountForMAM` requires the account's
   * UPN as well as its object ID, and nothing can supply it until the module's own MSAL
   * sign-in lands (SPEC §3, spike S-3). iOS is unaffected —
   * `registerAndEnrollAccountId:` takes the object ID alone.
   */
  | 'E_UPN_REQUIRED'
  | 'E_NATIVE';
