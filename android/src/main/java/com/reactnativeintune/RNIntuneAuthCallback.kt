package com.reactnativeintune

import android.content.Context
import android.util.Log
import com.microsoft.intune.mam.client.app.MAMComponents
import com.microsoft.intune.mam.policy.MAMEnrollmentManager
import com.microsoft.intune.mam.policy.MAMServiceAuthenticationCallbackExtended
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Supplies the MAM service token (SPEC §13.4, §6.1.2).
 *
 * **The consumer registers this from `Application.onCreate()`,** not from JS. The SDK
 * can ask for a token before any React context exists — it has its own enrollment retry
 * schedule that survives restarts — so registration has to happen earlier than JS is
 * able to run. The module supplies the class; the wiring is one line in the host app:
 *
 * ```kotlin
 * class MainApplication : Application(), ReactApplication {
 *   override fun onCreate() {
 *     super.onCreate()
 *     RNIntuneAuthCallback.register(this)
 *   }
 * }
 * ```
 *
 * `Application`, not `MAMApplication`, and `onCreate`, not `onMAMCreate`: the MAM Gradle
 * plugin rewrites both at build time. Written in source, `MAMApplication` does not
 * compile — this module declares the SDK as `implementation`, which is not transitive,
 * so it is not on the app module's classpath (issue #5).
 *
 * `acquireToken` is called **on a background thread and must return synchronously**, so
 * this blocks that thread while JS answers. That is why the timeout is not optional: the
 * SDK's thread is held for its duration.
 *
 * The token goes straight back to the SDK. It is never returned to JS, never logged, and
 * never stored (CLAUDE.md rule 9).
 */
object RNIntuneAuthCallback {

  /**
   * The MAM service resource. Read from the SDK's own call site in `AuthCallbackUtils`
   * rather than from documentation — the SDK passes this literal when it asks the app
   * for a token, so a provider building an MSAL scope needs exactly this value.
   */
  const val MAM_SERVICE_RESOURCE = "https://msmamservice.api.application"

  /**
   * How long the SDK's background thread is held while JS answers. Matches the iOS
   * timeout so the two platforms fail at the same point, but here it costs a blocked
   * thread rather than just a pending completion.
   */
  private const val TOKEN_TIMEOUT_SECONDS = 45L

  private const val TAG = "RNIntuneAuth"

  private val pending = ConcurrentHashMap<String, PendingToken>()
  private val counter = AtomicLong(0)

  @Volatile private var module: RNIntuneModule? = null

  private class PendingToken {
    val latch = CountDownLatch(1)

    @Volatile var token: String? = null

    @Volatile var failureReason: String? = null
  }

  /**
   * Call from `Application.onMAMCreate()`. Safe to call more than once.
   *
   * Note what this signature does *not* mention: no MAM SDK type appears anywhere in
   * this object's public API. The library depends on the vendored AAR with
   * `implementation` scope, so the SDK is on the consumer's runtime classpath but not
   * their compile classpath — exposing `MAMServiceAuthenticationCallbackExtended` here
   * would force every consumer to declare the SDK themselves just to write one line in
   * `onMAMCreate`. The conformance lives in a private class instead.
   */
  @JvmStatic
  fun register(context: Context) {
    val manager = MAMComponents.get(MAMEnrollmentManager::class.java)
    if (manager == null) {
      // Almost always means the MAM Gradle plugin was not applied to the app module.
      Log.e(
        TAG,
        "MAMEnrollmentManager is unavailable, so the auth callback was not registered. " +
          "This app was probably built without the MAM Gradle plugin — see the README " +
          "integration checklist.",
      )
      return
    }
    manager.registerAuthenticationCallback(Conformance)
    Log.i(TAG, "MAM service auth callback registered")
  }

  /** The SDK-facing half, kept off the public surface. */
  private object Conformance : MAMServiceAuthenticationCallbackExtended {
    override fun acquireToken(
      upn: String,
      aadId: String,
      tenantId: String?,
      authority: String?,
      resourceId: String,
    ): String? = RNIntuneAuthCallback.acquireToken(upn, aadId, tenantId, authority, resourceId)
  }

  internal fun attach(module: RNIntuneModule) {
    this.module = module
  }

  internal fun detach(module: RNIntuneModule) {
    if (this.module === module) this.module = null
    // Nothing is going to answer any more; release every held SDK thread rather than
    // leaving them blocked until the timeout.
    pending.keys.toList().forEach { reject(it, "The React context went away.") }
  }

  /**
   * Parameter order verified from the SDK's own call site
   * (`AuthCallbackUtils.acquireMAMServiceToken`), which passes
   * `rawUPN, aadId, tenantId, authority, "https://msmamservice.api.application"`.
   *
   * Worth stating because the obvious guess is wrong: `resourceId` is **last**, not
   * third, and the three-argument default overload forwards `(a, b, null, null, c)`. A
   * transposed version compiles cleanly and sends the resource ID as the tenant.
   */
  internal fun acquireToken(
    @Suppress("UNUSED_PARAMETER") upn: String,
    aadId: String,
    tenantId: String?,
    authority: String?,
    resourceId: String,
  ): String? {
    val target = module
    if (target == null) {
      Log.w(TAG, "Token requested before the React context was ready; cannot answer.")
      return null
    }

    // `builtin`: the module owns MSAL, so answer from it and never involve JS. This is
    // the Android counterpart of not claiming the token delegate on iOS — same rule,
    // opposite mechanics, because here the callback is mandatory and the SDK always asks.
    // Doing it this way also keeps the MAM token off the bridge entirely (rule 9).
    val own = target.mamServiceToken(resourceId)
    if (own != null) {
      return own
    }

    // `external`, or `builtin` with nothing cached yet: fall through to the host app's
    // provider. Returning null from here is the SDK's documented "cannot get a token
    // right now" and maps to AUTHORIZATION_NEEDED, not a hard failure — the SDK retries.
    val requestId = "tok-${counter.incrementAndGet()}"
    val slot = PendingToken()
    pending[requestId] = slot

    target.emitTokenRequest(
      requestId = requestId,
      resourceId = resourceId,
      accountId = aadId,
      tenantId = tenantId.orEmpty(),
      authority = authority.orEmpty(),
    )

    return try {
      if (!slot.latch.await(TOKEN_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
        Log.w(TAG, "Token provider did not answer within ${TOKEN_TIMEOUT_SECONDS}s.")
        null
      } else {
        // Returning null is the SDK's documented "cannot get a token right now"; it maps
        // to AUTHORIZATION_NEEDED rather than a hard failure.
        slot.failureReason?.let { Log.w(TAG, "Token provider declined: $it") }
        slot.token
      }
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      null
    } finally {
      pending.remove(requestId)
    }
  }

  internal fun resolve(requestId: String, token: String) {
    // Removed rather than read: a late answer after the timeout must not be applied.
    pending.remove(requestId)?.let {
      it.token = token
      it.latch.countDown()
    }
  }

  internal fun reject(requestId: String, reason: String) {
    pending.remove(requestId)?.let {
      it.failureReason = reason
      it.latch.countDown()
    }
  }
}
