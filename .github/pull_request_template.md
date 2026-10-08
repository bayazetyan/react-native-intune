## What and why

<!-- What changes, and why. Link the issue if there is one. -->

## How it was run

<!--
For anything touching native code, the plugin, setup, doctor or android/build.gradle:
which platform was actually run, on which device or simulator, and against which tenant.
Not "should work" — what you ran. "Built on iOS, not run" is a useful answer; a claimed
test that did not happen is not.
-->

- Platform:
- Device or simulator:
- Tenant: <!-- your own test tenant, or "none — not enrolled" -->

## Checklist

- [ ] `yarn lint && yarn typecheck && yarn test`
- [ ] Nothing under `vendor/` is committed
- [ ] No tokens, UPNs or account IDs in logs, files or tests
- [ ] Public API changed: the documentation site updated in this PR
- [ ] Learned something the hard way: it is on the Traps page
