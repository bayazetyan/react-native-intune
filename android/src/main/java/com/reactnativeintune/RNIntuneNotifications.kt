package com.reactnativeintune

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.microsoft.intune.mam.client.app.MAMComponents
import com.microsoft.intune.mam.client.notification.MAMNotificationReceiver
import com.microsoft.intune.mam.client.notification.MAMNotificationReceiverRegistry
import com.microsoft.intune.mam.policy.MAMEnrollmentManager
import com.microsoft.intune.mam.policy.notification.MAMEnrollmentNotification
import com.microsoft.intune.mam.policy.notification.MAMNotification
import com.microsoft.intune.mam.policy.notification.MAMNotificationType
import com.microsoft.intune.mam.policy.notification.MAMUserNotification

/**
 * The Android counterpart of the iOS delegates: the SDK reports enrollment, policy and
 * wipe through notifications rather than a delegate protocol.
 *
 * These arrive without the app having asked for anything — the SDK has its own
 * enrollment retry schedule, and a wipe is service-initiated. So nothing here resolves a
 * promise; it publishes events and whoever is waiting correlates (SPEC §6.4, §12.5).
 */
internal object RNIntuneNotifications {

  /** Unified status strings. Must match `EnrollmentStatus` in src/types.ts. */
  private const val SUCCEEDED = "succeeded"
  private const val NOT_LICENSED = "notLicensed"
  private const val FAILED = "failed"
  private const val PENDING = "pending"
  private const val AUTHORIZATION_NEEDED = "authorizationNeeded"
  private const val COMPANY_PORTAL_REQUIRED = "companyPortalRequired"
  private const val WRONG_USER = "wrongUser"
  private const val UNENROLLED = "unenrolled"
  private const val UNENROLLMENT_FAILED = "unenrollmentFailed"
  private const val UNKNOWN = "unknown"

  /**
   * Maps the SDK's ten-value result onto the unified vocabulary. The reasoning for each
   * row is SPEC §4.1 — read it before changing one. Getting `notLicensed` and `failed`
   * the wrong way round has opposite consequences for the user (SPEC §8).
   *
   * `Result` is an enum, so `when` is exhaustive without an `else`: a value added by a
   * future SDK becomes a compile error here rather than silence. Anything that does slip
   * through still degrades to `unknown` instead of throwing.
   */
  fun unifiedStatus(result: MAMEnrollmentManager.Result?): String =
    when (result) {
      MAMEnrollmentManager.Result.ENROLLMENT_SUCCEEDED,
      // The account is managed through the MDM channel rather than MAM-WE. A managed,
      // non-blocking state — nativeCode keeps the distinction for support logs.
      MAMEnrollmentManager.Result.MDM_ENROLLED -> SUCCEEDED
      MAMEnrollmentManager.Result.NOT_LICENSED -> NOT_LICENSED
      MAMEnrollmentManager.Result.ENROLLMENT_FAILED -> FAILED
      MAMEnrollmentManager.Result.PENDING -> PENDING
      MAMEnrollmentManager.Result.AUTHORIZATION_NEEDED -> AUTHORIZATION_NEEDED
      MAMEnrollmentManager.Result.COMPANY_PORTAL_REQUIRED -> COMPANY_PORTAL_REQUIRED
      MAMEnrollmentManager.Result.WRONG_USER -> WRONG_USER
      MAMEnrollmentManager.Result.UNENROLLMENT_SUCCEEDED -> UNENROLLED
      MAMEnrollmentManager.Result.UNENROLLMENT_FAILED -> UNENROLLMENT_FAILED
      // Android has no equivalent of iOS's LicensedNotTargeted: the service reports
      // NOT_LICENSED for an untargeted account too, so `notTargeted` never appears from
      // this platform. Recorded in SPEC §4.1 rather than faked here.
      null -> UNKNOWN
    }

  /**
   * An `EnrollmentResult` built from a status the SDK already holds, rather than from a
   * notification.
   *
   * Needed because `registerAccountForMAM` on an already-registered account is a silent
   * no-op: no notification is ever posted, so `enroll()` has to answer from the registry
   * or wait for a result that is not coming.
   */
  fun resultFrom(status: MAMEnrollmentManager.Result, accountId: String? = null): WritableMap =
    result(
      status = unifiedStatus(status),
      accountId = accountId,
      nativeCode = status.name,
      nativeMessage = "Read from the registry; the account was already registered.",
    )

  /** Shapes an `EnrollmentResult` (SPEC §4.1). */
  private fun result(
    status: String,
    accountId: String?,
    nativeCode: String,
    nativeMessage: String,
  ): WritableMap =
    Arguments.createMap().apply {
      putString("status", status)
      putString("accountId", accountId)
      putString("nativeCode", nativeCode)
      putString("nativeMessage", nativeMessage)
      // Android does not surface a restart requirement; iOS does, via its policy
      // delegate. Kept in the shape so one branch in JS serves both platforms.
      putBoolean("restartRequired", false)
    }

  /**
   * Registers one receiver per notification type we act on, and returns them so they can
   * be unregistered.
   *
   * `emit` is expected to queue when JS is not listening yet — a wipe notification lost
   * during startup means the reset machine never runs (SPEC §4.4).
   */
  fun register(emit: (event: String, payload: WritableMap) -> Unit): List<Registration> {
    val registry =
      MAMComponents.get(MAMNotificationReceiverRegistry::class.java) ?: return emptyList()

    val registrations =
      listOf(
        // Enrollment, unenrollment and the SDK's own background retries all arrive here.
        Registration(MAMNotificationType.MAM_ENROLLMENT_RESULT) { notification ->
          val enrollment = notification as? MAMEnrollmentNotification ?: return@Registration true
          val status = unifiedStatus(enrollment.enrollmentResult)
          val payload =
            result(
              status = status,
              // The Entra object ID. getUserIdentity() is the UPN and is deliberately
              // not read (CLAUDE.md rule 3).
              accountId = enrollment.userOid,
              nativeCode = enrollment.enrollmentResult?.name.orEmpty(),
              nativeMessage = enrollment.error?.toString().orEmpty(),
            )

          val event =
            if (status == UNENROLLED || status == UNENROLLMENT_FAILED) {
              "unenrollmentResult"
            } else {
              "enrollmentResult"
            }
          emit(event, payload)
          true
        },

        // An administrator changed policy. The app has to re-read whatever UI it gates.
        Registration(MAMNotificationType.REFRESH_POLICY) {
          emit("policyChanged", Arguments.createMap())
          true
        },

        // Service-initiated. Can arrive with no prior app call at all, which is the whole
        // reason the emitter is live from construction.
        Registration(MAMNotificationType.WIPE_USER_DATA) { notification ->
          emit(
            "wipeRequested",
            Arguments.createMap().apply {
              putString("accountId", (notification as? MAMUserNotification)?.userOid)
            },
          )
          // Returning true tells the SDK the app handled the wipe. The app's own data is
          // cleared through the reset journal, because the process may not survive long
          // enough to do it inline (SPEC §7).
          true
        },

        // The account is no longer managed — policy has been removed rather than wiped.
        Registration(MAMNotificationType.MANAGEMENT_REMOVED) { notification ->
          emit(
            "unenrollmentResult",
            result(
              status = UNENROLLED,
              accountId = (notification as? MAMUserNotification)?.userOid,
              nativeCode = "MANAGEMENT_REMOVED",
              nativeMessage = "",
            ),
          )
          true
        },
      )

    registrations.forEach { registry.registerReceiver(it.receiver, it.type) }
    return registrations
  }

  fun unregister(registrations: List<Registration>) {
    val registry =
      MAMComponents.get(MAMNotificationReceiverRegistry::class.java) ?: return
    registrations.forEach { registry.unregisterReceiver(it.receiver, it.type) }
  }

  internal class Registration(
    val type: MAMNotificationType,
    handle: (MAMNotification) -> Boolean,
  ) {
    val receiver = MAMNotificationReceiver { notification -> handle(notification) }
  }
}
