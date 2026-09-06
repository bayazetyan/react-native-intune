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
      // `unregisterAccountForMAM(upn, oid)`. The second parameter is the object ID —
      // identified from bytecode, not documentation: the offline implementation checks
      // its second argument and warns "called without valid OID; identity may be
      // ambiguous", then calls `MAMIdentityManager.create(arg1, arg2)`.
      //
      // The single-argument form is not merely deprecated, it is worse: it leaves the
      // identity ambiguous, and that warning was visible in logcat on a real device
      // before this was fixed. `getRegisteredAccountStatus` has the same shape.
      runCatching { manager?.unregisterAccountForMAM(upn, accountId.orEmpty()) }
        .onFailure { Log.w(TAG, "unregisterAccountForMAM failed: ${it.message}") }
    }

    // Reached only if the process survived.
    RNIntuneResetJournal.advance(context, RNIntuneResetJournal.STAGE_CLEANING_AUTH)

    // MSAL cache cleanup happens in RNIntuneModule.doReset, immediately after this
    // returns, and not here: this object has no MSAL client and should not grow a
    // dependency on one — it owns the order of operations, not the pieces. What matters
    // is that it comes *after* the unregister above, because that call needs an Intune
    // token which comes from the very cache being cleared (SPEC §7 step 4).

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
