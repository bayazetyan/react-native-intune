package com.reactnativeintune

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The per-tenant MSAL configuration, written to a file at `configure()` time (SPEC §3.3).
 *
 * MSAL on Android normally reads this from a raw resource, which is a build-time artifact
 * and therefore fixed at compile time. This module configures a tenant at runtime, so the
 * JSON is generated and handed to the `File` overload of the factory instead. That is the
 * whole reason this file exists.
 *
 * Every key here was read out of MSAL 8.4.2 rather than from documentation: the shape came
 * from `res/raw/msal_default_config.json` inside the AAR, and `authority_url` / `type` /
 * `default` were confirmed as the serialized names on
 * `com.microsoft.identity.common.java.authorities.Authority`. A key MSAL does not
 * recognise is ignored silently, which is exactly the kind of failure that costs a day.
 */
internal object RNIntuneMsalConfig {

  private const val FILE_NAME = "rn-intune-msal-config.json"

  /**
   * Writes the config and returns the file.
   *
   * Rewritten on every `configure()` rather than cached: the tenant can change between
   * launches, and a stale file would point MSAL at the previous customer.
   */
  fun write(
    context: Context,
    clientId: String,
    authority: String,
    redirectUri: String,
  ): File {
    val file = File(context.filesDir, FILE_NAME)
    file.writeText(build(clientId, authority, redirectUri).toString(2))
    return file
  }

  /** Exposed for tests and for `getDiagnostics`; contains no secrets. */
  fun build(clientId: String, authority: String, redirectUri: String): JSONObject =
    JSONObject().apply {
      put("client_id", clientId)
      put("redirect_uri", redirectUri)

      // `authority_url` rather than an `audience` block: the URL is what `configure()`
      // already carries, and it sidesteps having to map a tenant onto one of MSAL's
      // audience type strings.
      put(
        "authorities",
        JSONArray().put(
          JSONObject().apply {
            put("type", "AAD")
            put("authority_url", authority)
            put("default", true)
          },
        ),
      )

      // Single identity is a decided constraint, not a default we are accepting
      // (SPEC §9, CLAUDE.md rule 10). SINGLE also gives us
      // ISingleAccountPublicClientApplication, whose API cannot express two signed-in
      // accounts — the constraint is enforced by the type, not by our discipline.
      put("account_mode", "SINGLE")

      // Both required for brokered auth, which MAM enrollment depends on. Without the
      // first, MSAL will not hand the request to Company Portal at all.
      put("broker_redirect_uri_registered", true)
      put("authorization_user_agent", "DEFAULT")

      // Sovereign clouds. Harmless for the public cloud and the difference between
      // working and not for a customer in one (SPEC §3.3).
      put("multiple_clouds_supported", true)
    }
}
