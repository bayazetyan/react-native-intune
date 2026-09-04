//
//  Copyright (c) 2026 react-native-intune contributors. MIT.
//

#import "RNIntuneCore.h"
#import "RNIntuneDelegates.h"

#import <UIKit/UIKit.h>

#import <IntuneMAMSwift/IntuneMAMSwift.h>

NSString *const RNIntuneErrorNotConfigured = @"E_NOT_CONFIGURED";
NSString *const RNIntuneErrorResetRequired = @"E_RESET_REQUIRED";
NSString *const RNIntuneErrorSDKUnavailable = @"E_SDK_UNAVAILABLE";
NSString *const RNIntuneErrorInvalidAccountId = @"E_INVALID_ACCOUNT_ID";
NSString *const RNIntuneErrorNotNeeded = @"E_NOT_NEEDED";
NSString *const RNIntuneErrorExternalAuthMode = @"E_EXTERNAL_AUTH_MODE";
NSString *const RNIntuneErrorNative = @"E_NATIVE";
NSString *const RNIntuneErrorTokenProviderFailed = @"E_TOKEN_PROVIDER_FAILED";
NSString *const RNIntuneErrorTokenProviderMissing = @"E_TOKEN_PROVIDER_MISSING";
NSString *const RNIntuneErrorPlistConflict = @"E_PLIST_CONFLICT";

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

/// The `IntuneMAMSettings` dictionary in the host app's Info.plist, and the keys inside
/// it that the SDK reads at launch. Verified against the strings in the 21.8.0 binary.
static NSString *const RNIntuneSettingsPlistKey = @"IntuneMAMSettings";
static NSString *const RNIntunePlistClientId = @"ADALClientId";
static NSString *const RNIntunePlistAuthority = @"ADALAuthority";
static NSString *const RNIntunePlistRedirectUri = @"ADALRedirectUri";
static NSString *const RNIntunePlistKeychainGroup = @"ADALCacheKeychainGroupOverride";
static NSString *const RNIntunePlistMaxFileProtection = @"MaxFileProtectionLevel";

#pragma mark - Verbose logger

/// Bridges the SDK's logger protocol to NSLog. Only installed when `verboseLogging` is
/// on, which is why there is no level filter: the caller asked for everything.
@interface RNIntuneVerboseLogger : NSObject <IntuneMAMLogger>
@end

@implementation RNIntuneVerboseLogger
- (void)log:(NSString *)message level:(IntuneMAMLogLevel)level
{
  static NSString *const names[] = {@"verbose", @"info", @"warning", @"error"};
  NSString *name = (level <= IntuneMAMLogLevelError) ? names[level] : @"?";
  NSLog(@"[react-native-intune][%@] %@", name, message);
}
@end

@implementation RNIntuneConfig
@end

/**
 * How long to wait for the SDK to say something before completing an enroll as `pending`.
 * Generous on purpose: enrollment involves a token acquisition and a service round trip,
 * and returning early would report a failure the SDK has not actually reached.
 */
static const NSTimeInterval RNIntuneEnrollTimeout = 90.0;

/// How long JS gets to answer a token request before the SDK is told we cannot supply one.
static const NSTimeInterval RNIntuneTokenTimeout = 45.0;

@implementation RNIntuneCore {
  RNIntuneConfig *_Nullable _config;
  RNIntuneDelegates *_Nullable _delegates;
  RNIntuneVerboseLogger *_Nullable _logger;
  void (^_Nullable _sink)(NSString *, NSDictionary *);

  /// accountId -> completion. The SDK reports enrollment through the delegate, so the
  /// caller's completion has to wait here until it does.
  NSMutableDictionary<NSString *, void (^)(NSDictionary *)> *_pendingEnrollments;
  /// requestId -> the SDK's own completion, waiting on JS.
  NSMutableDictionary<NSString *, RNIntuneTokenCompletion> *_pendingTokenRequests;
  /// Guards both dictionaries: delegate callbacks arrive on SDK-chosen threads.
  NSLock *_lock;
  NSUInteger _requestCounter;
}

- (instancetype)init
{
  if ((self = [super init])) {
    _pendingEnrollments = [NSMutableDictionary new];
    _pendingTokenRequests = [NSMutableDictionary new];
    _lock = [NSLock new];
    _requestCounter = 0;
  }
  return self;
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

- (void)setEventSink:(void (^)(NSString *, NSDictionary *))sink
{
  _sink = [sink copy];
}

- (void)emit:(NSString *)event body:(NSDictionary *)body
{
  if (_sink) {
    _sink(event, body);
  }
}

#pragma mark - Availability

- (BOOL)sdkAvailable
{
  // Looked up by name rather than by import so the answer is about *this* binary: is the
  // xcframework actually linked, not merely available at compile time.
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

- (NSDictionary *)settingsFromPlist
{
  id settings = NSBundle.mainBundle.infoDictionary[RNIntuneSettingsPlistKey];
  return [settings isKindOfClass:NSDictionary.class] ? settings : @{};
}

/**
 * The three silent failures, made loud (SPEC §12.7 S1).
 *
 * Every one of these is a configuration mistake that otherwise shows up as
 * `MAMEnrollmentStatusAuthRequired` days later, in a tenant you cannot reach, with
 * nothing in the logs pointing at the cause.
 */
- (BOOL)assertPlistCompatibleWith:(RNIntuneConfig *)config
                            error:(NSError *_Nullable *_Nullable)error
{
  NSDictionary *plist = [self settingsFromPlist];

  // 1. A hardcoded identity key next to a runtime override. GitHub issue #405: the two
  //    disagree and enrollment fails with no indication which one won. CLAUDE.md rule 4
  //    forbids these keys outright for exactly this reason.
  NSArray<NSString *> *forbidden =
      @[ RNIntunePlistClientId, RNIntunePlistAuthority, RNIntunePlistRedirectUri ];
  NSMutableArray<NSString *> *present = [NSMutableArray new];
  for (NSString *key in forbidden) {
    if (plist[key] != nil) {
      [present addObject:key];
    }
  }
  if (present.count > 0) {
    if (error) {
      *error = [RNIntuneCore
          errorWithCode:RNIntuneErrorPlistConflict
                message:[NSString
                            stringWithFormat:
                                @"Info.plist -> IntuneMAMSettings contains %@, which "
                                @"conflicts with the values passed to configure(). This "
                                @"module configures identity at runtime only. Remove "
                                @"these keys — a conflicting plist key alongside a "
                                @"runtime override is a known cause of enrollment "
                                @"failing with AuthRequired.",
                                [present componentsJoinedByString:@", "]]];
    }
    return NO;
  }

  // 2. keychainGroupOverride has no runtime setter — ADALCacheKeychainGroupOverride is
  //    read from the plist at launch. So the module cannot "set it to match" as SPEC
  //    §5.1.2 describes; the best it can do is refuse to let the two disagree.
  NSString *plistGroup = plist[RNIntunePlistKeychainGroup];
  NSString *wantedGroup = config.keychainGroupOverride.length > 0
                              ? config.keychainGroupOverride
                              : nil;
  if (wantedGroup != nil && ![plistGroup isEqualToString:wantedGroup]) {
    if (error) {
      *error = [RNIntuneCore
          errorWithCode:RNIntuneErrorPlistConflict
                message:[NSString
                            stringWithFormat:
                                @"configure() asked for keychain group \"%@\" but "
                                @"Info.plist -> IntuneMAMSettings -> %@ is \"%@\". This "
                                @"key has no runtime equivalent, so it must be set in "
                                @"the plist. MSAL's cache and the SDK's must never "
                                @"disagree.",
                                wantedGroup, RNIntunePlistKeychainGroup,
                                plistGroup ?: @"(absent)"]];
    }
    return NO;
  }

  // 3. MaxFileProtectionLevel is plist-only too. Silently ignoring a requested value is
  //    how an app ends up with a local database that becomes unreadable ten seconds
  //    after the device locks (SPEC §5.2, open question O-D).
  NSString *plistProtection = plist[RNIntunePlistMaxFileProtection];
  if (![config.maxFileProtectionLevel isEqualToString:@"complete"] &&
      plistProtection == nil) {
    if (error) {
      *error = [RNIntuneCore
          errorWithCode:RNIntuneErrorPlistConflict
                message:[NSString
                            stringWithFormat:
                                @"configure() asked for maxFileProtectionLevel \"%@\", "
                                @"but %@ has no runtime equivalent and is absent from "
                                @"Info.plist -> IntuneMAMSettings. Set it there (the "
                                @"SDK reads it at launch) or drop the option.",
                                config.maxFileProtectionLevel,
                                RNIntunePlistMaxFileProtection]];
    }
    return NO;
  }

  return YES;
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
  // previous tenant enrolled, and the runtime overrides below persist across restarts,
  // so the mismatch would survive a relaunch (SPEC §13.1).
  if (_config != nil && ![_config.tenantId isEqualToString:config.tenantId]) {
    if (error) {
      *error = [RNIntuneCore
          errorWithCode:RNIntuneErrorResetRequired
                message:@"configure() was called with a different tenantId than the "
                        @"active one. Call reset() before switching tenants."];
    }
    return NO;
  }

  if (![self assertPlistCompatibleWith:config error:error]) {
    return NO;
  }

  // Runtime overrides. These are class properties, they take effect for subsequent SDK
  // operations, and they persist across restarts until cleared by reset() — a feature
  // for per-tenant configuration and a hazard for tenant switching (SPEC §5.2).
  IntuneMAMSettings.aadClientIdOverride = config.clientId;
  IntuneMAMSettings.aadAuthorityUriOverride = config.authority;
  IntuneMAMSettings.aadRedirectUriOverride = config.redirectUri;
  IntuneMAMSettings.telemetryEnabled = config.telemetryEnabled;

  // Belt and braces for CLAUDE.md rule 3: even with verbose logging on, these must not
  // reach the SDK's log output.
  IntuneMAMSettings.valuesToScrubFromLogging =
      @[ config.clientId, config.tenantId, config.redirectUri ];

  if (config.verboseLogging) {
    _logger = [RNIntuneVerboseLogger new];
    IntuneMAMPolicyManager.instance.logger = _logger;
  } else {
    _logger = nil;
    IntuneMAMPolicyManager.instance.logger = nil;
  }

  // Delegates are installed once and kept for the process lifetime: the SDK calls them
  // unprompted, including before any JS call and during a background policy refresh.
  if (_delegates == nil) {
    __weak __typeof(self) weakSelf = self;
    _delegates = [[RNIntuneDelegates alloc]
        initWithEventSink:^(NSString *event, NSDictionary *body) {
          // Settle first, publish second. The same delegate callback serves a caller
          // waiting on enroll() and every subscriber — including for the SDK's own
          // background retries, which have no caller at all (SPEC §13.5).
          [weakSelf settlePendingEnrollmentForEvent:event body:body];
          [weakSelf emit:event body:body];
        }
      tokenRequestHandler:^(NSString *accountId, NSString *resource,
                            RNIntuneTokenCompletion completion) {
        [weakSelf handleTokenRequestForAccountId:accountId
                                        resource:resource
                                      completion:completion];
      }];
    IntuneMAMEnrollmentManager.instance.delegate = _delegates;
    IntuneMAMPolicyManager.instance.delegate = _delegates;

    [NSNotificationCenter.defaultCenter
        addObserver:self
           selector:@selector(policyDidChange:)
               name:IntuneMAMPolicyDidChangeNotification
             object:nil];
  }
  _delegates.restartHandledByApp = config.restartHandledByApp;

  _config = config;
  return YES;
}

- (void)policyDidChange:(NSNotification *)notification
{
  // getPolicy() is not implemented yet — two of the five fields SPEC §4.3 asks for are
  // not queryable on either platform (see the note in §4.3). The event still fires so a
  // subscriber knows to re-read once it is.
  [self emit:RNIntuneEventPolicyChanged
        body:@{
          @"isManaged" : @(IntuneMAMPolicyManager.instance.isManagementEnabled),
        }];
}

#pragma mark - Reads

- (NSDictionary<NSString *, id> *)brokerStatus
{
  UIApplication *app = UIApplication.sharedApplication;

  NSURL *authenticator = [NSURL
      URLWithString:[RNIntuneAuthenticatorScheme stringByAppendingString:@"://"]];
  NSURL *companyPortal = [NSURL
      URLWithString:[RNIntuneCompanyPortalScheme stringByAppendingString:@"://"]];

  BOOL hasAuthenticator = [app canOpenURL:authenticator];
  BOOL hasCompanyPortal = [app canOpenURL:companyPortal];

  return @{
    // Either broker will do on iOS — Authenticator is the common one.
    @"brokerAvailable" : @(hasAuthenticator || hasCompanyPortal),
    @"companyPortalInstalled" : @(hasCompanyPortal),
    @"authenticatorInstalled" : @(hasAuthenticator),
    // Unlike Android, iOS can enroll without a broker present.
    @"required" : @NO,
  };
}

- (NSDictionary<NSString *, id> *)state
{
  if (!self.sdkAvailable) {
    return @{
      @"configured" : @NO,
      @"configuredTenantId" : NSNull.null,
      @"registeredAccountIds" : @[],
      @"enrolledAccountId" : NSNull.null,
      @"status" : NSNull.null,
      @"pendingReset" : NSNull.null,
    };
  }

  IntuneMAMEnrollmentManager *manager = IntuneMAMEnrollmentManager.instance;
  NSString *enrolled = manager.enrolledAccountId;

  return @{
    @"configured" : @(self.isConfigured),
    @"configuredTenantId" : self.configuredTenantId ?: NSNull.null,
    @"registeredAccountIds" : manager.registeredAccountIds ?: @[],
    @"enrolledAccountId" : enrolled ?: NSNull.null,
    // iOS has no "read the current enrollment status" API — the SDK reports status
    // through the delegate and nowhere else. So the truthful answer here is derived:
    // enrolled or not. The last delegate status reaches JS as an event instead
    // (SPEC §4.1).
    @"status" : enrolled != nil ? @"succeeded" : NSNull.null,
    // Written by the reset journal, which is SPEC §7 and not yet implemented.
    @"pendingReset" : NSNull.null,
  };
}

- (NSDictionary<NSString *, NSString *> *)diagnostics
{
  NSMutableDictionary<NSString *, NSString *> *out = [NSMutableDictionary new];
  out[@"platform"] = @"ios";
  out[@"sdkLinked"] = self.sdkAvailable ? @"true" : @"false";
  out[@"configured"] = self.isConfigured ? @"true" : @"false";
  // The tenant ID is tenant-identifying but not user-identifying, so it stays. No token,
  // no UPN, and no account ID is added here (CLAUDE.md rule 3).
  out[@"configuredTenantId"] = self.configuredTenantId ?: @"";
  out[@"authMode"] = _config.authMode ?: @"";
  out[@"verboseLogging"] = _config.verboseLogging ? @"true" : @"false";

  if (self.sdkAvailable) {
    out[@"sdkVersion"] = IntuneMAMVersionInfo.sdkVersion ?: @"";
    out[@"managementEnabled"] =
        IntuneMAMPolicyManager.instance.isManagementEnabled ? @"true" : @"false";
    out[@"enrolled"] =
        IntuneMAMEnrollmentManager.instance.enrolledAccountId != nil ? @"true" : @"false";
  }

  NSDictionary *plist = [self settingsFromPlist];
  out[@"plistHasIdentityKeys"] =
      (plist[RNIntunePlistClientId] != nil || plist[RNIntunePlistAuthority] != nil ||
       plist[RNIntunePlistRedirectUri] != nil)
          ? @"true"
          : @"false";
  out[@"plistMaxFileProtectionLevel"] = plist[RNIntunePlistMaxFileProtection] ?: @"";

  return out;
}

#pragma mark - Enrollment

- (void)enrollAccountId:(NSString *)accountId
             completion:(void (^)(NSDictionary<NSString *, id> *))completion
{
  [_lock lock];
  // A second enroll() for the same account while one is in flight is not an error — the
  // SDK is already working on it. Both callers get the one result the delegate reports.
  void (^existing)(NSDictionary *) = _pendingEnrollments[accountId];
  _pendingEnrollments[accountId] = ^(NSDictionary *result) {
    if (existing) {
      existing(result);
    }
    completion(result);
  };
  [_lock unlock];

  __weak __typeof(self) weakSelf = self;
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(RNIntuneEnrollTimeout * NSEC_PER_SEC)),
      dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        // Truthful rather than convenient: the SDK has not failed, it has not answered.
        // It keeps retrying on its own schedule and the result still arrives as an event.
        [weakSelf completePendingEnrollment:accountId
                                 withResult:@{
                                   @"status" : @"pending",
                                   @"accountId" : accountId,
                                   @"nativeCode" : @"RNIntuneTimeout",
                                   @"nativeMessage" :
                                       @"The SDK did not report a result within the "
                                       @"timeout. Enrollment continues in the background; "
                                       @"watch onEnrollmentResult.",
                                   @"restartRequired" : @NO,
                                 }];
      });

  // Returns immediately and reports nothing. Everything meaningful happens above.
  [IntuneMAMEnrollmentManager.instance registerAndEnrollAccountId:accountId];
}

- (void)settlePendingEnrollmentForEvent:(NSString *)event body:(NSDictionary *)body
{
  if (![event isEqualToString:RNIntuneEventEnrollmentResult]) {
    return;
  }
  id accountId = body[@"accountId"];
  if (![accountId isKindOfClass:NSString.class]) {
    return;
  }
  [self completePendingEnrollment:accountId withResult:body];
}

- (void)completePendingEnrollment:(NSString *)accountId
                       withResult:(NSDictionary *)result
{
  [_lock lock];
  void (^completion)(NSDictionary *) = _pendingEnrollments[accountId];
  [_pendingEnrollments removeObjectForKey:accountId];
  [_lock unlock];

  if (completion) {
    completion(result);
  }
}

#pragma mark - Token bridge

- (void)handleTokenRequestForAccountId:(NSString *)accountId
                              resource:(NSString *)resource
                            completion:(RNIntuneTokenCompletion)completion
{
  [_lock lock];
  NSString *requestId =
      [NSString stringWithFormat:@"tok-%lu", (unsigned long)(++_requestCounter)];
  _pendingTokenRequests[requestId] = completion;
  [_lock unlock];

  // `resourceId` is what the provider turns into a scope; the token never comes back
  // through JS to the SDK by any other route (SPEC §13.4).
  [self emit:RNIntuneEventTokenRequest
        body:@{
          @"requestId" : requestId,
          @"resourceId" : resource ?: @"",
          @"accountId" : accountId ?: @"",
          @"tenantId" : _config.tenantId ?: @"",
          @"authority" : _config.authority ?: @"",
        }];

  __weak __typeof(self) weakSelf = self;
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(RNIntuneTokenTimeout * NSEC_PER_SEC)),
      dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        [weakSelf rejectTokenRequest:requestId
                              reason:@"The token provider did not answer within the "
                                     @"timeout."];
      });
}

- (nullable RNIntuneTokenCompletion)takeTokenRequest:(NSString *)requestId
{
  [_lock lock];
  RNIntuneTokenCompletion completion = _pendingTokenRequests[requestId];
  [_pendingTokenRequests removeObjectForKey:requestId];
  [_lock unlock];
  return completion;
}

- (void)resolveTokenRequest:(NSString *)requestId token:(NSString *)token
{
  // Taken, not read: a late answer after the timeout already fired must not reach the
  // SDK twice.
  RNIntuneTokenCompletion completion = [self takeTokenRequest:requestId];
  if (completion) {
    completion(token, nil);
  }
}

- (void)rejectTokenRequest:(NSString *)requestId reason:(NSString *)reason
{
  RNIntuneTokenCompletion completion = [self takeTokenRequest:requestId];
  if (completion) {
    completion(nil, reason);
  }
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
