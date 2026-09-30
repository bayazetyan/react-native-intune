<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/bayazetyan/react-native-intune/main/.github/assets/banner-dark.png">
    <img alt="react-native-intune — Microsoft Intune app protection for React Native" src="https://raw.githubusercontent.com/bayazetyan/react-native-intune/main/.github/assets/banner-light.png" width="820">
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/react-native-intune"><img alt="npm" src="https://img.shields.io/npm/v/react-native-intune?color=4B5AE4&labelColor=1B2027"></a>
  <a href="https://github.com/bayazetyan/react-native-intune/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/bayazetyan/react-native-intune/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="./LICENSE"><img alt="MIT" src="https://img.shields.io/badge/licence-MIT-4B5AE4?labelColor=1B2027"></a>
  <img alt="platforms" src="https://img.shields.io/badge/platforms-iOS%2017%2B%20%C2%B7%20Android%2024%2B-5A6478?labelColor=1B2027">
  <img alt="React Native" src="https://img.shields.io/badge/React%20Native-0.74%2B%20new%20arch-5A6478?labelColor=1B2027">
</p>

<p align="center">
  <a href="https://bayazetyan.github.io/react-native-intune/"><b>Documentation</b></a> ·
  <a href="https://bayazetyan.github.io/react-native-intune/docs/getting-started">Getting started</a> ·
  <a href="https://bayazetyan.github.io/react-native-intune/docs/notes/traps">Traps</a> ·
  <a href="https://bayazetyan.github.io/react-native-intune/docs/reference">API reference</a>
</p>

---

> **Status: pre-alpha.** Implemented and verified on real devices against a real tenant.
> The public types changed twice in the fortnight before release, so expect breaking
> changes until 1.0 and pin an exact version.

*Not affiliated with, endorsed by, or sponsored by Microsoft. Microsoft, Intune and Entra
are trademarks of the Microsoft group of companies.*

## What it does

An IT administrator in any customer tenant can target your app from their Intune console
and enforce an App Protection Policy on it: a PIN or biometric unlock, copy-paste
restrictions between managed and unmanaged apps, screenshot blocking, save-as and open-from
restrictions, encryption at rest, conditional launch rules, and a selective wipe that
removes corporate data and leaves personal data alone.

**The device does not need to be enrolled in Intune.** That is the point of MAM — the
boundary is drawn around one app, and the employee's phone stays theirs.

## What it is not

It cannot do device management, and no configuration changes that: the SDK runs inside your
app's sandbox.

| | |
|---|---|
| App-level PIN, copy-paste, screenshots, selective wipe | ✅ This library |
| Full device wipe, device passcode, disk encryption | ❌ The customer's MDM |
| Per-app VPN, network inspection, kiosk mode, inventory | ❌ The customer's MDM |

If someone asks whether this gives them "Intune device control", the answer is no. It makes
your app a first-class Intune-managed app; their MDM handles the device.

## Licensing — read before installing

**This library is MIT. The Microsoft Intune App SDK is not, and is not included here.**

The SDK is downloaded from Microsoft's own repositories by `fetch-sdks`. It is never
committed to this repository and never published in the npm package. Microsoft's terms
apply to it, they are separate from ours, and **reviewing and accepting them is your
responsibility**:

- [Intune App SDK for iOS](https://github.com/msintuneappsdk/ms-intune-app-sdk-ios)
- [Intune App SDK for Android](https://github.com/microsoftconnect/ms-intune-app-sdk-android)

[`NOTICE`](./NOTICE) is the full statement.

## Requirements

| | |
|---|---|
| React Native | 0.74+, **New Architecture required** |
| iOS | **17.0+, Xcode 26+** — MAM SDK 21.x is built against them |
| Android | minSdk 24, Java 17 — Gradle, AGP and Kotlin on Microsoft's tested row or one verified here; `doctor` says which |
| On the device | Company Portal on Android; Authenticator or Company Portal on iOS |
| In the tenant | An Entra app registration with the Intune MAM API permission granted |

## Install

```bash
npm install react-native-intune
npx react-native-intune fetch-sdks     # accepts Microsoft's terms, downloads the SDKs
```

Installing the package is the short part. **Most of this integration is changes to your own
app project** — `Info.plist`, entitlements, `AndroidManifest.xml`, your app module's
`build.gradle`, your `Application` class — and autolinking does not touch any of them.

**Expo:** add the config plugin and run `expo prebuild`. Nearly everything is applied for
you, including the auth callback in your `Application` class.

```json
{ "expo": { "plugins": [["react-native-intune", { "androidSignatureHash": "…" }]] } }
```

**Bare React Native:** two commands, then a short manual remainder.

```bash
npx react-native-intune doctor   # reports what is missing, changes nothing
npx react-native-intune setup    # applies what it can, shows a diff first
```

Then follow [iOS setup](https://bayazetyan.github.io/react-native-intune/docs/setup/ios) or
[Android setup](https://bayazetyan.github.io/react-native-intune/docs/setup/android).

> **Three of those steps fail silently when missed** — the app builds, runs, and protects
> nothing while everyone believes protection is in place. The setup guides mark which, and
> `doctor` finds them.

## Quick start

```ts
import Intune, { EnrollmentStatus } from 'react-native-intune';

// Per-tenant, from your own backend — one build serves many customers.
await Intune.configure({
  clientId: cfg.aadClientId,
  tenantId: cfg.aadTenantId,
  authority: cfg.aadAuthority,
  redirectUri: cfg.aadRedirectUri,
});

const { enrollment } = await Intune.signInAndEnroll();

// Only 'failed' means block.
if (enrollment.status === EnrollmentStatus.Failed) {
  blockCorporateData();
}
```

## Enrollment outcomes

`enroll()` **resolves** for every outcome — a failure is data, not an exception. It rejects
only for programming errors.

| Status | What your app must do |
|---|---|
| `succeeded` | Continue. Policy is in force |
| `notTargeted` | **Continue.** Nobody has aimed a policy at this app yet |
| `notLicensed` | **Continue.** The employee has no Intune licence and is still a legitimate employee |
| `failed` | Block access to corporate data until it succeeds |
| `pending` · `authorizationNeeded` · `wrongUser` · `companyPortalRequired` | Handle it — see the reference |
| `unenrolled` · `unenrollmentFailed` · `unknown` | Reset states, and one to treat conservatively |

> **The most common integration bug in libraries like this one** is treating anything that
> is not `succeeded` as "block the user". That breaks every customer with staff who have no
> Intune licence, and every pilot where the policy has not been targeted yet — while the app
> reports itself as secure. `notLicensed` and `notTargeted` mean the opposite of `failed`,
> and that distinction is prescribed by Microsoft rather than invented here.

[All eleven outcomes, and what to do with each](https://bayazetyan.github.io/react-native-intune/docs/guides/enrollment-outcomes)

## Where the rest is

| | |
|---|---|
| [Traps and field notes](https://bayazetyan.github.io/react-native-intune/docs/notes/traps) | 23 things that each cost somebody a day and are in no Microsoft documentation |
| [Authentication](https://bayazetyan.github.io/react-native-intune/docs/guides/authentication) | The broker, MSAL, and using your own instead |
| [Reconcile at launch](https://bayazetyan.github.io/react-native-intune/docs/guides/reconcile-at-launch) | The pattern to drive enrollment from, and why not from lifecycle hooks |
| [Reset and wipe](https://bayazetyan.github.io/react-native-intune/docs/guides/reset-and-wipe) | One code path, several callers, and a process that may not survive it |
| [Troubleshooting](https://bayazetyan.github.io/react-native-intune/docs/troubleshooting) | The seven checks worth doing before opening an issue |
| [API reference](https://bayazetyan.github.io/react-native-intune/docs/reference) | Generated from the source |

## Contributing

[How to contribute](https://bayazetyan.github.io/react-native-intune/docs/contributing/).
In short: nothing builds until you accept Microsoft's terms and run `fetch-sdks`, `vendor/`
is never committed, and a pull request touching native code states which platform was
actually run, on which device, against which tenant. Enrollment paths cannot be verified by
unit tests and CI does not pretend otherwise.

## License

MIT — see [`LICENSE`](./LICENSE). It covers this library's code and not the Microsoft Intune
App SDK; [`NOTICE`](./NOTICE) says what belongs to whom.
