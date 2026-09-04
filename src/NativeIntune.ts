/**
 * Codegen spec — the ONLY file Codegen reads, and the only `Native*.ts` allowed in
 * `jsSrcsDir`. An extra one is picked up and fails confusingly.
 *
 * This file is deliberately loose (CLAUDE.md rule 11). Codegen accepts only
 * `boolean | number | string | Object | Array | Promise | void`: no literal unions, no
 * optional parameters, no enums. So every union and every optional is normalized in
 * `index.ts` before it crosses the bridge, and every aggregate return is `Object` here
 * and a real type there. Nothing in the public API is `Object`.
 *
 * Editing this file means Codegen must re-run — `pod install` on iOS,
 * `generateCodegenArtifactsFromSchema` on Android. A native build that breaks right
 * after a change here is a stale Codegen artifact until proven otherwise.
 */

import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  // ---- lifecycle ----

  /**
   * Every field is required here even though most are optional in the public API:
   * `index.ts` applies the defaults, so the native side never has to guess one.
   * Empty string means "unset" for `keychainGroupOverride`.
   */
  configure(config: {
    clientId: string;
    tenantId: string;
    authority: string;
    redirectUri: string;
    authMode: string; // 'builtin' | 'external'
    verboseLogging: boolean;
    restartHandledByApp: boolean;
    maxFileProtectionLevel: string; // FileProtectionLevel
    strictMode: boolean;
    keychainGroupOverride: string; // '' = platform default
    telemetryEnabled: boolean;
    // SDK screen branding (SPEC §15 P4). '' leaves the SDK's own default in place.
    brandingBackground: string;
    brandingForeground: string;
    brandingAccent: string;
    brandingSecondaryBackground: string;
    brandingSecondaryForeground: string;
  }): Promise<void>;

  /** SDK linked and platform prerequisites met. Gate the whole Intune path on this. */
  isSupported(): Promise<boolean>;

  /** BrokerStatus. */
  getBrokerStatus(): Promise<Object>;

  openBrokerInstall(): Promise<void>;

  // ---- auth (builtin mode) ----

  /** SignInParams in, AuthResult out. */
  signIn(params: Object): Promise<Object>;
  /** SignInParams in, AuthResult out. Rejects E_INTERACTION_REQUIRED. */
  signInSilent(params: Object): Promise<Object>;
  /** AcquireTokenParams in, AuthResult out. For the app's own scopes only. */
  acquireToken(params: Object): Promise<Object>;
  /** AuthAccount[]. */
  getAccounts(): Promise<Object[]>;

  signOut(params: { accountId: string; wipeIntune: boolean }): Promise<void>;

  // ---- enrollment ----

  /**
   * EnrollmentResult. Resolves for every outcome including failures — a non-success
   * status is data, not an exception. Resolved from the SDK's delegate or notification,
   * never from the underlying call returning (SPEC §12.5).
   */
  enroll(params: { accountId: string; upn: string }): Promise<Object>;

  /** IntuneState — the reconciliation primitive. */
  getState(): Promise<Object>;

  /**
   * Writes the journal and unregisters. The process is expected to terminate during this
   * call on Android (SPEC §7), so nothing after it is guaranteed to run.
   */
  reset(params: { wipe: boolean; reason: string }): Promise<void>;

  /**
   * NOT public API. Verifies the account really is gone, then closes the journal —
   * `reset()` in index.ts calls it after the consumer's reset handler has cleared local
   * data. Separate from `reset` because the steps between them may straddle a process
   * death, and the journal is what carries the sequence across it (SPEC §7).
   */
  completeReset(): Promise<void>;

  // ---- policy ----

  /** PolicySnapshot. */
  getPolicy(): Promise<Object>;
  /** Opaque key/value for support bundles. No tokens, no UPNs. */
  getDiagnostics(): Promise<Object>;

  // ---- token provider plumbing ----

  /**
   * NOT public API. `setTokenProvider` in `index.ts` wraps these; the SDK asks for a MAM
   * service token on a background thread, including on its own retry schedule with no JS
   * call in flight, so it cannot be a callback parameter on `enroll` (SPEC §13.4).
   */
  resolveToken(params: { requestId: string; token: string }): void;
  rejectToken(params: { requestId: string; reason: string }): void;

  // ---- events ----

  /**
   * Present only to satisfy `NativeEventEmitter`; ref-counting, no logic. The emitter
   * itself is live from module construction and queues events fired before JS
   * subscribes — a wipe lost during startup means the reset never runs (SPEC §4.4).
   */
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('RNIntune');
