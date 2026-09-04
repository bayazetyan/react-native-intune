//
//  Copyright (c) 2026 react-native-intune contributors. MIT.
//

#import "RNIntuneReset.h"
#import "RNIntuneCore.h"
#import "RNIntuneResetJournal.h"

#import <IntuneMAMSwift/IntuneMAMSwift.h>

@implementation RNIntuneReset

+ (void)runWithWipe:(BOOL)wipe
             reason:(NSString *)reason
           tenantId:(NSString *)tenantId
{
  IntuneMAMEnrollmentManager *manager =
      RNIntuneCore.shared.sdkAvailable ? IntuneMAMEnrollmentManager.instance : nil;

  // Every *registered* account, not just the enrolled one. An account whose enrollment
  // failed is still registered, and the SDK keeps retrying it on a 24-hour schedule
  // until it is unregistered — so leaving those behind is precisely the "incomplete
  // reset is actively harmful" case in SPEC §7. Found by a runtime test that left a
  // failed registration behind and then could not close the journal.
  NSArray<NSString *> *accountIds = [manager.registeredAccountIds copy] ?: @[];
  NSString *enrolled = manager.enrolledAccountId;

  // Written first, and forced to disk, because the next call may end the process.
  [RNIntuneResetJournal.shared openWithAccountId:enrolled ?: accountIds.firstObject
                                        tenantId:tenantId
                                            wipe:wipe
                                          reason:reason];

  for (NSString *accountId in accountIds) {
    if (accountId.length == 0) {
      continue;
    }
    // Blocks while acquiring the Intune AAD token (SPEC §5.3). The caller runs this off
    // the main thread.
    [manager deRegisterAndUnenrollAccountId:accountId withWipe:wipe];
  }

  // Reached only if the process survived. Clearing the overrides is what makes a tenant
  // switch possible afterwards — they persist across restarts otherwise (SPEC §5.2).
  [RNIntuneResetJournal.shared advanceToStage:RNIntuneResetStageCleaningAuth];
  IntuneMAMSettings.aadClientIdOverride = nil;
  IntuneMAMSettings.aadAuthorityUriOverride = nil;
  IntuneMAMSettings.aadRedirectUriOverride = nil;

  // MSAL cache cleanup belongs here. SPEC §7 step 4 still says the host app does it
  // because the module does not own MSAL — that predates §3, which decided the module
  // does. In 'builtin' mode it becomes ours and lands with S-3; in 'external' it stays
  // the host app's. Issues #539 and #464 are both residual MSAL state, so this step is
  // not cosmetic.

  [RNIntuneResetJournal.shared advanceToStage:RNIntuneResetStageCleaningLocal];
}

+ (BOOL)complete
{
  if (RNIntuneResetJournal.shared.entry == nil) {
    return YES;
  }

  // Verify rather than assume (SPEC §7 step 5). A reset that did not take must stay open
  // and be retried, because the SDK resumes enrollment retries on its own schedule and a
  // half-finished reset is worse than none.
  if (RNIntuneCore.shared.sdkAvailable) {
    IntuneMAMEnrollmentManager *manager = IntuneMAMEnrollmentManager.instance;
    NSString *stillEnrolled = manager.enrolledAccountId;
    NSArray *stillRegistered = manager.registeredAccountIds;
    if (stillEnrolled.length > 0 || stillRegistered.count > 0) {
      return NO;
    }
  }

  [RNIntuneResetJournal.shared close];
  return YES;
}

@end
