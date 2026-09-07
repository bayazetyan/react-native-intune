//
//  Copyright (c) 2026 react-native-intune contributors. MIT.
//

#import "RNIntuneCore.h"
#import "RNIntuneDelegates.h"
#import "RNIntunePendingRequests.h"
#import "RNIntunePlistGuard.h"
#import "RNIntunePolicy.h"
#import "RNIntuneReset.h"
#import "RNIntuneResetJournal.h"

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
NSString *const RNIntuneErrorResetInProgress = @"E_RESET_IN_PROGRESS";
NSString *const RNIntuneErrorInteractionRequired = @"E_INTERACTION_REQUIRED";
NSString *const RNIntuneErrorUserCancelled = @"E_USER_CANCELLED";
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

@implementation RNIntuneCore {
  RNIntuneConfig *_Nullable _config;
  RNIntuneDelegates *_Nullable _delegates;
  RNIntuneVerboseLogger *_Nullable _logger;
  void (^_Nullable _sink)(NSString *, NSDictionary *);
  RNIntunePendingRequests *_pending;
  RNIntuneAuth *_auth;
}

- (instancetype)init
{
  if ((self = [super init])) {
    __weak __typeof(self) weakSelf = self;
    _pending = [[RNIntunePendingRequests alloc]
        initWithEventSink:^(NSString *event, NSDictionary *body) {
          [weakSelf emit:event body:body];
        }];
    // Non-nil from the start, holding no tenant state until configured, so no caller
    // needs a nil check — `isConfigured` on it is the only question worth asking.
    _auth = [RNIntuneAuth new];
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

  if (![RNIntunePlistGuard check:config error:error]) {
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

  // Only assign what was actually asked for: writing nil would clear a colour the app
  // may have set in its plist, and '' is not a colour.
  #define RNIntuneApplyColour(prop, value) \
    if ((value).length > 0) IntuneMAMSettings.prop = (value);
  RNIntuneApplyColour(backgroundColor, config.brandingBackground)
  RNIntuneApplyColour(foregroundColor, config.brandingForeground)
  RNIntuneApplyColour(accentColor, config.brandingAccent)
  RNIntuneApplyColour(secondaryBackgroundColor, config.brandingSecondaryBackground)
  RNIntuneApplyColour(secondaryForegroundColor, config.brandingSecondaryForeground)
  #undef RNIntuneApplyColour

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
          __strong __typeof(weakSelf) self = weakSelf;
          if (self == nil) {
            return;
          }
          // A service-initiated wipe opens the journal before anyone hears about it.
          //
          // This is the one place worth intercepting: every delegate event passes through
          // here, and the SDK reports a wipe from two different callbacks. Doing it here
          // also means the tenant id is in scope, which the delegates do not have.
          //
          // Why it matters: the SDK terminates the process after the wipe, so a
          // subscriber's cleanup may not finish — and without a journal entry there is no
          // `pendingReset`, so the next launch has no idea anything happened and the app's
          // own data and backend session are never dealt with. §7 already lists remote
          // wipe as one of the callers of the single reset path; this makes that true.
          if ([event isEqualToString:RNIntuneEventWipeRequested]) {
            id accountId = body[@"accountId"];
            [RNIntuneResetJournal.shared
                openForServiceWipeWithAccountId:[accountId isKindOfClass:NSString.class]
                                                    ? accountId
                                                    : nil
                                       tenantId:self.configuredTenantId];
          }

          // Settle first, publish second. The same delegate callback serves a caller
          // waiting on enroll() and every subscriber — including for the SDK's own
          // background retries, which have no caller at all (SPEC §13.5).
          [self->_pending settleForEvent:event body:body];
          [self emit:event body:body];
        }
      tokenRequestHandler:^(NSString *accountId, NSString *resource,
                            RNIntuneTokenCompletion completion) {
        __strong __typeof(weakSelf) self = weakSelf;
        if (self == nil) {
          // Nobody can answer, so tell the SDK now rather than holding its callback.
          completion(nil, @"The module was deallocated.");
          return;
        }
        [self->_pending handleTokenRequestForAccountId:accountId
                                              resource:resource
                                              tenantId:self.configuredTenantId
                                             authority:self->_config.authority
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
  // Only 'external' mode has a token provider behind it. In 'builtin' the module owns
  // MSAL, so the SDK should reach for it directly rather than asking us and being told no.
  _delegates.suppliesTokens = [config.authMode isEqualToString:@"external"];

  // MSAL, in `builtin` mode only. In `external` the host app owns it and signing in here
  // would put a second MSAL instance and a second cache in one binary (SPEC §3.1).
  //
  // The keychain group comes from the plist, never from `config`: the SDK's half of that
  // setting has no runtime setter, so the plist is the single source and the guard above
  // has already refused a `configure` that disagrees with it (§5.1.4). Pointing MSAL at
  // anything else here is what rule 8 forbids.
  if ([config.authMode isEqualToString:@"builtin"]) {
    NSString *keychainGroup = RNIntunePlistGuard.keychainGroupOverride;
    if (![_auth configureWithClientId:config.clientId
                            authority:config.authority
                          redirectUri:config.redirectUri
                        keychainGroup:keychainGroup.length > 0 ? keychainGroup : nil
                                error:error]) {
      return NO;
    }
  }

  _config = config;
  return YES;
}

- (void)policyDidChange:(NSNotification *)notification
{
  // Carries `isManaged` only, on purpose. A policy has more fields than belong in an
  // event payload, and the SDK gives no diff — so this says "something changed, re-read"
  // and the subscriber calls getPolicy() (SPEC §4.3).
  [self emit:RNIntuneEventPolicyChanged
        body:@{
          @"isManaged" : @(IntuneMAMPolicyManager.instance.isManagementEnabled),
        }];
}

#pragma mark - Reads

- (NSDictionary<NSString *, id> *)brokerStatus
{
  UIApplication *app = UIApplication.sharedApplication;

  // The host must be `broker`, not an empty one.
  //
  // `canOpenURL:` against `msauthv2://` answers NO even with Authenticator installed and
  // `msauthv2` declared in LSApplicationQueriesSchemes — found on device, where
  // Authenticator 6.8.54 was present and this method still reported no broker at all.
  // MSAL itself queries `<scheme>://broker`
  // (IdentityCore/src/parameters/MSIDBrokerInvocationOptions.m,
  // `isRequiredBrokerPresent`), and our answer has to agree with the library that
  // actually performs the brokered sign-in — otherwise the app is told to install
  // something it already has, or worse, told it is fine when it is not.
  BOOL (^canOpen)(NSString *) = ^BOOL(NSString *url) {
    NSURL *parsed = [NSURL URLWithString:url];
    return parsed != nil && [app canOpenURL:parsed];
  };

  NSString *brokerScheme =
      [RNIntuneAuthenticatorScheme stringByAppendingString:@"://broker"];
  BOOL hasAuthenticator = canOpen(brokerScheme);

  // Company Portal is a broker too, and it is the one Android needs, so probe its own
  // scheme as well. Both forms, because `://broker` is MSAL's convention and
  // `companyportal://` is the scheme Intune's own documentation uses — whichever the
  // installed version answers, the answer is "present".
  BOOL hasCompanyPortal =
      canOpen([RNIntuneCompanyPortalScheme stringByAppendingString:@"://broker"]) ||
      canOpen([RNIntuneCompanyPortalScheme stringByAppendingString:@"://"]);

  // Through a BOOL variable, not boxed inline. `a || b` has type `int` in C, so
  // `@(hasAuthenticator || hasCompanyPortal)` boxes an NSNumber holding the integer 1
  // rather than a boolean YES — and that crosses the bridge as the JS number `1`, not
  // `true`. Found on device: `brokerAvailable` read false while `authenticatorInstalled`
  // read true, which is arithmetically impossible and was the only field in this
  // dictionary built from an expression instead of a variable.
  BOOL brokerAvailable = hasAuthenticator || hasCompanyPortal;

  return @{
    // Either broker will do on iOS — Authenticator is the common one.
    @"brokerAvailable" : @(brokerAvailable),
    @"companyPortalInstalled" : @(hasCompanyPortal),
    @"authenticatorInstalled" : @(hasAuthenticator),
    // YES, and this used to say NO with the comment "unlike Android, iOS can enroll
    // without a broker present". That was wrong, and §3.1 was right.
    //
    // Verified by removing Authenticator from an iPad and signing in: MSAL fell back to
    // Safari and the *Entra* sign-in completed, but Microsoft's own page then refused to
    // go further without the Authenticator app installed. The browser is a middleman for
    // the sign-in, not a substitute for the broker, and enrollment needs a broker-issued
    // token.
    //
    // Strictly the requirement comes from the tenant's policy and Conditional Access
    // configuration, so a module cannot know in advance whether a given tenant enforces
    // it. The costs are not symmetric: prompting for a broker that turns out unnecessary
    // is harmless, while not prompting for one that is needed leaves the user stuck on a
    // Microsoft page mid-sign-in with no explanation from the app. So this errs toward
    // prompting.
    @"required" : @YES,
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
      @"pendingResetReason" : NSNull.null,
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
    @"pendingReset" : RNIntuneResetJournal.shared.stage ?: NSNull.null,
    @"pendingResetReason" : RNIntuneResetJournal.shared.reason ?: NSNull.null,
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

    // Three counts, because the SDK keeps three separate lists and they disagree.
    //
    // Found on device: after a reset that `completeReset` verified as clean, the SDK's
    // own "Remove Account" sheet still listed the previous account — because that sheet
    // is driven by `managedAccountIds`, which the reset verification does not look at.
    // Counts rather than the ids themselves: the question a support ticket asks is
    // "is anything left", not "which".
    out[@"registeredAccountCount"] = [NSString
        stringWithFormat:@"%lu",
                         (unsigned long)IntuneMAMEnrollmentManager.instance
                             .registeredAccountIds.count];
    out[@"enrolledAccountCount"] = [NSString
        stringWithFormat:@"%lu",
                         (unsigned long)IntuneMAMEnrollmentManager.instance
                             .enrolledAccountIds.count];
    out[@"managedAccountCount"] = [NSString
        stringWithFormat:@"%lu",
                         (unsigned long)IntuneMAMPolicyManager.instance.managedAccountIds
                             .count];
  }

  out[@"plistHasIdentityKeys"] = RNIntunePlistGuard.hasIdentityKeys ? @"true" : @"false";
  out[@"plistMaxFileProtectionLevel"] = RNIntunePlistGuard.maxFileProtectionLevel;

  return out;
}

#pragma mark - Forwarding

- (void)enrollAccountId:(NSString *)accountId
             completion:(void (^)(NSDictionary<NSString *, id> *))completion
{
  // Already enrolled with *this* account? Answer now.
  //
  // `registerAndEnrollAccountId:` for an account the SDK already holds is a no-op that
  // reports nothing at all — no delegate callback, no notification. The correlation below
  // would then wait for a result that is never coming and settle as `pending` at the
  // 90-second timeout, which is slow and untrue. Observed on an iPad.
  //
  // The same defect was found and fixed on Android, where the SDK is at least explicit
  // about it in logcat ("skipping already registered account"). iOS is silent.
  //
  // Only for the same account, deliberately. A *different* account already being enrolled
  // is the `wrongUser` case, and there the SDK does react — it shows its own account
  // removal UI — so short-circuiting it would hide behaviour the caller needs to see.
  NSString *enrolled = IntuneMAMEnrollmentManager.instance.enrolledAccountId;
  if (enrolled.length > 0 && [enrolled isEqualToString:accountId]) {
    completion(@{
      // Through the mapping table rather than a literal, so there is one definition of
      // what a success is called (SPEC §4.1).
      @"status" : [RNIntuneDelegates
          unifiedStatusForCode:IntuneMAMEnrollmentStatusPoliciesHaveNotChanged],
      @"accountId" : accountId,
      // Module-supplied, like RNIntuneTimeout: the SDK produced no status object here
      // because it was never asked to do any work.
      @"nativeCode" : @"RNIntuneAlreadyEnrolled",
      @"nativeMessage" : @"The account was already enrolled, so the SDK was not asked "
                         @"to enroll it again.",
      @"restartRequired" : @NO,
    });
    return;
  }

  [_pending awaitEnrollment:accountId completion:completion];
}

- (void)enrollInteractiveWithUpn:(NSString *)upn
                      completion:(void (^)(NSDictionary<NSString *, id> *))completion
{
  [_pending awaitInteractiveEnrollmentWithUpn:upn completion:completion];
}

- (void)resolveTokenRequest:(NSString *)requestId token:(NSString *)token
{
  [_pending resolveTokenRequest:requestId token:token];
}

- (void)rejectTokenRequest:(NSString *)requestId reason:(NSString *)reason
{
  [_pending rejectTokenRequest:requestId reason:reason];
}

- (nullable NSDictionary<NSString *, id> *)policySnapshot
{
  return [RNIntunePolicy snapshot];
}

- (BOOL)builtinAuth
{
  // Absent a config there is nothing to be external about, and `builtin` is the default.
  return _config == nil || [_config.authMode isEqualToString:@"builtin"];
}

- (RNIntuneAuth *)auth
{
  return _auth;
}

- (void)resetWithWipe:(BOOL)wipe reason:(NSString *)reason
{
  [RNIntuneReset runWithWipe:wipe
                      reason:reason
                    tenantId:self.configuredTenantId
                        auth:self.builtinAuth ? _auth : nil];
  // Cleared here rather than inside RNIntuneReset: the config is this object's state,
  // and the reset sequence should not be reaching into it.
  _config = nil;
}

- (BOOL)completeReset
{
  return [RNIntuneReset complete];
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
