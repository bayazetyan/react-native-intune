# ProGuard/R8 rules shipped to consumers of this library.
#
# Wired through `consumerProguardFiles`, so an app that enables minification gets them
# without having to discover any of this. It shipped broken otherwise: a release build
# with R8 fails outright, and only a release build — every debug build and the unminified
# release both succeed, so this is invisible until someone ships.
#
# All three entries are `-dontwarn`, not `-keep`. Nothing here is called at runtime on the
# paths this module uses; the classes are referenced from code branches that never execute,
# and R8 refuses to finish while it cannot resolve a reference it can see.

# `nimbus-jose-jwt`, MSAL's JWT library, has optional support for BouncyCastle and Google
# Tink and references both unconditionally. Neither is a declared dependency of MSAL, and
# MSAL's own AAR ships no ProGuard rules at all — verified by unpacking it — so the gap
# lands on whoever brings MSAL in. That is us.
-dontwarn org.bouncycastle.**
-dontwarn com.google.crypto.tink.**

# `com.microsoft.device.display:display-mask` is excluded from the MSAL dependency on
# purpose (SPEC §6.1.2): it is published only to Microsoft's own Azure DevOps feed and a
# library cannot add a repository on its consumers' behalf. MSAL references it from
# `DualScreenActivity.getHinge`, for Surface Duo dual-screen layout, which is a path this
# module never takes.
#
# This is the cost of that exclusion, and it only appeared here — sign-in and enrollment
# both work without the artifact, so the `[verify]` note in §6.1.2 was answered by a
# release build rather than by a device.
-dontwarn com.microsoft.device.display.**
