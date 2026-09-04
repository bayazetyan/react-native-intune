//
//  Copyright (c) 2026 react-native-intune contributors. MIT.
//

#import "RNIntunePolicy.h"
#import "RNIntuneCore.h"

#import <IntuneMAMSwift/IntuneMAMSwift.h>

/// Names the policy channel. An SDK update that adds a source must not produce a crash
/// or an empty string, so anything unrecognised keeps its number.
static NSString *RNIntunePolicySourceName(IntuneMAMPolicySource source)
{
  switch (source) {
    case IntuneMAMPolicySource_MDM:
      return @"MDM";
    case IntuneMAMPolicySource_MAM:
      return @"MAM";
    case IntuneMAMPolicySource_Other:
      return @"Other";
  }
  return [NSString stringWithFormat:@"Unknown(%ld)", (long)source];
}

@implementation RNIntunePolicy

+ (nullable NSDictionary<NSString *, id> *)snapshot
{
  if (!RNIntuneCore.shared.sdkAvailable) {
    return nil;
  }

  IntuneMAMPolicyManager *manager = IntuneMAMPolicyManager.instance;

  // Ask for the *primary account's* policy, not `manager.policy`.
  //
  // `manager.policy` returns the policy for the current thread's identity, and no
  // identity is set on the React Native JS thread — so the SDK answers with a default
  // permissive policy object. It is not nil, which is what makes this so quiet: every
  // field reads as "allowed" and the snapshot looks like a tenant with no restrictions.
  // Found on device: an App Protection Policy with `Screen capture: Block` and Edge
  // required still reported screenshots allowed and no managed browser.
  //
  // `primaryAccountId` is the single-identity accessor — the header says it is for
  // applications that do not support multiple managed accounts, which is us by decision
  // (SPEC §9). This is a read; it is not `setCurrentThreadAccountId`, and CLAUDE.md
  // rule 10 still holds.
  NSString *primaryAccountId = manager.primaryAccountId;
  BOOL haveIdentity = primaryAccountId.length > 0;

  id<IntuneMAMPolicy> policy = haveIdentity
      ? [manager policyForAccountId:primaryAccountId]
      : manager.policy;
  BOOL managed = haveIdentity ? [manager isAccountIdManaged:primaryAccountId]
                              : manager.isManagementEnabled;

  if (policy == nil) {
    // Unmanaged is not an error: an app with no policy is fully permissive, and
    // reporting `false` everywhere would hide functionality nothing is restricting.
    return @{
      @"isManaged" : @NO,
      @"canSaveToLocal" : @YES,
      @"canSaveToPersonal" : @YES,
      @"canOpenFromUnmanaged" : @YES,
      @"screenshotAllowed" : @YES,
      @"raw" : @{
        @"hasPrimaryAccount" : haveIdentity ? @"true" : @"false",
        @"policySource" : RNIntunePolicySourceName(manager.mamPolicySource),
      },
    };
  }

  // `withAccountId:nil` means the current identity. Single identity is decided, so there
  // is never another one to ask about (SPEC §9, CLAUDE.md rule 10).
  BOOL saveLocal = [policy isSaveToAllowedForLocation:IntuneMAMSaveLocationLocalDrive
                                        withAccountId:nil];
  BOOL savePersonal = [policy isSaveToAllowedForLocation:IntuneMAMSaveLocationOther
                                           withAccountId:nil];
  BOOL openUnmanaged = [policy isOpenFromAllowedForLocation:IntuneMAMOpenLocationOther
                                              withAccountId:nil];

  // Everything else the SDK reports, as strings. Explicitly outside semver: anything
  // depended on here has to be promoted to a typed field first (SPEC §4.3).
  NSDictionary<NSString *, NSString *> *raw = @{
    @"isPINRequired" : policy.isPINRequired ? @"true" : @"false",
    @"isManagedBrowserRequired" : policy.isManagedBrowserRequired ? @"true" : @"false",
    @"isContactSyncAllowed" : policy.isContactSyncAllowed ? @"true" : @"false",
    @"isSpotlightIndexingAllowed" : policy.isSpotlightIndexingAllowed ? @"true" : @"false",
    @"areSiriIntentsAllowed" : policy.areSiriIntentsAllowed ? @"true" : @"false",
    @"isAppSharingAllowed" : policy.isAppSharingAllowed ? @"true" : @"false",
    @"isFileEncryptionRequired" : policy.isFileEncryptionRequired ? @"true" : @"false",
    @"notificationPolicy" :
        [NSString stringWithFormat:@"%ld", (long)policy.notificationPolicy],
    // Diagnostic, not policy. An all-permissive snapshot means one of two things, and
    // these two values say which: no identity resolved, or a policy that came from
    // somewhere other than the MAM channel. Boolean only — the account ID itself must
    // not travel here (CLAUDE.md rule 3).
    @"hasPrimaryAccount" : haveIdentity ? @"true" : @"false",
    @"policySource" : RNIntunePolicySourceName(manager.mamPolicySource),
  };

  return @{
    @"isManaged" : @(managed),
    @"canSaveToLocal" : @(saveLocal),
    @"canSaveToPersonal" : @(savePersonal),
    @"canOpenFromUnmanaged" : @(openUnmanaged),
    @"screenshotAllowed" : @(policy.isScreenCaptureAllowed),
    @"raw" : raw,
  };
}

@end
