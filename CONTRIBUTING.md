# Contributing

Contributions are welcome. Please read the [code of conduct](./CODE_OF_CONDUCT.md) first.

Two things about this project are unusual, and both affect how you contribute:

**The Microsoft Intune App SDK is not in this repository.** It is Microsoft's, under
Microsoft's terms, and we neither ship nor relicense it. Nothing builds until you download
it yourself (below).

**Most of what this library does cannot be tested without an Intune tenant.** Enrollment,
policy delivery, PIN enforcement, remote wipe — none of it has a unit test, because none of
it can have one. The unit tests cover decoding and pure logic. Everything else was verified
by running it on a physical device against a real tenant, and a change to those paths has to
be verified the same way. See [Verifying native changes](#verifying-native-changes).

## No CLA

There is no CLA and no DCO. This project is inbound=outbound: your contribution is licensed
under the same MIT licence as the rest of our code, and you keep your copyright. Nothing to
sign.

That licence covers **our** code only. It does not cover the Intune App SDK, which you are
downloading from Microsoft under their terms — see [`NOTICE`](./NOTICE).

## Getting set up

Yarn workspaces monorepo: the library at the root, an example app in [`example/`](./example).
Use the Node version in [`.nvmrc`](./.nvmrc). `npm` will not work without migrating the
workspaces by hand.

```sh
yarn
```

Then download the SDKs. **This step asks you to accept Microsoft's licence terms**, prints
where they are, and writes into `vendor/`, which is gitignored:

```sh
node scripts/fetch-sdks.mjs
```

Versions are pinned in [`sdk-versions.json`](./sdk-versions.json) and every downloaded file
is checksummed against [`sdk-lock.json`](./sdk-lock.json). A bump to either is a deliberate
change, not a routine update — the SDK version decides the minimum iOS version and the whole
Android toolchain row.

**Never commit anything under `vendor/`.** A published tarball containing Microsoft's
binaries is a licensing problem, not a packaging mistake.

## Running the example

The example app is configured against the local library, so JavaScript changes appear without
a rebuild and native changes need one.

```sh
yarn example start      # Metro
yarn example ios
yarn example android
```

The example enrolls against a real tenant. To point it at yours, copy
`example/tenant.example.json` to `example/tenant.json` — gitignored — and fill it in.
[`docs/tenant-setup.md`](./docs/tenant-setup.md) walks through the Entra and Intune consoles,
including the test users you need to reach every result code.

On Android, run `./gradlew :app:assembleDebug` rather than `./gradlew assembleDebug`. The
root form also builds this library's AAR, which AGP refuses to package because of the local
`.aar` dependency; consumers never hit this, because autolinking consumes the library as a
Gradle project.

### After changing the Codegen spec

`src/NativeIntune.ts` is the only file Codegen reads. Change it and Codegen must re-run, or
you get native build errors that point somewhere else entirely:

```sh
cd example/ios && bundle exec pod install
cd example/android && ./gradlew generateCodegenArtifactsFromSchema
```

If a native build breaks immediately after a spec edit, re-run Codegen before debugging
anything else.

## Checks

```sh
yarn typecheck
yarn lint          # --fix to format
yarn test
```

Pre-commit hooks run typecheck and lint on staged files, and check the commit message.

## Verifying native changes

**A pull request touching native code must say which platform was actually run, on which
device or simulator, and against which tenant.** Not "should work" — what you ran.

If you could not run it, say that too. An honest "built on iOS, not run; Android untouched"
is useful. A claim that an enrollment path was tested when it was not costs the next person
a day, because the failures in this area name the wrong cause almost every time: a missing
keychain entitlement surfaces as an authorization error, a missing URL type as a login loop
with an empty log, an unregistered auth callback as a licensing-shaped status that retries
quietly forever.

Before assuming you found a bug in this library, work through
[Before you open an issue](./README.md#before-you-open-an-issue). Most Intune "bugs" are one
of those seven things, and policy propagation is on Microsoft's schedule rather than ours —
waiting is often the fix.

## House rules

- **English only** — code, comments, identifiers, commit messages, documentation. No
  exceptions.
- **Never invent an SDK symbol.** The vendored SDK is the source of truth: read the iOS
  headers under `vendor/ios/*.xcframework/**/Headers/` and the Android AAR's classes. If you
  cannot find a selector, say so. A guessed one sometimes compiles, which is worse than
  failing.
- **Never log or persist tokens, UPNs or account IDs.** They may appear in in-memory state
  and in `getDiagnostics()`; they must not reach analytics, crash reports or files.
- **"Enrollment did not succeed" never means "block the user."** `notLicensed` in particular
  must not block. Preserve that distinction in every code path and every doc string.
- Comments explain *why*, especially where a workaround exists for an SDK defect. Link the
  issue number.
- TypeScript strict, no `any` in the public API. Unknown native enum values map to `Unknown`
  and never throw — an SDK update that adds a status must not crash a shipped app.
- Adding a public method means updating the README in the same pull request. A method that
  exists in code but not in the documentation does not exist.

## Commit messages

[Conventional commits](https://www.conventionalcommits.org/en): `fix`, `feat`, `refactor`,
`docs`, `test`, `chore`. The subject is lowercase. The pre-commit hook enforces it.

Explain *why* in the body. This project's history is the main record of what was measured
against a real device and what was only reasoned about — a commit that says what the diff
already shows wastes that.

## Pull requests

- Small and focused on one change.
- Linters and tests passing.
- For a change to the public API or to an enrollment path, open an issue first.

## Publishing

Maintainers only:

```sh
yarn release
```

Anything documented as internal — `PolicySnapshot.raw`, `resolveToken`, `rejectToken` — is
outside the semver contract. Adding to the public API is a minor; changing or removing
anything in it is a major.
