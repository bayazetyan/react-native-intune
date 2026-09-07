//
//  Copyright (c) 2026 react-native-intune contributors. MIT.
//

#import "RNIntuneResetJournal.h"

NSString *const RNIntuneResetStageUnregistering = @"unregistering";
NSString *const RNIntuneResetStageCleaningAuth = @"cleaningAuth";
NSString *const RNIntuneResetStageCleaningLocal = @"cleaningLocal";

/**
 * NSUserDefaults rather than a file in the app container.
 *
 * SPEC §7 requires the journal to survive the wipe, and on iOS the SDK encrypts files in
 * the container under policy. Defaults are written by the app's own process and are not
 * part of the SDK's managed-file surface, so they survive both the wipe and the process
 * death that follows it — which is the whole point.
 *
 * [verify] against a real wipe once a tenant exists. Process-death survival is exercised
 * and works; wipe survival cannot be tested without a policy-targeted account, and it is
 * the half that matters most.
 */
static NSString *const RNIntuneJournalKey = @"com.reactnativeintune.resetJournal";

@implementation RNIntuneResetJournal

+ (instancetype)shared
{
  static RNIntuneResetJournal *shared = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    shared = [[self alloc] init];
  });
  return shared;
}

- (nullable NSDictionary<NSString *, id> *)entry
{
  id stored = [NSUserDefaults.standardUserDefaults objectForKey:RNIntuneJournalKey];
  return [stored isKindOfClass:NSDictionary.class] ? stored : nil;
}

- (nullable NSString *)stage
{
  id stage = self.entry[@"stage"];
  return [stage isKindOfClass:NSString.class] ? stage : nil;
}

- (void)openWithAccountId:(nullable NSString *)accountId
                 tenantId:(nullable NSString *)tenantId
                     wipe:(BOOL)wipe
                   reason:(NSString *)reason
{
  NSDictionary *entry = @{
    @"stage" : RNIntuneResetStageUnregistering,
    @"accountId" : accountId ?: @"",
    @"tenantId" : tenantId ?: @"",
    @"wipe" : @(wipe),
    @"reason" : reason ?: @"",
    @"startedAt" : @([NSDate.date timeIntervalSince1970]),
  };
  [NSUserDefaults.standardUserDefaults setObject:entry forKey:RNIntuneJournalKey];
  // Forced to disk before returning: the caller is about to make a call that may end the
  // process, and an entry still sitting in memory is an entry that never existed.
  [NSUserDefaults.standardUserDefaults synchronize];
}

- (BOOL)openForServiceWipeWithAccountId:(NSString *)accountId
                               tenantId:(NSString *)tenantId
{
  if (self.entry != nil) {
    return NO;
  }
  // `wipe: YES` because the SDK is already wiping; the flag records what happened rather
  // than requesting it. `reason` is what lets the consumer's handler tell an
  // administrator revoking access from a user logging out (SPEC §7.4).
  [self openWithAccountId:accountId tenantId:tenantId wipe:YES reason:@"remote_wipe"];
  return YES;
}

- (void)advanceToStage:(NSString *)stage
{
  NSDictionary *current = self.entry;
  if (current == nil) {
    return;
  }
  NSMutableDictionary *next = [current mutableCopy];
  next[@"stage"] = stage;
  [NSUserDefaults.standardUserDefaults setObject:next forKey:RNIntuneJournalKey];
  [NSUserDefaults.standardUserDefaults synchronize];
}

- (void)close
{
  [NSUserDefaults.standardUserDefaults removeObjectForKey:RNIntuneJournalKey];
  [NSUserDefaults.standardUserDefaults synchronize];
}

@end
