//
//  Copyright (c) 2026 react-native-intune contributors. MIT.
//

#import "RNIntunePlistGuard.h"
#import "RNIntuneCore.h"

/// The `IntuneMAMSettings` dictionary in the host app's Info.plist, and the keys inside
/// it that the SDK reads at launch. Verified against the strings in the 21.8.0, 21.9.0 and 21.9.1 binaries.
static NSString *const kSettingsKey = @"IntuneMAMSettings";
static NSString *const kClientId = @"ADALClientId";
static NSString *const kAuthority = @"ADALAuthority";
static NSString *const kRedirectUri = @"ADALRedirectUri";
static NSString *const kKeychainGroup = @"ADALCacheKeychainGroupOverride";
static NSString *const kMaxFileProtection = @"MaxFileProtectionLevel";

@implementation RNIntunePlistGuard

+ (NSDictionary *)settings
{
  id settings = NSBundle.mainBundle.infoDictionary[kSettingsKey];
  return [settings isKindOfClass:NSDictionary.class] ? settings : @{};
}

+ (BOOL)hasIdentityKeys
{
  NSDictionary *plist = [self settings];
  return plist[kClientId] != nil || plist[kAuthority] != nil ||
         plist[kRedirectUri] != nil;
}

+ (NSString *)maxFileProtectionLevel
{
  return [self settings][kMaxFileProtection] ?: @"";
}

+ (NSString *)keychainGroupOverride
{
  NSString *value = [self settings][kKeychainGroup];
  return [value isKindOfClass:NSString.class] ? value : @"";
}

+ (BOOL)check:(RNIntuneConfig *)config error:(NSError *_Nullable *_Nullable)error
{
  return [self checkIdentityKeys:error] && [self checkKeychainGroup:config error:error] &&
         [self checkFileProtection:config error:error];
}

#pragma mark - 1. Hardcoded identity next to a runtime override

/**
 * GitHub issue #405: the plist value and the runtime override disagree, and enrollment
 * fails with no indication which one won. CLAUDE.md rule 4 forbids these keys outright
 * for exactly this reason.
 */
+ (BOOL)checkIdentityKeys:(NSError *_Nullable *_Nullable)error
{
  NSDictionary *plist = [self settings];
  NSMutableArray<NSString *> *present = [NSMutableArray new];
  for (NSString *key in @[ kClientId, kAuthority, kRedirectUri ]) {
    if (plist[key] != nil) {
      [present addObject:key];
    }
  }
  if (present.count == 0) {
    return YES;
  }

  if (error) {
    *error = [RNIntuneCore
        errorWithCode:RNIntuneErrorPlistConflict
              message:[NSString
                          stringWithFormat:
                              @"Info.plist -> IntuneMAMSettings contains %@, which "
                              @"conflicts with the values passed to configure(). This "
                              @"module configures identity at runtime only. Remove these "
                              @"keys — a conflicting plist key alongside a runtime "
                              @"override is a known cause of enrollment failing with "
                              @"AuthRequired.",
                              [present componentsJoinedByString:@", "]]];
  }
  return NO;
}

#pragma mark - 2. Keychain group, which has no runtime setter

/**
 * `ADALCacheKeychainGroupOverride` is read from the plist at launch, so the module cannot
 * "set it to match" as SPEC §5.1.2 originally described. The best it can do is refuse to
 * let the two disagree — MSAL's cache and the SDK's must never diverge.
 */
+ (BOOL)checkKeychainGroup:(RNIntuneConfig *)config
                     error:(NSError *_Nullable *_Nullable)error
{
  NSString *wanted =
      config.keychainGroupOverride.length > 0 ? config.keychainGroupOverride : nil;
  if (wanted == nil) {
    return YES;
  }

  NSString *inPlist = [self settings][kKeychainGroup];
  if ([inPlist isEqualToString:wanted]) {
    return YES;
  }

  if (error) {
    *error = [RNIntuneCore
        errorWithCode:RNIntuneErrorPlistConflict
              message:[NSString stringWithFormat:
                                    @"configure() asked for keychain group \"%@\" but "
                                    @"Info.plist -> IntuneMAMSettings -> %@ is \"%@\". "
                                    @"This key has no runtime equivalent, so it must be "
                                    @"set in the plist.",
                                    wanted, kKeychainGroup, inPlist ?: @"(absent)"]];
  }
  return NO;
}

#pragma mark - 3. MaxFileProtectionLevel, likewise plist-only

/**
 * Silently ignoring a requested value is how an app ends up with a local database that
 * becomes unreadable ten seconds after the device locks (SPEC §5.2, open question O-D).
 */
+ (BOOL)checkFileProtection:(RNIntuneConfig *)config
                      error:(NSError *_Nullable *_Nullable)error
{
  BOOL isDefault = [config.maxFileProtectionLevel isEqualToString:@"complete"];
  if (isDefault || [self settings][kMaxFileProtection] != nil) {
    return YES;
  }

  if (error) {
    *error = [RNIntuneCore
        errorWithCode:RNIntuneErrorPlistConflict
              message:[NSString
                          stringWithFormat:
                              @"configure() asked for maxFileProtectionLevel \"%@\", but "
                              @"%@ has no runtime equivalent and is absent from "
                              @"Info.plist -> IntuneMAMSettings. Set it there (the SDK "
                              @"reads it at launch) or drop the option.",
                              config.maxFileProtectionLevel, kMaxFileProtection]];
  }
  return NO;
}

@end
