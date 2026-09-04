package com.reactnativeintune

import android.content.Context
import android.util.Log
import com.microsoft.intune.mam.client.app.MAMComponents
import com.microsoft.intune.mam.policy.MAMEnrollmentManager

/**
 * The reset sequence (SPEC §7).
 *
 * Separate from [RNIntuneResetJournal] on purpose: the journal is storage, this is the
 * order of operations. The order is the part that is easy to get wrong — the unregister
 * has to precede any token purge, and the process is not guaranteed to survive it.
 */
internal object RNIntuneReset {

  private const val TAG = "RNIntuneReset"

  /**
   * Opens the journal, then unregisters. Every step is written down *before* it is
   * attempted, because after `unregisterAccountForMAM` there may be no process left to
   * write anything.
   */
  fun run(
    context: Context,
    accountId: String?,
    upn: String?,
    tenantId: String?,
    wipe: Boolean,
    reason: String,
  ) {
    RNIntuneResetJournal.open(
      context = context,
      accountId = accountId,
      upn = upn,
      tenantId = tenantId,
      wipe = wipe,
      reason = reason,
    )

    if (upn != null) {
      val manager = MAMComponents.get(MAMEnrollmentManager::class.java)
      // Deprecated in favour of a two-argument overload whose second parameter cannot be
      // identified from the AAR — same [verify] as readStatus in the module. Deprecated
      // here means superseded, not removed.
      @Suppress("DEPRECATION")
      runCatching { manager?.unregisterAccountForMAM(upn) }
        .onFailure { Log.w(TAG, "unregisterAccountForMAM failed: ${it.message}") }
    }

    // Reached only if the process survived.
    RNIntuneResetJournal.advance(context, RNIntuneResetJournal.STAGE_CLEANING_AUTH)

    // MSAL cache cleanup belongs here. SPEC §7 step 4 still says the host app does it
    // because the module does not own MSAL — that predates §3, which decided it does.
    // In 'builtin' it becomes ours with S-3; in 'external' it stays the host app's.

    RNIntuneResetJournal.advance(context, RNIntuneResetJournal.STAGE_CLEANING_LOCAL)
  }

  /**
   * Closes the journal, but only once the account is verified gone.
   *
   * @param statusOf reads the SDK's registration status for an account ID.
   * @return false when the reset did not take, leaving the journal open for a retry.
   */
  fun complete(
    context: Context,
    statusOf: (String) -> MAMEnrollmentManager.Result?,
  ): Boolean {
    val entry = RNIntuneResetJournal.read(context) ?: return true

    val stillRegistered = entry.accountId?.let { statusOf(it) != null } ?: false
    if (stillRegistered) return false

    RNIntuneResetJournal.close(context)
    return true
  }
}
