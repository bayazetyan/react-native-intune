package com.reactnativeintune

import com.facebook.react.bridge.ReadableMap

/**
 * The configuration `configure()` was called with.
 *
 * Every field is required: `index.ts` resolves every optional to a concrete value before
 * it crosses the bridge, so nothing here has to guess a default and the two platforms
 * cannot drift apart on what the default was.
 *
 * Unlike iOS there is no runtime override to set — these values are held and passed
 * per-call to `registerAccountForMAM` (SPEC §13.1).
 */
internal data class RNIntuneConfig(
  val clientId: String,
  val tenantId: String,
  val authority: String,
  val redirectUri: String,
  val authMode: String,
  val verboseLogging: Boolean,
  val strictMode: Boolean,
  val telemetryEnabled: Boolean,
) {
  /**
   * `builtin` means the module owns MSAL and `signIn()` works; `external` means the host
   * app does and every auth method rejects with `E_EXTERNAL_AUTH_MODE` (SPEC §3.2).
   *
   * An unrecognised value is treated as `builtin`, matching the public default — a typo
   * must not silently disable the sign-in the app is relying on.
   */
  val builtinAuth: Boolean
    get() = authMode != "external"

  companion object {
    fun from(map: ReadableMap): RNIntuneConfig =
      RNIntuneConfig(
        clientId = map.getString(CLIENT_ID).orEmpty(),
        tenantId = map.getString(TENANT_ID).orEmpty(),
        authority = map.getString(AUTHORITY).orEmpty(),
        redirectUri = map.getString(REDIRECT_URI).orEmpty(),
        authMode = map.getString(AUTH_MODE).orEmpty(),
        verboseLogging = map.getBoolean(VERBOSE_LOGGING),
        strictMode = map.getBoolean(STRICT_MODE),
        telemetryEnabled = map.getBoolean(TELEMETRY_ENABLED),
      )

    // Spec field names in one place, because a typo'd ReadableMap key reads as null and
    // says nothing. These must match the config object in src/NativeIntune.ts.
    private const val CLIENT_ID = "clientId"
    private const val TENANT_ID = "tenantId"
    private const val AUTHORITY = "authority"
    private const val REDIRECT_URI = "redirectUri"
    private const val AUTH_MODE = "authMode"
    private const val VERBOSE_LOGGING = "verboseLogging"
    private const val STRICT_MODE = "strictMode"
    private const val TELEMETRY_ENABLED = "telemetryEnabled"

    // Branding is iOS-only: the Android SDK styles its own screens from the app theme
    // and has no runtime colour API, so those fields are read by nobody here rather
    // than being faked.
  }
}
