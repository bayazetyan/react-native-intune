package com.reactnativeintune

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.microsoft.intune.mam.client.app.MAMComponents
import com.microsoft.intune.mam.client.identity.MAMPolicyManager
import com.microsoft.intune.mam.policy.MAMUserInfo
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
    // Ask the SDK who the primary user is rather than relying only on the account id the
    // caller happens to be holding: that one lives in memory and is gone after a restart,
    // while the SDK's survives — and a policy read that silently loses its identity is
    // exactly the failure fixed on iOS.
    val primaryOid = runCatching { MAMComponents.get(MAMUserInfo::class.java)?.primaryUserOID }
      .getOrNull()
      ?.takeIf { it.isNotEmpty() }
    val oid = accountId ?: primaryOid

    // `getPolicy(context)` never returns null — with no identity it answers with a
    // default *permissive* policy. So it cannot be used to decide whether the app is
    // managed, and `isManaged` must not be hardcoded from it being non-null. Observed on
    // device: a fresh install that had never enrolled reported `isManaged: true`.
    val policy = runCatching {
      if (oid != null) MAMPolicyManager.getPolicyForIdentityOID(oid)
      else MAMPolicyManager.getPolicy(context)
    }.getOrNull() ?: return unmanaged(primaryOid != null)

    val managed = oid != null &&
      runCatching { MAMPolicyManager.getIsIdentityOIDManaged(oid) }.getOrDefault(false)

    return Arguments.createMap().apply {
      putBoolean("isManaged", managed)
      putBoolean(
        "canSaveToLocal",
        policy.getIsSaveToLocationAllowedForOID(SaveLocation.LOCAL, oid),
      )
      // Not getIsSaveToPersonalAllowed(), which is deprecated — and the location form is
      // what iOS uses too (isSaveToAllowedForLocation:Other), so both platforms answer
      // the same question.
      putBoolean(
        "canSaveToPersonal",
        policy.getIsSaveToLocationAllowedForOID(SaveLocation.OTHER, oid),
      )
      putBoolean(
        "canOpenFromUnmanaged",
        policy.getIsOpenFromLocationAllowedForOID(OpenLocation.OTHER, oid),
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
          // Diagnostic, not policy: an all-permissive snapshot means either no identity
          // resolved or a genuinely unrestricted tenant, and this says which. Boolean
          // only — the account id itself must not travel here (CLAUDE.md rule 3).
          putString("hasPrimaryAccount", (primaryOid != null).toString())
        },
      )
    }
  }

  /**
   * An app with no policy is fully permissive. Reporting `false` everywhere would hide
   * functionality that nothing is restricting.
   */
  private fun unmanaged(hasPrimaryAccount: Boolean = false): WritableMap =
    Arguments.createMap().apply {
      putBoolean("isManaged", false)
      putBoolean("canSaveToLocal", true)
      putBoolean("canSaveToPersonal", true)
      putBoolean("canOpenFromUnmanaged", true)
      putBoolean("screenshotAllowed", true)
      putMap(
        "raw",
        Arguments.createMap().apply {
          putString("hasPrimaryAccount", hasPrimaryAccount.toString())
        },
      )
    }
}
