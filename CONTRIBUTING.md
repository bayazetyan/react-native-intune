# Contributing

Contributions are welcome. Please read the [code of conduct](./CODE_OF_CONDUCT.md) first.

**The full guide lives on the documentation site: [How to contribute](https://bayazetyan.github.io/react-native-intune/docs/contributing).** It is kept
there rather than duplicated here, because two copies of the same instructions disagree
within a month.

What is worth knowing before you open the guide:

## Nothing builds until you accept Microsoft's terms

The Microsoft Intune App SDK is not in this repository. It is Microsoft's, under
Microsoft's terms, and we neither ship nor relicense it.

```bash
yarn
node scripts/fetch-sdks.mjs
```

The second command prints the terms, asks you to accept them, and writes into `vendor/`,
which is gitignored. **Never commit anything under `vendor/`** — a published tarball
containing those binaries is a licensing problem, not a packaging mistake.

## Most of this cannot be unit-tested

Enrollment, policy delivery, PIN enforcement and remote wipe need a real device and a real
Intune tenant. The unit tests cover decoding and pure logic; everything else in the
documentation was verified by running it on hardware.

**A pull request touching native code states which platform was actually run, on which
device or simulator, and against which tenant.** Not "should work" — what you ran. If you
could not run it, say that instead; an honest "built on iOS, not run" is useful, and a
claimed test that did not happen costs the next person a day of looking in the wrong place.

[Setting up a test tenant](https://bayazetyan.github.io/react-native-intune/docs/contributing/tenant-setup) walks through creating one.

## No CLA

No CLA and no DCO. Inbound=outbound: your contribution is under the same MIT terms as the
rest of our code and you keep your copyright. Nothing to sign.

## House rules

- **English only** — code, comments, identifiers, commit messages, documentation.
- **Never invent an SDK symbol.** The vendored SDK is the source of truth. If you cannot
  find a selector, say so; a guessed one sometimes compiles, which is worse than failing.
- **Never log or persist tokens, UPNs or account IDs.**
- **"Enrollment did not succeed" never means "block the user."** `notLicensed` in
  particular must not block.
- Conventional commits, lowercase subject. Explain *why* in the body — this history is the
  main record of what was measured on a device and what was only reasoned about.

Found something the hard way? It goes on the
[Traps](https://bayazetyan.github.io/react-native-intune/docs/notes/traps) page, with the
severity that matches what it actually costs.
