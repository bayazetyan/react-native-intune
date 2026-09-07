package com.reactnativeintune

import android.content.Context
import android.content.SharedPreferences

/**
 * The reset journal (SPEC §7).
 *
 * Unregistering an account that had policy enforced makes the SDK wipe that account's
 * data, and **the process terminating is expected behaviour, not a crash**. Code after
 * the unregister call does not run. So the sequence is not held in memory: each stage is
 * written down before it is attempted, and the next launch reads what was in flight.
 *
 *     IDLE -> UNREGISTERING -> CLEANING_AUTH -> CLEANING_LOCAL -> IDLE
 *
 * No SDK dependency: the journal has to be readable at launch, before anything is
 * configured.
 *
 * **On the storage choice.** SPEC §7 requires this to survive the wipe, which on Android
 * means it must carry no identity tag — a tagged file is deleted with the account's data
 * and the app restarts with no knowledge that a reset was in flight. These preferences
 * are written without ever setting a thread or process identity (the module never calls
 * `setCurrentThreadAccountId`, per CLAUDE.md rule 10), so the MAM plugin's rewritten file
 * layer sees them as unmanaged.
 *
 * [verify] against a real wipe once a tenant exists. Survival across process death is
 * exercised and works; survival across a wipe cannot be tested without a policy-targeted
 * account, and it is the half that matters more.
 */
internal object RNIntuneResetJournal {

  /** Stage strings. Must match `ResetStage` in src/types.ts. */
  const val STAGE_UNREGISTERING = "unregistering"
  const val STAGE_CLEANING_AUTH = "cleaningAuth"
  const val STAGE_CLEANING_LOCAL = "cleaningLocal"

  private const val PREFS = "com.reactnativeintune.resetJournal"
  private const val KEY_STAGE = "stage"
  private const val KEY_ACCOUNT_ID = "accountId"
  private const val KEY_UPN = "upn"
  private const val KEY_TENANT_ID = "tenantId"
  private const val KEY_WIPE = "wipe"
  private const val KEY_REASON = "reason"
  private const val KEY_STARTED_AT = "startedAt"

  data class Entry(
    val stage: String,
    val accountId: String?,
    val upn: String?,
    val tenantId: String?,
    val wipe: Boolean,
    val reason: String,
    val startedAt: Long,
  )

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun read(context: Context): Entry? {
    val p = prefs(context)
    val stage = p.getString(KEY_STAGE, null) ?: return null
    return Entry(
      stage = stage,
      accountId = p.getString(KEY_ACCOUNT_ID, null),
      upn = p.getString(KEY_UPN, null),
      tenantId = p.getString(KEY_TENANT_ID, null),
      wipe = p.getBoolean(KEY_WIPE, false),
      reason = p.getString(KEY_REASON, "").orEmpty(),
      startedAt = p.getLong(KEY_STARTED_AT, 0L),
    )
  }

  fun stage(context: Context): String? = prefs(context).getString(KEY_STAGE, null)

  /**
   * Writes the entry at [STAGE_UNREGISTERING]. Uses `commit()` rather than `apply()`
   * deliberately: the caller is about to make a call that may end the process, and an
   * entry still queued for a background write is an entry that never existed.
   */
  fun open(
    context: Context,
    accountId: String?,
    upn: String?,
    tenantId: String?,
    wipe: Boolean,
    reason: String,
  ) {
    prefs(context)
      .edit()
      .putString(KEY_STAGE, STAGE_UNREGISTERING)
      .putString(KEY_ACCOUNT_ID, accountId)
      .putString(KEY_UPN, upn)
      .putString(KEY_TENANT_ID, tenantId)
      .putBoolean(KEY_WIPE, wipe)
      .putString(KEY_REASON, reason)
      .putLong(KEY_STARTED_AT, System.currentTimeMillis())
      .commit()
  }

  /**
   * Opens the journal for a wipe the *service* started, unless one is already open.
   *
   * A service-initiated wipe is one of the callers of the reset path (SPEC §7, "one code
   * path, many callers"), and it needs the journal for the same reason `reset()` does: the
   * SDK terminates the process, so the consumer's cleanup may not finish and nothing else
   * will come back for it. With no entry there is no `pendingReset`, so the next launch
   * has no idea anything happened.
   *
   * Returns false when an entry already exists — a reset in flight must not be
   * overwritten, since its `reason` and `accountId` are what the resumed sequence acts on.
   */
  fun openForServiceWipe(context: Context, accountId: String?, tenantId: String?): Boolean {
    if (read(context) != null) return false
    // `wipe = true` records what happened rather than requesting it: the SDK is already
    // wiping. `reason` is what lets the consumer's handler tell an administrator revoking
    // access from a user logging out (SPEC §7.4).
    open(
      context = context,
      accountId = accountId,
      upn = null,
      tenantId = tenantId,
      wipe = true,
      reason = "remote_wipe",
    )
    return true
  }

  fun advance(context: Context, stage: String) {
    if (prefs(context).getString(KEY_STAGE, null) == null) return
    prefs(context).edit().putString(KEY_STAGE, stage).commit()
  }

  /**
   * Only after the account is verified gone. An unverified reset stays open and is
   * retried on the next launch rather than being marked done (SPEC §7 step 5).
   */
  fun close(context: Context) {
    prefs(context).edit().clear().commit()
  }
}
