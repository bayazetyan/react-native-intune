# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| Latest release | Yes |
| A maintenance branch named like `1.x`, while it exists | Yes |
| Anything older | No — upgrade to the latest release in its major |

A maintenance branch is cut when a new major moves to a newer Microsoft SDK line, so that
apps which cannot move with it still get fixes. Fixes land on main first and are
backported there.

## Reporting a vulnerability

**Do not open a public issue.** Report it privately through
[GitHub's vulnerability reporting](https://github.com/bayazetyan/react-native-intune/security/advisories/new).

Please include the version of this library, the platform, and what an attacker gains. Do
not include real tokens, account IDs or UPNs — a redacted log is enough.

What to expect:

- An acknowledgement within 5 working days.
- An assessment within 14 days: accepted, or declined with the reason.
- If accepted, a fix in a patch release, and a GitHub security advisory published with it,
  crediting you unless you would rather not be named.

This is maintained by one person. If a deadline slips, you will hear about it rather than
nothing.

## What is in scope

This library's own code: the iOS and Android native layers, the JavaScript API, the Expo
config plugin, and the `setup` and `doctor` tools. For example:

- a token, UPN or account ID reaching a log, a file, or JavaScript where it should not;
- the MAM service token being returned to JavaScript;
- an integration path that leaves app data unprotected while reporting that policy applies;
- `setup` writing something into a project that weakens it.

## What is not

Vulnerabilities in the **Microsoft Intune App SDK** or **MSAL** belong to Microsoft. Report
them to the [Microsoft Security Response Center](https://msrc.microsoft.com/report). If
one affects this library's users, tell us as well, so a pin can move as soon as Microsoft
ships the fix.

Tenant configuration — which policies are assigned, to whom, with what settings — is the
tenant administrator's, not this library's.
