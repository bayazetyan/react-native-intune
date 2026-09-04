package com.reactnativeintune

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.microsoft.intune.mam.client.identity.MAMPolicyManager
import com.microsoft.intune.mam.policy.OpenLocation
import com.microsoft.intune.mam.policy.SaveLocation

/**
 * PolicySnapshot (SPEC §4.3).
 *
 * For adapting the host app's own UI — nothing here is enforcement. PIN prompts,
 * screenshot blocking and encryption all happen inside the SDK and are not driven by
 * these values.
 *
 * There is no clipboard field and there cannot be one: neither platform exposes a
 * clipboard policy getter. `canSaveToPersonal` and `canOpenFromUnmanaged` serve the same
 * purpose using values the SDK will actually answer.
 *
 * Note the class package: `MAMPolicyManager` is in `client.identity`, not `policy`.
 */
internal object RNIntunePolicy {

  fun snapshot(context: ReactApplicationContext, accountId: String?): WritableMap {
    val policy = runCatching { MAMPolicyManager.getPolicy(context) }.getOrNull()
      ?: return unmanaged()

    return Arguments.createMap().apply {
      putBoolean("isManaged", true)
      putBoolean(
        "canSaveToLocal",
        policy.getIsSaveToLocationAllowedForOID(SaveLocation.LOCAL, accountId),
      )
      // Not getIsSaveToPersonalAllowed(), which is deprecated — and the location form is
      // what iOS uses too (isSaveToAllowedForLocation:Other), so both platforms answer
      // the same question.
      putBoolean(
        "canSaveToPersonal",
        policy.getIsSaveToLocationAllowedForOID(SaveLocation.OTHER, accountId),
      )
      putBoolean(
        "canOpenFromUnmanaged",
        policy.getIsOpenFromLocationAllowedForOID(OpenLocation.OTHER, accountId),
      )
      putBoolean("screenshotAllowed", policy.isScreenCaptureAllowed)
      // Everything else the SDK reports. Explicitly outside semver: anything depended on
      // here has to be promoted to a typed field first (SPEC §4.3).
      putMap(
        "raw",
        Arguments.createMap().apply {
          putString("isPinRequired", policy.isPinRequired.toString())
          putString("isManagedBrowserRequired", policy.isManagedBrowserRequired.toString())
          putString("isContactSyncAllowed", policy.isContactSyncAllowed.toString())
          putString("hasSaveRestriction", policy.diagnosticHasSaveRestriction().toString())
          putString("hasOpenRestriction", policy.diagnosticHasOpenRestriction().toString())
          putString(
            "fileEncryptionInUse",
            policy.diagnosticIsFileEncryptionInUse().toString(),
          )
        },
      )
    }
  }

  /**
   * An app with no policy is fully permissive. Reporting `false` everywhere would hide
   * functionality that nothing is restricting.
   */
  private fun unmanaged(): WritableMap =
    Arguments.createMap().apply {
      putBoolean("isManaged", false)
      putBoolean("canSaveToLocal", true)
      putBoolean("canSaveToPersonal", true)
      putBoolean("canOpenFromUnmanaged", true)
      putBoolean("screenshotAllowed", true)
      putMap("raw", Arguments.createMap())
    }
}
