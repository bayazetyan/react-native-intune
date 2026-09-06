package com.reactnativeintune

import android.app.Activity
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.microsoft.identity.client.AcquireTokenSilentParameters
import com.microsoft.identity.client.AuthenticationCallback
import com.microsoft.identity.client.IAccount
import com.microsoft.identity.client.IAuthenticationResult
import com.microsoft.identity.client.ISingleAccountPublicClientApplication
import com.microsoft.identity.client.Prompt
import com.microsoft.identity.client.PublicClientApplication
import com.microsoft.identity.client.SignInParameters
import com.microsoft.identity.client.exception.MsalException
import com.microsoft.identity.client.exception.MsalUiRequiredException
import com.microsoft.identity.client.exception.MsalUserCancelException

/**
 * MSAL: the client, sign-in, and tokens for the app's own scopes (SPEC §3, spike S-3).
 *
 * The iOS counterpart is `ios/RNIntuneAuth.m`, and the two answer the same questions with
 * the same error codes. The mechanics differ in one way worth knowing: on iOS the module
 * builds an `MSALPublicClientApplication` from objects, while here MSAL insists on reading
 * a JSON config, so `RNIntuneMsalConfig` writes one at `configure()` time (SPEC §3.3).
 *
 * Two tokens exist and only one of them leaves this file. The MAM service token is
 * acquired by `RNIntuneAuthCallback`, handed to the SDK, and never returned to JS
 * (CLAUDE.md rule 9). Everything here is for the *app's* scopes (SPEC §3.5).
 */
internal class RNIntuneAuth(private val reactContext: ReactApplicationContext) {

  private var client: ISingleAccountPublicClientApplication? = null

  val isConfigured: Boolean
    get() = client != null

  companion object {
    /**
     * What a sign-in asks for when the caller names no scopes.
     *
     * MSAL leaves no cheaper option: it adds `openid`, `profile` and `offline_access`
     * itself and rejects a call that names them, so a sign-in must request some real
     * resource. `User.Read` is the permission Entra grants every new app registration,
     * and it is what Microsoft's own samples use to mean "just sign in".
     *
     * Which scope fetched the token does not matter for enrollment: the refresh token is
     * per account, not per resource, and the MAM token is acquired separately.
     */
    val DEFAULT_SCOPES: List<String> = listOf("https://graph.microsoft.com/User.Read")
  }

  /**
   * Builds the MSAL client for one tenant. Blocking, and it does disk and network setup —
   * the caller runs it off the main thread.
   *
   * Throws rather than returning a flag so `configure()` fails loudly here instead of at
   * the first sign-in, where the cause is much harder to see.
   */
  @Throws(MsalException::class, InterruptedException::class)
  fun configure(clientId: String, authority: String, redirectUri: String) {
    val file = RNIntuneMsalConfig.write(reactContext, clientId, authority, redirectUri)
    client = PublicClientApplication.createSingleAccountPublicClientApplication(
      reactContext.applicationContext,
      file,
    )
  }

  /** Drops the client. Called from reset, which must leave nothing pinned to the tenant. */
  fun invalidate() {
    client = null
  }

  // ------------------------------------------------------------------------ sign-in

  /**
   * Interactive sign-in. Uses Company Portal as the broker when present, which is what
   * makes the resulting token acceptable to the MAM service.
   *
   * Needs a foreground Activity, and there may not be one — React Native survives its
   * Activity being destroyed, so this is a real failure mode rather than a formality.
   */
  fun signIn(
    scopes: List<String>,
    loginHint: String?,
    prompt: String?,
    onResult: (WritableMap) -> Unit,
    onError: (String, String) -> Unit,
  ) {
    val app = client ?: return onError(
      RNIntuneModule.ERR_NOT_CONFIGURED,
      "MSAL is not configured. Call configure first.",
    )
    val activity: Activity = reactContext.currentActivity ?: return onError(
      RNIntuneModule.ERR_NO_ACTIVITY,
      "signIn needs a foreground Activity and there is none. Call it from a mounted " +
        "screen rather than during startup or from the background.",
    )

    val params = SignInParameters.builder()
      .withActivity(activity)
      .withScopes(if (scopes.isEmpty()) DEFAULT_SCOPES else scopes)
      .withPrompt(promptFrom(prompt))
      .withCallback(callback(onResult, onError))
      .apply { if (!loginHint.isNullOrEmpty()) withLoginHint(loginHint) }
      .build()

    // A signed-in account changes which call is legal, and the wrong one fails outright:
    // `signIn` throws "An account is already signed in." in SINGLE account mode. iOS has
    // no such rule — `acquireTokenWithParameters:` works either way — so smoothing this
    // over belongs here rather than in every consumer.
    val existing = currentAccount()
    if (existing == null) {
      app.signIn(params)
      return
    }

    // Already signed in: answer from the cache, which is also the better experience —
    // no UI at all for the common case of an app restart.
    val silent = AcquireTokenSilentParameters.Builder()
      .withScopes(if (scopes.isEmpty()) DEFAULT_SCOPES else scopes)
      .forAccount(existing)
      .fromAuthority(existing.authority)
      .build()

    val cached = runCatching { app.acquireTokenSilent(silent) }.getOrNull()
    if (cached != null) {
      onResult(toAuthResult(cached))
      return
    }

    // The cache could not answer, so re-authenticate the account that is already there.
    // `signInAgain` rather than `signIn`, which is the same distinction as above.
    app.signInAgain(params)
  }

  /**
   * Cache-first. Fails with `E_INTERACTION_REQUIRED` when a prompt is needed — the
   * caller's pattern is silent first, interactive on that failure.
   *
   * Blocking, so the caller runs it off the main thread. The async variants exist, but
   * every caller here is already on a background thread and the blocking form keeps the
   * error handling in one place.
   */
  fun acquireTokenSilent(
    scopes: List<String>,
    forceRefresh: Boolean,
    onResult: (WritableMap) -> Unit,
    onError: (String, String) -> Unit,
  ) {
    val app = client ?: return onError(
      RNIntuneModule.ERR_NOT_CONFIGURED,
      "MSAL is not configured. Call configure first.",
    )

    val account = currentAccount()
    if (account == null) {
      // Not a fault: with no cached account there is nothing to refresh, and the caller's
      // next move is the same as for an expired token.
      onError(
        RNIntuneModule.ERR_INTERACTION_REQUIRED,
        "No signed-in account is cached. Call signIn to acquire one.",
      )
      return
    }

    val params = AcquireTokenSilentParameters.Builder()
      .withScopes(if (scopes.isEmpty()) DEFAULT_SCOPES else scopes)
      .forAccount(account)
      .fromAuthority(account.authority)
      .forceRefresh(forceRefresh)
      .build()

    try {
      onResult(toAuthResult(app.acquireTokenSilent(params)))
    } catch (e: Throwable) {
      val (code, message) = map(e)
      onError(code, message)
    }
  }

  /**
   * A MAM service token, acquired silently for the SDK.
   *
   * This is the Android half of "the module owns MAM token acquisition" (CLAUDE.md rule
   * 8), and it exists because Android gives no equivalent of the iOS escape hatch. There,
   * the module simply does not implement the token delegate and the SDK helps itself from
   * the shared MSAL cache. Here `MAMServiceAuthenticationCallback` is mandatory and the
   * SDK always asks the app, so in `builtin` mode the app has to answer — from the same
   * MSAL instance, without involving JS.
   *
   * Blocking, and called on the SDK's own background thread, which is what it wants: the
   * callback must return the token synchronously.
   *
   * The return value is a token. It is handed to the SDK and nothing else — never logged,
   * never stored, never returned across the bridge (CLAUDE.md rule 9). The `null` path
   * deliberately carries no detail for the same reason.
   */
  fun mamServiceToken(resourceId: String): String? {
    val app = client ?: return null
    val account = currentAccount() ?: return null

    // `<resource>/.default` is how MSAL asks for every statically-granted permission on a
    // resource, which is what the MAM service expects. The SDK passes the resource as an
    // app id GUID; the constant form in RNIntuneAuthCallback is the same resource written
    // as a URI, and either is accepted here.
    val params = AcquireTokenSilentParameters.Builder()
      .withScopes(listOf("$resourceId/.default"))
      .forAccount(account)
      .fromAuthority(account.authority)
      .build()

    return runCatching { app.acquireTokenSilent(params).accessToken }.getOrNull()
  }

  // ------------------------------------------------------------------------ accounts

  /**
   * The signed-in account as an `AuthAccount` list, or an empty one.
   *
   * A list of at most one, because the client is SINGLE-account mode — the shape matches
   * iOS and the public API, where more than one entry would mean state a reset should
   * have cleared (SPEC §9).
   */
  fun accounts(): List<WritableMap> {
    val account = currentAccount() ?: return emptyList()
    return listOf(
      Arguments.createMap().apply {
        putString("accountId", objectIdOf(account))
        putString("tenantId", account.tenantId.orEmpty())
        putString("username", account.username.orEmpty())
      },
    )
  }

  /**
   * The signed-in account's UPN, which Android enrollment needs alongside the object ID.
   *
   * This is the seam `RNIntuneModule.knownUpnFor` was left for:
   * `registerAccountForMAM` takes both and will not accept a null UPN, and the public API
   * deliberately carries only the object ID (SPEC §6.3).
   */
  fun upnFor(accountId: String): String? {
    val account = currentAccount() ?: return null
    return if (objectIdOf(account) == accountId) account.username else null
  }

  /**
   * Removes the account and its tokens from the MSAL cache — the half of reset the module
   * could not do while MSAL lived in the host app (SPEC §7 step 4).
   *
   * Blocking. Errors are swallowed on purpose: this runs inside the reset sequence, where
   * the journal's verification decides whether the reset took, not this call.
   */
  fun signOutQuietly() {
    runCatching { client?.signOut() }
  }

  // ------------------------------------------------------------------------ internals

  private fun currentAccount(): IAccount? =
    runCatching { client?.currentAccount?.currentAccount }.getOrNull()

  /**
   * The Entra object ID, which is what `enroll()` and the Intune SDK want.
   *
   * `oid` from the claims is the authoritative source; `getId()` is the fallback because
   * for an AAD account MSAL populates it from the same value. Guessing wrong here does not
   * fail loudly — it registers the wrong identity — so both are consulted.
   */
  private fun objectIdOf(account: IAccount): String {
    val fromClaims = account.claims?.get("oid")?.toString()
    return if (!fromClaims.isNullOrEmpty()) fromClaims else account.id.orEmpty()
  }

  private fun toAuthResult(result: IAuthenticationResult): WritableMap =
    Arguments.createMap().apply {
      putString("accountId", objectIdOf(result.account))
      putString("tenantId", result.tenantId.orEmpty())
      putString("username", result.account.username.orEmpty())
      putString("accessToken", result.accessToken)
      putString("idToken", result.account.idToken)
      // Unix seconds, matching AuthResult in SPEC §13.1.1 and the iOS implementation.
      putDouble("expiresOn", (result.expiresOn?.time ?: 0L) / 1000.0)
      putArray(
        "scopes",
        Arguments.createArray().apply { result.scope?.forEach { pushString(it) } },
      )
    }

  private fun callback(
    onResult: (WritableMap) -> Unit,
    onError: (String, String) -> Unit,
  ) = object : AuthenticationCallback {
    override fun onSuccess(result: IAuthenticationResult) = onResult(toAuthResult(result))

    override fun onError(exception: MsalException) {
      val (code, message) = map(exception)
      onError(code, message)
    }

    override fun onCancel() {
      onError(
        RNIntuneModule.ERR_USER_CANCELLED,
        "The user dismissed the sign-in UI.",
      )
    }
  }

  private fun promptFrom(prompt: String?): Prompt = when (prompt) {
    "selectAccount" -> Prompt.SELECT_ACCOUNT
    "login" -> Prompt.LOGIN
    "consent" -> Prompt.CONSENT
    "whenRequired" -> Prompt.WHEN_REQUIRED
    // Including null. An unrecognised value must not fail a sign-in: a string added to
    // the JS enum later would otherwise break every already-shipped native binary.
    else -> Prompt.WHEN_REQUIRED
  }

  /** MSAL's outcome onto one of the stable codes in SPEC §13.6. */
  private fun map(e: Throwable): Pair<String, String> = when (e) {
    is MsalUiRequiredException -> RNIntuneModule.ERR_INTERACTION_REQUIRED to
      "A prompt is required. Call signIn instead of signInSilent."
    is MsalUserCancelException -> RNIntuneModule.ERR_USER_CANCELLED to
      "The user dismissed the sign-in UI."
    // Everything else keeps MSAL's own message, which names the cause better than a
    // re-worded guess would. No token or claim is ever part of it.
    else -> RNIntuneModule.ERR_NATIVE to (e.message ?: "MSAL failed with no description.")
  }
}
