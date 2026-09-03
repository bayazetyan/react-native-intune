# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this repo is

`react-native-intune` — a React Native native module wrapping the **Microsoft Intune App SDK** (MAM / App Protection Policies) for iOS and Android. New Architecture only: TurboModule + Codegen. RN 0.74+.

`SPEC.md` is the contract. Read it before writing code. If a change contradicts the spec, say so and stop — do not silently diverge.

There is no official Microsoft support for React Native here. A meaningful share of this work is empirical: read the SDK headers, run it, observe.

## Non-negotiable rules

1. **Never invent an SDK API name, constant, or enum value.** The vendored SDK is the source of truth — read `vendor/ios/*.xcframework/**/Headers/*.h` and the Android AAR's classes. If you cannot find a symbol, say you cannot find it. Do not produce plausible-looking code with a guessed selector; it wastes a build cycle and, worse, sometimes compiles.
2. **Never commit SDK binaries.** They are license-encumbered and large. `vendor/` is gitignored; `scripts/fetch-sdks` pins the version.
3. **Never log or persist tokens, UPNs, or account IDs.** Account IDs may appear in in-memory state and in `getDiagnostics()`; they must not reach analytics, crash reports, or files. Hash before storing anything.
4. **No `ADAL*` identity keys in any `Info.plist`.** This module configures identity at runtime only. A conflicting plist key alongside a runtime override is a known cause of enrollment failures — see SPEC §5.3.
5. **Do not write code after an unregister call and expect it to run.** The process is expected to terminate. All post-unregister work goes through the journal (SPEC §7).
6. **Do not treat "enrollment not succeeded" as "block the user."** `NOT_LICENSED` explicitly must not block. See SPEC §8 and preserve that distinction in every code path and every doc string.
7. **The SDK-facing iOS layer stays Objective-C.** Codegen conformance and `getTurboModule:` are ObjC++ (`.mm`) because they are C++ — that boundary is unavoidable. SDK calls and delegate conformance stay in `.m` deliberately, so enrollment failures are debugged across one language boundary rather than two. Swift is fine for self-contained logic that never touches the SDK. Do not move the SDK layer to Swift without the two checks in SPEC §5.1.1.
8. **The module owns MSAL.** Sign-in, broker configuration, MAM token acquisition and MSAL cache cleanup are ours (`authMode: 'builtin'`). `external` mode exists for apps with their own MSAL and must be kept working — it is not a documentation fallback. MSAL's keychain group must stay `com.microsoft.adalcache` unless the consumer overrides it, in which case `ADALCacheKeychainGroupOverride` is set from the same value in the same code path. Never let the two disagree.
9. **The MAM service token is never returned to JS.** Acquired internally, passed to the SDK, not logged. Only tokens for the app's own scopes cross the bridge.
10. **Single identity is a decided constraint, not an assumption.** Two accounts are never signed in at once. Do not add identity tagging, `setCurrentThreadAccountId`, per-identity storage, or `MultiIdentity` handling. If a task seems to require them, the requirement changed — stop and say so.
11. **Keep the Codegen spec file loose and the public API strict.** `src/NativeIntune.ts` obeys Codegen's type limits; `src/index.ts` adds real types. Never leak `Object` into the public API.

## Build-config invariants

- `codegenConfig.name` is fixed once. Renaming it touches every native file — do not change it casually.
- `jsSrcsDir` must contain exactly **one** `Native*.ts` file. Extra ones are picked up by Codegen and fail confusingly.
- Use `install_modules_dependencies(s)` in the podspec. Do not hand-roll React-Core / folly dependencies or `RCT_NEW_ARCH_ENABLED` flags.
- **The MAM Gradle plugin is applied in the consumer's app module, never in this library's `build.gradle`.** It rewrites bytecode across the whole app and its dependencies; applying it here would rewrite only the library and look like success.
- `IntuneMAMConfigurator` operates on the *host app's* plist and entitlements, so it cannot run from the podspec. It is a consumer build phase.
- Java 17 and the Kotlin version must satisfy both the MAM SDK compatibility matrix (SPEC §6.1) and the host app's toolchain.

## Layout

```
src/NativeIntune.ts   Codegen spec — the only file Codegen reads
src/index.ts             public API, typed wrappers, enum narrowing
src/types.ts             enums and shared types
ios/                     ObjC / ObjC++ implementation
android/                 Kotlin implementation
example/                 example app; the only place we test against a real tenant
scripts/fetch-sdks       downloads pinned SDKs into vendor/
```

## Scaffolding

The package was generated with:

```bash
npx create-react-native-library@latest react-native-intune
# type: Turbo module   backend: Kotlin & Objective-C   example: yes
```

That tool configures `react-native-builder-bob` as the build step. Treat its output as a starting point — `SPEC.md` §12 documents what the generated config must end up looking like, including the vendored-SDK wiring it does not know about.

## Commands

```bash
yarn                            # install
yarn typecheck
yarn lint
yarn test
yarn build                      # bob build (library output)

yarn workspace example ios      # run example on iOS
yarn workspace example android  # run example on Android

# after touching src/NativeIntune.ts, Codegen must re-run:
cd example/ios && bundle exec pod install
cd example/android && ./gradlew generateCodegenArtifactsFromSchema
```

Changing the spec file without re-running Codegen produces confusing native build errors. If a native build fails right after a spec edit, re-run Codegen before debugging anything else.

## Platform gotchas worth re-reading before you touch the relevant area

**iOS**
- Keychain groups, in order: app bundle ID first, then `com.microsoft.intune.mam`, then `com.microsoft.adalcache` (or the host app's custom MSAL group, with `ADALCacheKeychainGroupOverride` set to match).
- `STRIP_SWIFT_SYMBOLS = NO`, `ENABLE_BITCODE = NO`.
- `IntuneMAMConfigurator` writes `Info.plist` and entitlements. It is idempotent and must be re-run when the plist, entitlements, or SDK version change. Keep it as a build script phase in the example app, never a manual step.
- Runtime overrides persist across restarts until cleared. That is a feature for per-tenant config and a hazard for tenant switching.
- `deRegisterAndUnenrollAccountId` blocks until the Intune AAD token is acquired and must be called before the host app purges Entra tokens.

**Android**
- The Gradle plugin rewrites bytecode across the app **and every dependency** — since SDK 8.0 libraries cannot be processed selectively. Suspect the plugin first when a previously-working third-party library breaks.
- Javassist version must match the SDK exactly (3.29.2-GA for SDK ≥ 10.0.0). Use `mavenCentral()`, not `jcenter()` as the docs still say.
- The auth callback must be registered in `Application.onCreate` / `onMAMCreate`, earlier than JS exists. The consumer wires it; we provide the class.
- `acquireToken` runs on a background thread. Bridging to JS needs a timeout and a defined failure path.
- `<queries>` for the broker apps is mandatory on Android 11+. Without it MSAL silently falls back to a browser instead of the broker and brokered auth "just doesn't work" with no error.
- Enable MAM Strict Mode in debug builds. It throws on integration bugs that would otherwise leave data unprotected.

## When something doesn't work

Check in this order — most Intune "bugs" are one of these:

1. Is the test account targeted with an App Protection Policy, and licensed?
2. Is Company Portal installed (Android) or Authenticator/Company Portal present (iOS)?
3. Has the policy propagated? Propagation is on Microsoft's schedule, not ours. Waiting is often the fix.
4. Is the PIN absent because of the shared global PIN timer rather than a defect? A device restart resets it.
5. Did the process terminate after an unregister? That is expected, not a crash.
6. Are there other SDK-integrated apps on the device (Outlook, Teams, OneDrive) changing observed behaviour? Microsoft's test guidance is to remove them.
7. Did the Gradle plugin's HTML report (`example/android/app/build/outputs/intune/<variant>/logs/IntuneMAMBuildReport.html`, with `report = true`) show the replacements you expected? One HTML file per rewritten class sits beside it. Microsoft's docs say `build/outputs/logs`; that is not where it lands.

## Code style

- TypeScript strict. No `any` in the public API.
- Kotlin for Android, Objective-C for iOS bridging. Follow the existing file split in `SPEC.md` §2 rather than adding new top-level files.
- Every native method that can fail rejects with a stable string error code, never a raw platform error. Map platform enums to the unified codes in `SPEC.md` §4.1.
- Comments explain *why*, especially where a workaround exists for a known SDK defect — link the GitHub issue number.
- Prefer adding a `[verify]` note in `SPEC.md` over guessing when documentation and headers disagree.

## This is a public open-source library

- **All code, comments, identifiers, commit messages and docs in English.** No exceptions.
- The API in `SPEC.md` §13 is a semver contract. Adding to it is a minor; changing or removing anything is a major. `PolicySnapshot.raw` and anything documented as internal are excluded — keep them labelled.
- **Never commit or publish the Intune SDK binaries.** They are Microsoft's, under Microsoft's licence terms. `vendor/` is gitignored and must be excluded from `package.json` `files`. A published tarball containing them is a licensing problem, not a packaging bug.
- `resolveToken` / `rejectToken` are in the Codegen spec but are not public API — `setTokenProvider` wraps them. Do not document them as callable.
- Unknown native enum values map to `Unknown`, never throw. An SDK update that adds a status must not crash a shipped app.
- When adding a public method, update `SPEC.md` §13 and the README in the same PR. A method that exists in code but not in the reference does not exist.

## Commits and PRs

- Conventional commits.
- A PR touching native code states which platform was actually run, on which device or simulator, and against which tenant.
- Never claim a code path was tested against a real tenant if it was not. Enrollment paths cannot be verified by unit tests.
