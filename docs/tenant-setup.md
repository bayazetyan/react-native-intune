# Setting up the Intune test tenant

Six phases across two Microsoft consoles, in the order they have to happen. Every value
you need to type is filled in from this repository, and every phase ends with a way to
tell whether it actually worked.

This is the walkthrough. `SPEC.md` §14 is the specification-level summary; where the two
disagree, the spec is the contract and this is the procedure.

For what a **customer** has to do once the module ships — and what is safe to send them —
see [`customer-onboarding.md`](./customer-onboarding.md).

| Phase | | Rough time |
|---|---|---|
| [00](#00--before-you-start) | Before you start | 10 min |
| [01](#01--register-the-app) | Register the app | 15 min |
| [02](#02--grant-access-to-the-mam-service) | Grant access to the MAM service | 5 min |
| [03](#03--users-licences-and-a-group) | Users, licences and a group | 20 min |
| [04](#04--app-protection-policies) | App protection policies | 25 min |
| [05](#05--devices-and-brokers) | Devices and brokers | 15 min |
| [06](#06--wire-it-into-the-app) | Wire it into the app | 10 min |
| — | [Things that look broken and are not](#things-that-look-broken-and-are-not) | |

> **Portal labels move.** Microsoft renames and reshuffles these menus regularly. The
> paths below were accurate when written; if a label has moved, the console's own search
> box usually finds it faster than hunting the tree. The *values* — permission names,
> bundle IDs, redirect URIs — do not move.

---

## Who does this — you, or your customer?

You are following this now against your own test tenant, where you play both roles. In
production the work splits, and the split is not even.

**Always the customer's, under any arrangement.** These live in their Entra and Intune
tenants and cannot be done on their behalf:

- **Phase 03** — Intune licences assigned to their people
- **Phase 04** — App protection policies in their Intune, targeting your bundle ID
- **Phase 05** — Company Portal on their devices

**Never the customer's to invent.** The bundle ID `intune.example`, the signature hash and
both redirect URIs are properties of the binary you ship. They are the same string for
every customer. Where a customer types them, you supply them.

**Phases 01–02 depend on an open decision** — `SPEC.md` §3.6, O-H. Either you hold one
multi-tenant registration and the customer's admin only approves a consent link, or each
customer creates their own registration and sends you the resulting `clientId` and
`tenantId`. The module takes `clientId` at runtime either way, so this is a commercial
question — whether your customers require the registration to sit in their own directory —
rather than a technical one.

Until it is answered, follow this runbook as written: it is the per-customer shape, which
is the more demanding of the two.

---

## 00 — Before you start

Nothing below works without these three.

### An account that can actually do this

Sign in with a **work or school account** in your own tenant. A personal Microsoft
account cannot open either console at all. You need **Global Administrator**, or this
pair: **Application Administrator** (to register the app and grant consent) plus
**Intune Administrator** (to create policies).

### An Intune subscription with licences to assign

Intune Plan 1, or any of Microsoft 365 E3 / E5 / Business Premium, which include it. A
free trial is enough for everything here. Start one at
[admin.microsoft.com](https://admin.microsoft.com) → *Billing* → *Purchase services*.

### The two consoles

| Console | Address | What lives there |
|---|---|---|
| Microsoft Entra admin center | [entra.microsoft.com](https://entra.microsoft.com) | App registration, permissions, users, licences, groups |
| Microsoft Intune admin center | [intune.microsoft.com](https://intune.microsoft.com) | App protection policies |

Both are reachable from `portal.azure.com` via the top search bar. The old Intune address
`endpoint.microsoft.com` still redirects.

---

## 01 — Register the app

Produces `clientId`, `tenantId` and the two redirect URIs.

> entra.microsoft.com › Identity › Applications › App registrations › **New registration**

1. **Name** — something you will recognise in a list a year from now.
   `react-native-intune — test` works.
2. **Supported account types** — *Accounts in this organizational directory only (single
   tenant)*. Fine for testing; the production choice is a separate decision.
3. **Redirect URI** — leave blank on this screen. Platforms are added next, and Entra
   builds the URIs for you.
4. Press **Register**. On **Overview**, copy **Application (client) ID** and **Directory
   (tenant) ID** into the table in [phase 06](#06--wire-it-into-the-app).

### Add the iOS platform

> Authentication › Add a platform › **iOS / macOS**

| Field | Value |
|---|---|
| Bundle ID | `intune.example` |
| Entra will show | `msauth.intune.example://auth` |

### Add the Android platform

> Authentication › Add a platform › **Android**

| Field | Value |
|---|---|
| Package name | `intune.example` |
| Signature hash | `Xo8WBi6jzSxKDVR4drqm84yr9iU=` |
| Entra will show | `msauth://intune.example/Xo8WBi6jzSxKDVR4drqm84yr9iU%3D` |

The hash above is this machine's debug keystore, read on 4 September 2026. A different
machine has a different one — re-derive it with:

```bash
keytool -exportcert -alias androiddebugkey \
  -keystore ~/.android/debug.keystore -storepass android \
  | openssl sha1 -binary | openssl base64
```

> **One hash is enough today — but know when a second one appears.**
>
> Debug and release builds are signed with different keys and therefore have different
> hashes, so an app normally needs both registered here. **The example app in this
> repository is not there yet:** `example/android/app/build.gradle` signs its `release`
> build with `signingConfigs.debug`, the same key as debug. So the hash above covers
> both, and there is nothing else to add. Skip ahead to *Allow public client flows*.
>
> This changes the moment the **product** app gets a real release keystore. On that day,
> come back to this screen and add its hash as a second Android platform entry:
>
> ```bash
> keytool -exportcert -alias <your-release-alias> \
>   -keystore <path/to/release.keystore> \
>   | openssl sha1 -binary | openssl base64
> ```
>
> Miss it and the first release build fails with
> `MsalClientException: The redirect URI in the configuration file doesn't match` —
> months later, with nothing pointing back at this screen.

### Allow public client flows

> Authentication › Advanced settings › **Allow public client flows** → **Yes**

Then **Save**. A mobile app has no client secret; without this, sign-in fails.

**Checkpoint.** The Authentication page lists two platforms, each with one redirect URI.
Overview shows a client ID and a tenant ID that you have written down.

---

## 02 — Grant access to the MAM service

Five minutes, and the single most common cause of a failed enrollment.

> Your app registration › API permissions › Add a permission › **APIs my organization uses**

1. Search for **Microsoft Mobile Application Management** and select it. *Not* Microsoft
   Graph, and not Microsoft Intune — this is its own API.
2. Choose **Delegated permissions**.
3. Tick `DeviceManagementManagedApps.ReadWrite`, then **Add permissions**.
4. Press **Grant admin consent for &lt;your tenant&gt;** and confirm.

> **Grant consent even though the column says it is not required.** The *Admin consent
> required* column shows **No** for this permission. Grant it anyway. Skipping this is
> the most common reason an otherwise perfect integration returns `authorizationNeeded`
> forever — and nothing in the error says why.

> **The API is missing from the list?** Then Intune is not provisioned in this tenant
> yet. Go back to phase 00, make sure the subscription is active, give it a few minutes
> and reload.

**Checkpoint.** The permissions table has a row for
`DeviceManagementManagedApps.ReadWrite` with a green tick and *Granted for &lt;tenant&gt;*
in the Status column. A warning triangle means consent did not go through.

---

## 03 — Users, licences and a group

Four users, because four different result codes have to be reachable.

> entra.microsoft.com › Identity › Users › **New user** › Create new user

| User | Set up as | Reaches | App must |
|---|---|---|---|
| **A** | Licence + targeted by policy | `succeeded` | Proceed, protected |
| **B** | Licence, **not** targeted | `notTargeted` | **Not** block |
| **C** | **No** licence | `notLicensed` | **Not** block |
| **D** | Licence + policy, already enrolled elsewhere on the device | `wrongUser` | Block this account |

Without B and C you cannot verify the enforcement rule that matters most — that a user
without a licence, or without a policy aimed at them, is **not** locked out. Getting that
backwards breaks every customer who has staff outside the Intune licence pool. See
`SPEC.md` §8.

### Assign the licences

> Identity › Users › *pick a user* › Licenses › **Assignments**

> **Owning a licence is not assigning it.** A licence sitting in the subscription does
> nothing. It has to be assigned to each person individually on this screen. An
> unassigned licence produces `notLicensed` against a technically perfect integration,
> and the error looks like a code bug.

### Create the group

> Identity › Groups › **New group**

- Group type **Security**, membership type **Assigned**.
- Name it after its job: `intune-module-test`.
- Add users **A** and **D** only. Not B — B is the untargeted case.

Policies attach to groups, never to individual users. This group is what phase 04 points
at.

**Checkpoint.** Open user A → *Licenses* and confirm an Intune licence is listed. Open the
group → *Members* and confirm exactly A and D are in it.

---

## 04 — App protection policies

The one step where people get stuck looking for their app in a list.

> intune.microsoft.com › Apps › App protection policies › **Create policy** › iOS/iPadOS *or* Android

Create one for each platform. The wizard has six steps:

1. **Basics** — name it after its purpose: `strict — iOS — module test`.
2. **Apps** — set *Target policy to* → **Selected apps**. Then under *Custom apps* choose
   **Select custom apps** and **type the bundle ID or package name by hand**:
   `intune.example`.
3. **Data protection** — copy/paste limits, screenshot blocking, save-as, encryption.
4. **Access requirements** — PIN, biometrics.
5. **Conditional launch** — minimum OS, jailbreak/root detection, offline grace period,
   max PIN attempts.
6. **Assignments** — the `intune-module-test` group from phase 03.

> **Your app is not in the list, and does not need to be.** Step 2 is where first-timers
> stall: the app picker shows Microsoft's catalogue and your app is not in it. It does
> not have to be. It does not need to be published to a store, uploaded to Intune, or
> registered anywhere — typing the bundle ID under *Custom apps* is exactly how an app
> still in development gets covered.

### Make three per platform, not one

| Policy | Settings | Isolates |
|---|---|---|
| **strict** | PIN, copy/paste blocked, screenshots blocked, encryption on | Everything at once |
| **permissive** | Almost everything allowed | A baseline to compare against |
| **PIN only** | PIN required, nothing else | PIN behaviour on its own |

Six policies feels like a lot to create by hand. It costs twenty minutes once and saves
the far worse afternoon of not knowing which of four settings caused the behaviour you
are looking at.

> **Propagation runs on Microsoft's schedule.** A new or changed policy does not reach the
> device immediately, and there is no way to force it. Before concluding anything is
> broken, wait — then wait again. This is the most common false alarm in Intune work.

**Checkpoint.** *App protection policies* lists six entries. Open one → *Properties* and
confirm `intune.example` appears under the apps, and the test group under assignments.

---

## 05 — Devices and brokers

The simulator and emulator this repository has been using are not enough from here on.

Everything up to this point was verified on an iPhone simulator and an Android emulator.
That stops working now: broker apps and policy enforcement behave differently on real
hardware, and enrollment cannot be trusted on either.

- **One physical iPhone** and **one physical Android**, ideally from different
  manufacturers.
- **Company Portal** — mandatory on Android, from Google Play. Enrollment cannot happen
  without it, which is why `getBrokerStatus()` reports `required: true` there.
- **Microsoft Authenticator** — on iOS this is the broker; Company Portal also works. iOS
  can enroll without either, so `required` is `false`.
- **Remove other Intune-integrated apps** — Outlook, Teams, OneDrive. They share the app
  PIN and the enrolled account, so they change what you observe. This is Microsoft's own
  testing guidance.

**Checkpoint.** Run the example app on each device. `getBrokerStatus` should report
`companyPortalInstalled: true` on Android and `authenticatorInstalled: true` on iOS. If it
still says false with the app clearly installed, the manifest query entries are missing —
but this repository already ships them, so it should just work.

---

## 06 — Wire it into the app

The example app calls `configure()` with deliberately fake GUIDs. Replace them in
`example/src/App.tsx`:

```ts
await Intune.configure({
  clientId:    '<Application (client) ID from phase 01>',
  tenantId:    '<Directory (tenant) ID from phase 01>',
  authority:   'https://login.microsoftonline.com/<tenantId>',
  redirectUri: Platform.OS === 'ios'
    ? 'msauth.intune.example://auth'
    : 'msauth://intune.example/Xo8WBi6jzSxKDVR4drqm84yr9iU%3D',
  verboseLogging: true,
});
```

Fill this in as you go, so phase 06 is copy-and-paste:

| Value | |
|---|---|
| `clientId` | *from Overview, phase 01* |
| `tenantId` | *from Overview, phase 01* |
| `redirectUri` · iOS | `msauth.intune.example://auth` |
| `redirectUri` · Android | `msauth://intune.example/Xo8WBi6jzSxKDVR4drqm84yr9iU%3D` |
| MAM resource | `https://msmamservice.api.application` |
| Test group | `intune-module-test` |

The MAM resource is only needed if you build a token provider by hand — the value is read
from the SDK's own call site, not from documentation.

> **Do not put these in `Info.plist`.** There are `IntuneMAMSettings` plist keys —
> `ADALClientId`, `ADALAuthority`, `ADALRedirectUri` — that look like the right place for
> these values. They are not. This module configures identity at runtime, and a plist key
> alongside a runtime override is a known cause of enrollment failing with
> `AuthRequired`. `configure()` already refuses to start with `E_PLIST_CONFLICT` if it
> finds one, so you will be told rather than left guessing. See `SPEC.md` §5.1.2.

**Checkpoint — the whole runbook, in one screen.** Sign in as user **A** and enroll. You
should see `succeeded`, and `getState` should report an `enrolledAccountId`. Then repeat
with **B** and **C**: both must come back non-blocking (`notTargeted`, `notLicensed`) and
the app must stay usable.

If enrollment fails, read `nativeCode` before anything else — it carries the SDK's own
constant name, and it is the difference between "unlicensed" and "licensed but
untargeted", which look identical from the unified status alone.

---

## Things that look broken and are not

**No PIN prompt appeared.** The app PIN is shared across every Intune-managed app on the
device, on one global timer. If you unlocked Outlook ten minutes ago, your app will not
ask again. A device restart resets the timer.

**The app died after unregistering.** Expected and documented. Unregistering an account
that had policy enforced makes the SDK wipe its data and terminate the process. That is
why this module writes a reset journal and finishes the sequence on the next launch
(`SPEC.md` §7).

**Policy changes have not arrived.** Propagation is Microsoft's schedule. Waiting
genuinely is the fix more often than not.

**Behaviour changed and nothing in your code did.** Another Intune-integrated app on the
device — Outlook, Teams, OneDrive — shares state with yours. Remove them between runs.

**You are looking at the wrong tenant.** Both consoles have a **Directory** picker at the
top right. If a policy or user you definitely created is missing, check that before
anything else.

---

## A second tenant

Needed for the per-tenant runtime configuration test (`SPEC.md` §10 item 4, risk R1), and
not before. It needs its own app registration (phases 01 and 02) and at least one
licensed, targeted user. An Intune trial is sufficient.

## Not needed for development

Publishing to a store; adding the app to the Intune app catalogue; enrolling devices in
MDM; and registering with Microsoft's Intune app partner programme. The last one only
matters in production, when you want administrators to pick your app from the ready-made
partner list instead of typing its bundle ID — it requires a separate registration and
questionnaire with Microsoft.
