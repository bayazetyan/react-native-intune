//
//  Copyright (c) 2026 react-native-intune contributors. MIT.
//

#import "RNIntunePolicy.h"
#import "RNIntuneCore.h"

#import <IntuneMAMSwift/IntuneMAMSwift.h>

@implementation RNIntunePolicy

+ (nullable NSDictionary<NSString *, id> *)snapshot
{
  if (!RNIntuneCore.shared.sdkAvailable) {
    return nil;
  }

  IntuneMAMPolicyManager *manager = IntuneMAMPolicyManager.instance;
  id<IntuneMAMPolicy> policy = manager.policy;
  BOOL managed = manager.isManagementEnabled;

  if (policy == nil) {
    // Unmanaged is not an error: an app with no policy is fully permissive, and
    // reporting `false` everywhere would hide functionality nothing is restricting.
    return @{
      @"isManaged" : @NO,
      @"canSaveToLocal" : @YES,
      @"canSaveToPersonal" : @YES,
      @"canOpenFromUnmanaged" : @YES,
      @"screenshotAllowed" : @YES,
      @"raw" : @{},
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
