//
//  Copyright (c) 2026 react-native-intune contributors. MIT.
//

#import "RNIntuneCore.h"

#import <UIKit/UIKit.h>

NSString *const RNIntuneErrorNotConfigured = @"E_NOT_CONFIGURED";
NSString *const RNIntuneErrorResetRequired = @"E_RESET_REQUIRED";
NSString *const RNIntuneErrorSDKUnavailable = @"E_SDK_UNAVAILABLE";
NSString *const RNIntuneErrorInvalidAccountId = @"E_INVALID_ACCOUNT_ID";
NSString *const RNIntuneErrorNotNeeded = @"E_NOT_NEEDED";
NSString *const RNIntuneErrorExternalAuthMode = @"E_EXTERNAL_AUTH_MODE";
NSString *const RNIntuneErrorNative = @"E_NATIVE";

NSString *const RNIntuneEventEnrollmentResult = @"enrollmentResult";
NSString *const RNIntuneEventPolicyChanged = @"policyChanged";
NSString *const RNIntuneEventUnenrollmentResult = @"unenrollmentResult";
NSString *const RNIntuneEventWipeRequested = @"wipeRequested";
NSString *const RNIntuneEventRestartRequired = @"restartRequired";
NSString *const RNIntuneEventTokenRequest = @"tokenRequest";
NSString *const RNIntuneEventBrokerStatusChanged = @"brokerStatusChanged";

static NSString *const RNIntuneErrorDomain = @"com.reactnativeintune";

/// URL schemes the brokers register. Checking these requires matching entries in the
/// host app's LSApplicationQueriesSchemes — without them iOS returns NO regardless of
/// what is installed, so a false negative here means a missing plist key, not a missing
/// app. This is the same trap that silently costs MSAL its broker (SPEC §5.1.2).
static NSString *const RNIntuneAuthenticatorScheme = @"msauthv2";
static NSString *const RNIntuneCompanyPortalScheme = @"companyportal";

@implementation RNIntuneConfig
@end

@implementation RNIntuneCore {
  RNIntuneConfig *_Nullable _config;
}

+ (instancetype)shared
{
  static RNIntuneCore *shared = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    shared = [[self alloc] init];
  });
  return shared;
}

#pragma mark - Availability

- (BOOL)sdkAvailable
{
  // Looked up by name rather than imported so this translation unit stays free of SDK
  // headers, and so the check answers the question that actually matters: is the
  // xcframework linked into *this* binary?
  return NSClassFromString(@"IntuneMAMEnrollmentManager") != nil;
}

#pragma mark - Configuration

- (BOOL)isConfigured
{
  return _config != nil;
}

- (nullable NSString *)configuredTenantId
{
  return _config.tenantId;
}

- (BOOL)applyConfig:(RNIntuneConfig *)config error:(NSError *_Nullable *_Nullable)error
{
  if (!self.sdkAvailable) {
    if (error) {
      *error = [RNIntuneCore
          errorWithCode:RNIntuneErrorSDKUnavailable
                message:@"The Intune MAM SDK is not linked into this binary. Check that "
                        @"vendor/ios was fetched and that pod install ran."];
    }
    return NO;
  }

  // Switching tenants requires an explicit reset. Reconfiguring in place would leave the
  // previous tenant enrolled, and the iOS runtime overrides persist across restarts, so
  // the mismatch would survive a relaunch (SPEC §13.1).
  if (_config != nil && ![_config.tenantId isEqualToString:config.tenantId]) {
    if (error) {
      *error = [RNIntuneCore
          errorWithCode:RNIntuneErrorResetRequired
                message:@"configure() was called with a different tenantId than the "
                        @"active one. Call reset() before switching tenants."];
    }
    return NO;
  }

  _config = config;

  // The SDK calls themselves — IntuneMAMSettings runtime overrides, the enrollment and
  // policy delegates, MSAL — land in the next slice. Holding the config is enough for
  // getState() to report the truth in the meantime.
  return YES;
}

#pragma mark - Reads

- (NSDictionary<NSString *, id> *)brokerStatus
{
  UIApplication *app = UIApplication.sharedApplication;

  BOOL authenticator = [app canOpenURL:[NSURL URLWithString:[RNIntuneAuthenticatorScheme
                                                                stringByAppendingString:@"://"]]];
  BOOL companyPortal = [app canOpenURL:[NSURL URLWithString:[RNIntuneCompanyPortalScheme
                                                                stringByAppendingString:@"://"]]];

  return @{
    // Either broker will do on iOS — Authenticator is the common one.
    @"brokerAvailable" : @(authenticator || companyPortal),
    @"companyPortalInstalled" : @(companyPortal),
    @"authenticatorInstalled" : @(authenticator),
    // Unlike Android, iOS can enroll without a broker present.
    @"required" : @NO,
  };
}

- (NSDictionary<NSString *, id> *)state
{
  return @{
    @"configured" : @(self.isConfigured),
    @"configuredTenantId" : self.configuredTenantId ?: NSNull.null,
    @"registeredAccountIds" : @[],
    @"enrolledAccountId" : NSNull.null,
    @"status" : NSNull.null,
    @"pendingReset" : NSNull.null,
  };
}

- (NSDictionary<NSString *, NSString *> *)diagnostics
{
  // Account IDs may appear in diagnostics but must never be logged or persisted
  // (CLAUDE.md rule 3). Nothing here is a token or a UPN.
  return @{
    @"platform" : @"ios",
    @"sdkLinked" : self.sdkAvailable ? @"true" : @"false",
    @"configured" : self.isConfigured ? @"true" : @"false",
    @"configuredTenantId" : self.configuredTenantId ?: @"",
    @"authMode" : _config.authMode ?: @"",
  };
}

#pragma mark - Errors

+ (NSError *)errorWithCode:(NSString *)code message:(NSString *)message
{
  return [NSError errorWithDomain:RNIntuneErrorDomain
                             code:0
                         userInfo:@{
                           NSLocalizedDescriptionKey : message,
                           @"code" : code,
                         }];
}

@end
