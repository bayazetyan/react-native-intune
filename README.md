# react-native-intune

Microsoft Intune app protection policies (MAM) for React Native — **app-level data protection, not device management.**

Bundles MSAL with broker support, so sign-in and enrollment work out of the box.

*Not affiliated with or endorsed by Microsoft. "Intune" is a trademark of Microsoft Corporation.*

> **Status: pre-alpha, under active development.** The API described here is implemented against `SPEC.md` but has not been released. Expect breaking changes until 1.0.

---

## What this is

A native module wrapping the [Microsoft Intune App SDK](https://learn.microsoft.com/en-us/intune/developer/app-sdk/) for iOS and Android, so a React Native app can be managed by Intune **App Protection Policies** (also called MAM policies).

Once integrated, an IT administrator in any customer tenant can target your app from their Intune console and enforce:

- App-level PIN or biometric unlock
- Copy/paste restrictions between managed and unmanaged apps
- Screenshot blocking
- Save-as and open-from restrictions
- Encryption of app data at rest
- Selective wipe — corporate data removed, personal data untouched
- Conditional launch rules — minimum OS, jailbreak/root detection, offline grace period

The device does **not** need to be enrolled in Intune for any of this. That is the point of MAM.

## What this is not

This library **cannot** do device management (MDM), and no amount of configuration will change that — the SDK runs inside your app's sandbox:

| | |
|---|---|
| Inspect or route device network traffic | ❌ Customer's MDM + VPN profile |
| Per-app VPN | ❌ Customer pushes the profile; your app only needs to be targetable |
| Full device wipe, device passcode, disk encryption | ❌ Customer's MDM |
| Manage other apps, kiosk mode, device inventory | ❌ Customer's MDM |
| App-level PIN, copy/paste, screenshots, selective wipe | ✅ This library |

If someone asks whether this gives them "Intune device control", the answer is no. It makes your app a first-class Intune-managed app; their MDM handles the device.

---

## Licensing — read before installing

**This library is MIT licensed. The Microsoft Intune App SDK is not, and is not included here.**

The SDK binaries are downloaded at install time from Microsoft's own repositories by `scripts/fetch-sdks`. They are never committed to this repository and never published in the npm package. Microsoft's licence terms apply to them, they are separate from this library's licence, and **you are responsible for reviewing and accepting them**:

- [Intune App SDK for iOS — licence terms](https://github.com/msintuneappsdk/ms-intune-app-sdk-ios)
- [Intune App SDK for Android](https://github.com/microsoftconnect/ms-intune-app-sdk-android)

See [`NOTICE`](./NOTICE) for the full statement.

---

## Requirements

| | |
|---|---|
| React Native | 0.74+, **New Architecture required** (TurboModules) |
| iOS | 16.0+, Xcode 16+ |
| Android | minSdk 24, Java 17, AGP/Gradle/Kotlin per the [MAM SDK compatibility matrix](https://learn.microsoft.com/en-us/intune/developer/app-sdk/android-phase-3) |
| Auth | **Included.** MSAL with broker support ships with this library. If your app already has its own MSAL, use `authMode: 'external'` — see [Authentication](#authentication) |
| Android runtime | The **Intune Company Portal** app must be installed on the device. There is no workaround |
| Entra | An app registration per tenant, with the Intune MAM API permission granted |

---

## Installation

```bash
npm install react-native-intune
npx react-native-intune fetch-sdks     # downloads the pinned Microsoft SDKs
```

Then wire it into your project. Installing the package is not enough: most of this integration is changes to *your* app project — `Info.plist`, entitlements, `AndroidManifest.xml`, your app module's `build.gradle`, your `Application` class — and autolinking does not touch those.

**Expo:** add the config plugin and run `expo prebuild`. Almost everything below is applied for you.

```json
{ "expo": { "plugins": ["react-native-intune"] } }
```

**Bare React Native:** two commands, then a short manual remainder.

```bash
npx react-native-intune doctor   # reports what is missing, changes nothing
npx react-native-intune setup    # applies what can be applied, shows a diff first
```

`setup` handles the parts that are identical in every project: the Gradle plugin, broker `<queries>`, keychain groups, Xcode build settings, the configurator build phase. It **cannot** do three things, because they depend on your project or your signing key, and it will tell you so and exit non-zero:

- changing your `Application` class's superclass to `MAMApplication`
- the `BrowserTabActivity` redirect, which needs your keystore's signature hash
- registering the auth callback inside your `onMAMCreate`

`setup` never runs on install, is idempotent, and refuses to touch a dirty git tree without `--force`. The full manual reference is below — read it even if you use `setup`, because three of these steps fail *silently* when missed.

### iOS

1. `cd ios && pod install`

2. **Keychain sharing — this is for the SDK, not for your app's data.** The two Microsoft groups exist because token and policy state is shared between separate processes: the broker (Authenticator / Company Portal) writes a token and the SDK inside your process reads it. iOS isolates the keychain per app, so an access group is the only way that hand-off works.

   You are free to store your own data however you like — MMKV, files, SQLite. This step does not constrain that.

   Enable the Keychain Sharing capability and set the access groups **in this order**:

   ```
   $(AppIdentifierPrefix)<your.bundle.id>          ← must be first
   $(AppIdentifierPrefix)com.microsoft.intune.mam
   $(AppIdentifierPrefix)com.microsoft.adalcache
   ```

   Your bundle ID must be first: without an explicit access group, iOS writes to the first group in the entitlements, so a Microsoft group in that position would receive any keychain items your app does write. `com.microsoft.adalcache` is MSAL's token cache; `com.microsoft.intune.mam` is where the SDK keeps enrollment state and policy.

   Your provisioning profile's `keychain-access-groups` must contain a wildcard (`YOURBUNDLESEEDID.*`) — the Microsoft groups don't carry your prefix, so without it the entitlements won't sign. If your app already uses a custom MSAL keychain group, use that instead of `com.microsoft.adalcache` and set `ADALCacheKeychainGroupOverride` to match.

   Miss `com.microsoft.adalcache` and the broker acquires a token the SDK cannot see: enrollment fails with "could not access the user's AAD token" even though sign-in succeeded.

3. **Run `IntuneMAMConfigurator` as a build phase.** It writes the required `Info.plist` keys and entitlements, including a long and changing list of `LSApplicationQueriesSchemes` entries:

   ```sh
   "$SRCROOT/../node_modules/react-native-intune/vendor/ios/IntuneMAMConfigurator" \
     -i "$SRCROOT/YourApp/Info.plist" \
     -e "$SRCROOT/YourApp/YourApp.entitlements"
   ```

   It is idempotent. **Re-run it whenever your plist, entitlements, or the SDK version change** — make it a build phase rather than a one-time manual step.

4. **Build settings:** `STRIP_SWIFT_SYMBOLS = NO`, `ENABLE_BITCODE = NO`. If you use Xcode 26+ "Enhanced Security", disable *Authenticate pointers* and *Enable Read-only Platform Memory*.

5. **Do not add `ADALClientId`, `ADALAuthority` or `ADALRedirectUri` to `Info.plist`.** This library configures identity at runtime. A conflicting plist key alongside a runtime override is a known cause of sign-in timeouts and error 53009.

6. **SwiftUI apps:** ensure `UIApplicationSceneManifest` → `UISceneConfigurations` is present and non-empty. If it is missing, the SDK will not protect your app even when policy applies successfully.

7. Embed settings: select **Embed & Sign** for the vendored frameworks in your app target, and **Do Not Embed** for any extensions.

### Android

1. **Apply the MAM Gradle plugin to your app module** — not to this library.

   ```groovy
   // android/build.gradle
   buildscript {
     repositories { mavenCentral() }
     dependencies {
       classpath "org.javassist:javassist:3.29.2-GA"
       classpath files("../node_modules/react-native-intune/vendor/android/GradlePlugin/com.microsoft.intune.mam.build.jar")
     }
   }
   ```

   ```groovy
   // android/app/build.gradle
   apply plugin: 'com.microsoft.intune.mam'

   intunemam {
     report = true       // HTML report of replacements → build/outputs/logs
     verify = true       // catches plugin-induced runtime failures
     incremental = true
   }
   ```

   > The plugin rewrites bytecode across your whole app and all its dependencies. Applying it inside this library instead would build successfully and protect nothing.

2. **Application class.** If you subclass `android.app.Application`, the plugin transforms it for you. If you don't, set it explicitly:

   ```xml
   <application android:name="com.microsoft.intune.mam.client.app.MAMApplication" ... >
   ```

3. **Register the auth callback from your Application class.** This must happen in `onMAMCreate`, before JavaScript exists — so it cannot be done from `configure()`:

   ```kotlin
   class MainApplication : MAMApplication(), ReactApplication {
     override fun onMAMCreate() {
       super.onMAMCreate()
       RNIntune.registerAuthCallback(this)
     }
   }
   ```

4. **Broker queries and redirect activity.** Without the `<queries>` block, Android 11+ prevents your app from even detecting the broker, and MSAL silently falls back to a browser instead — brokered auth then "just doesn't work" with no error:

   ```xml
   <queries>
     <package android:name="com.azure.authenticator" />
     <package android:name="com.microsoft.windowsintune.companyportal" />
   </queries>

   <activity android:name="com.microsoft.identity.client.BrowserTabActivity" android:exported="true">
     <intent-filter>
       <action android:name="android.intent.action.VIEW" />
       <category android:name="android.intent.category.DEFAULT" />
       <category android:name="android.intent.category.BROWSABLE" />
       <data android:scheme="msauth"
             android:host="${applicationId}"
             android:path="/YOUR_URL_ENCODED_SIGNATURE_HASH" />
     </intent-filter>
   </activity>
   ```

---

## Authentication

**MSAL is included.** Sign-in, broker support, token acquisition and cache cleanup are part of this library.

That is deliberate. The Intune iOS SDK already depends on MSAL, and the two share configuration that must agree exactly — broker `<queries>`, the `msauthv2`/`msauthv3` URL schemes, the `com.microsoft.adalcache` keychain group. Split across two packages, keeping them aligned becomes your problem, and getting it wrong fails silently. Bundled, `setup` configures all of it at once.

```ts
const account = await Intune.signIn();                    // broker-based, device-wide SSO
await Intune.enroll({ accountId: account.accountId });
```

Sign-in goes through the broker (Authenticator or Company Portal) when one is present, which is what makes MAM enrollment possible at all — a browser-redirect flow cannot produce a token the MAM service accepts, and it also bypasses the device registration Conditional Access depends on. A side effect worth knowing: because the broker gives device-wide SSO, a user already signed into Outlook typically gets a token with no prompt.

### If you already have MSAL

Set `authMode: 'external'` and the module performs no sign-in. You supply the account ID and answer token requests:

```ts
await Intune.configure({ ...cfg, authMode: 'external' });

Intune.setTokenProvider(async ({ resourceId, authority }) => {
  const r = await yourMsal.acquireTokenSilent({ scopes: [`${resourceId}/.default`], authority });
  return r.accessToken;
});

await Intune.enroll({ accountId: yourAccount.identifier });   // Entra object ID, not the UPN
```

In this mode you are responsible for removing the account from your MSAL cache during a reset. In `builtin` mode `signOut({ wipeIntune: true })` does it in the right order for you.

### Two tokens, not one

The token for *your* API and the token for the *Intune MAM service* are different, with different scopes. The MAM token is acquired internally and never exposed. Use `signIn()`'s result or `acquireToken()` for your own API.

> Intune only works with Entra identities. A customer cannot both use Intune and sign in directly against a non-Microsoft IdP — federation into Entra works normally, but there is no path around Entra.

---

## Quick start

```ts
import Intune, { EnrollmentStatus } from 'react-native-intune';

// 1. Configure for this customer's tenant, from your own backend
await Intune.configure({
  clientId:    cfg.aadClientId,
  tenantId:    cfg.aadTenantId,
  authority:   cfg.aadAuthority,
  redirectUri: cfg.aadRedirectUri,
});
// Rejects with E_PLIST_CONFLICT on iOS if your Info.plist also hardcodes an
// ADALClientId / ADALAuthority / ADALRedirectUri under IntuneMAMSettings. That
// combination is a known cause of enrollment failing with AuthRequired, so it is
// refused up front rather than left to fail in a tenant you cannot reach.

// 2. Let the module clean up your local data during a reset
Intune.setResetHandler(async () => {
  await storage.clearAll();
});

// 3. Sign in and enroll
const { enrollment } = await Intune.signInAndEnroll();

if (enrollment.status === EnrollmentStatus.Failed) {
  blockCorporateData();          // licensed but not protected — do not proceed
}

// on logout: removes the MSAL account and unenrolls, in the right order
await Intune.signOut({ accountId, wipeIntune: true });
```

## Recommended pattern: reconcile at launch

Do not drive enrollment from lifecycle hooks. The app process can be killed mid-operation — during a wipe it is *expected* to be — so the only reliable approach is to compare actual state against desired state on every launch.

```ts
async function reconcile() {
  const [state, wanted] = await Promise.all([
    Intune.getState(),
    fetchTenantConfig(),      // your backend
  ]);

  if (state.pendingReset) {
    await Intune.reset({ wipe: true, reason: 'resume' });        // finish an interrupted reset
    return;
  }
  if (!wanted.intuneEnabled && state.enrolledAccountId) {
    await Intune.reset({ wipe: true, reason: 'intune_disabled' });
    return;
  }
  if (state.configured && wanted.tenantId !== state.configuredTenantId) {
    await Intune.reset({ wipe: true, reason: 'tenant_changed' });
    return;
  }
  if (wanted.intuneEnabled && !state.enrolledAccountId) {
    await signInAndEnroll();
  }
}
```

---

## Enrollment result codes

`enroll()` **resolves** for every outcome — a failure is data, not an exception. It only rejects for programming errors.

| Status | What it means | What your app must do |
|---|---|---|
| `succeeded` | Policy applied | Proceed |
| `notLicensed` | The tenant is MAM-enabled but the account has no Intune licence | **Do not block the user.** Continue unmanaged; the SDK retries periodically in case a licence appears later |
| `notTargeted` | Licensed, but no App Protection Policy targets this account | **Do not block the user.** Nothing is meant to be enforced yet — an admin has not targeted them |
| `failed` | The account *is* licensed and targeted, but enrollment failed — including the MAM service being unreachable | **Block access to corporate data** until `succeeded` |
| `pending` | First attempt in progress | You may block with a progress state |
| `companyPortalRequired` | Android, broker missing | The SDK drives the install prompt; supplement with your own copy |
| `wrongUser` | Another account is already enrolled | Block access to this account's data; the SDK prompts the user to remove one |
| `authorizationNeeded` | No valid token was supplied | Check your token provider |
| `unenrolled` / `unenrollmentFailed` | Terminal states of a reset | Handled by the reset flow |
| `unknown` | An SDK status this version doesn't map | Treat conservatively; please open an issue |

> **The most common integration bug in libraries like this one** is treating anything that isn't `succeeded` as "block the user". That breaks every customer who has staff without Intune licences, and every pilot where the policy has not been targeted yet. `notLicensed` and `notTargeted` mean the opposite of `failed` — that distinction is prescribed by Microsoft, not invented here.
>
> `enrollment.nativeCode` carries the raw SDK constant name (`LicensedNotTargeted`, `AccountNotLicensed`, `EnrollmentEndPointNetworkFailure`, …). Put it in your support logs: it is the difference between "unlicensed" and "licensed but untargeted", which look identical from the unified status alone.

---

## Reset and wipe

`reset()` unregisters the account, optionally wipes corporate data, and clears the runtime configuration. It is used for logout, tenant changes, Intune being switched off, remote wipes, and support resets.

**On Android the app process is expected to terminate during this call.** Any code written after `await Intune.reset(...)` may never run. The module writes a journal before unregistering and finishes the sequence on the next launch — which is why the reconcile-at-launch pattern above is not optional.

Two things the module cannot do for you:

1. **Remove the account from the MSAL cache.** The module doesn't own MSAL. Skipping this causes the sign-in webview to autofill the previous user and the next enrollment to fail on account mismatch.
2. **Delete your own local data.** Register `setResetHandler`.

A wipe can also be initiated by the customer's IT with no prior call from your app:

```ts
Intune.onWipeRequested(({ accountId }) => { /* … */ });
```

---

## API

Full reference: [`SPEC.md` §13](./SPEC.md#13-react-native-api-reference).

| Method | Purpose |
|---|---|
| `configure(config)` | Set up the SDK for one tenant. Required first |
| `signIn(params?)` | Broker-based sign-in. `builtin` mode only |
| `signInSilent(params)` | Cache-first sign-in; rejects with `E_INTERACTION_REQUIRED` |
| `signInAndEnroll(params?)` | Sign in and enroll in one call |
| `acquireToken(params)` | A token for your own API's scopes |
| `getAccounts()` | Accounts with cached refresh tokens |
| `signOut({ accountId, wipeIntune })` | Clear the MSAL account and optionally unenroll |
| `isSupported()` | SDK linked and prerequisites met |
| `getBrokerStatus()` | Whether Company Portal / Authenticator are present |
| `openBrokerInstall()` | Send the user to install the broker |
| `enroll({ accountId })` | Register and enroll an account |
| `getState()` | Current configuration and enrollment state |
| `getPolicy()` | Policy snapshot, for adapting your own UI |
| `reset({ wipe, reason })` | Unenroll, optionally wipe, clear config |
| `getDiagnostics()` | Opaque key/value for support bundles |
| `setTokenProvider(fn)` | Supply MAM service tokens. `external` mode only |
| `setResetHandler(fn)` | Clean up your local data during a reset |

Events: `onEnrollmentResult`, `onPolicyChanged`, `onUnenrollmentResult`, `onWipeRequested`, `onRestartRequired`, `onBrokerStatusChanged`.

Telemetry and the SDK's own PIN/blocking screens are configurable in `configure()` — the Intune SDK sends telemetry to Microsoft by default and renders Microsoft-styled screens unless you set colours and a splash icon.

**What never crosses this API:** PIN prompts, screenshot blocking, encryption and the Company Portal install screen are enforced by the SDK inside your process. `getPolicy()` exists so you can adapt your own UI — hide an export button, disable a share sheet — not so you can implement enforcement yourself.

---

## Before you open an issue

Most reports against libraries like this are environment problems. Please check, in order:

1. Is the test account **licensed** for Intune, and **targeted** by an App Protection Policy? A licence existing in the tenant is not the same as being assigned to a user.
2. Was **admin consent** granted for the *Microsoft Mobile Application Management → DeviceManagementManagedApps.ReadWrite* permission? Grant it even though the console says consent isn't required — skipping this is the top cause of `authorizationNeeded`.
3. **Android:** is Company Portal installed? Are the `<queries>` entries present?
4. **Android:** does your redirect URI's signature hash match the keystore you actually built with? Debug and release hashes differ.
5. Has the policy **propagated**? This happens on Microsoft's schedule, not yours. Waiting is often the fix.
6. Is the missing PIN prompt actually the **shared global PIN timer**? The PIN is shared across all managed apps on the device and won't be requested on every launch. Restarting the device resets the timer.
7. Did the process terminate after an unregister? **That is expected**, not a crash.
8. Are other SDK-integrated apps (Outlook, Teams, OneDrive) or the brokers on the device changing what you observe? Microsoft's own test guidance is to remove them.
9. Did the Gradle plugin's HTML report (`build/outputs/logs`, with `report = true`) show the replacements you expected?

When none of that explains it, please include: platform and OS version, React Native version, this library's version, the pinned MAM SDK version, whether Company Portal is installed, whether the account is licensed and targeted, and the `nativeCode` / `nativeMessage` from the result.

---

## Testing against your own tenant

The example app enrolls against a real tenant; there is no way to test enrollment without one. [`SPEC.md` Appendix A](./SPEC.md#14-appendix-a-test-environment-setup) is a step-by-step walkthrough of the Entra and Intune consoles: registering the app, granting the MAM permission, creating the four test users you need to reach every result code, and targeting a policy at a custom app by bundle ID.

You do **not** need to publish to a store, add the app to Intune's catalogue, enrol any devices, or register with Microsoft's app partner programme.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). In short: `SPEC.md` is the contract, all code and docs are in English, and a PR touching native code must state which platform was actually run, on which device, and against which tenant. Enrollment paths cannot be verified by unit tests, and CI does not attempt to.

## License

MIT © contributors — this library only. The Microsoft Intune App SDK is not included and is subject to Microsoft's own licence terms; see [`NOTICE`](./NOTICE).
