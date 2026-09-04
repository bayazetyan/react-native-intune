/**
 * Setup, and the two questions worth asking before it: is the SDK usable at all, and is
 * a broker present.
 */

import NativeIntune from '../NativeIntune';
import { toBrokerStatus } from '../internal/decode';
import {
  FileProtectionLevel,
  type BrokerStatus,
  type IntuneConfig,
} from '../types';

/**
 * Configures the SDK for one customer tenant. Every other method rejects with
 * `E_NOT_CONFIGURED` until this resolves.
 *
 * Two things it will refuse rather than paper over:
 *
 *   - a different `tenantId` than the active one — `E_RESET_REQUIRED`, because silently
 *     reconfiguring would leave the old tenant enrolled, and the iOS runtime overrides
 *     persist across restarts so the mismatch would survive a relaunch;
 *   - an `Info.plist` that disagrees with it — `E_PLIST_CONFLICT`, see SPEC §5.1.2.
 */
export function configure(config: IntuneConfig): Promise<void> {
  // Every optional becomes a concrete value here, so the native side never has to guess
  // a default and the two platforms cannot drift apart on what the default was.
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
    // Flattened because Codegen takes no nested optionals. '' means "leave the SDK's
    // own default alone", which is not the same as a colour.
    brandingBackground: config.branding?.background ?? '',
    brandingForeground: config.branding?.foreground ?? '',
    brandingAccent: config.branding?.accent ?? '',
    brandingSecondaryBackground: config.branding?.secondaryBackground ?? '',
    brandingSecondaryForeground: config.branding?.secondaryForeground ?? '',
  });
}

/**
 * SDK linked and platform prerequisites met. Gate the whole Intune path on this so a
 * misbuilt binary degrades instead of crashing.
 */
export function isSupported(): Promise<boolean> {
  return NativeIntune.isSupported();
}

/**
 * Answerable before `configure`, on purpose — the app needs it to decide whether to
 * prompt for a broker install.
 *
 * A false negative here usually means a missing manifest entry rather than a missing
 * app: `LSApplicationQueriesSchemes` on iOS, `<queries>` on Android 11+.
 */
export async function getBrokerStatus(): Promise<BrokerStatus> {
  return toBrokerStatus(await NativeIntune.getBrokerStatus());
}

/** Rejects with `E_NOT_NEEDED` when a broker is already present. */
export function openBrokerInstall(): Promise<void> {
  return NativeIntune.openBrokerInstall();
}
