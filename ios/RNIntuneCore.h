//
//  Pure Objective-C. Everything that talks to the Intune MAM SDK lives on this side of
//  the boundary; RNIntune.mm is ObjC++ only because Codegen conformance and
//  getTurboModule: are C++ (SPEC §5.1.1, CLAUDE.md rule 7).
//
//  Keep it that way. An enrollment failure should be debuggable across one language
//  boundary, not two, in a domain with no official React Native support.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Stable rejection codes (SPEC §13.6). Never surface a raw platform error to JS.
extern NSString *const RNIntuneErrorNotConfigured;
extern NSString *const RNIntuneErrorResetRequired;
extern NSString *const RNIntuneErrorSDKUnavailable;
extern NSString *const RNIntuneErrorInvalidAccountId;
extern NSString *const RNIntuneErrorNotNeeded;
extern NSString *const RNIntuneErrorExternalAuthMode;
extern NSString *const RNIntuneErrorNative;

/// Event names. Must match the `IntuneEvents` keys in src/types.ts.
extern NSString *const RNIntuneEventEnrollmentResult;
extern NSString *const RNIntuneEventPolicyChanged;
extern NSString *const RNIntuneEventUnenrollmentResult;
extern NSString *const RNIntuneEventWipeRequested;
extern NSString *const RNIntuneEventRestartRequired;
extern NSString *const RNIntuneEventTokenRequest;
extern NSString *const RNIntuneEventBrokerStatusChanged;

/// Resolved configuration. `index.ts` applies every default, so nothing here is optional.
@interface RNIntuneConfig : NSObject
@property (nonatomic, copy) NSString *clientId;
@property (nonatomic, copy) NSString *tenantId;
@property (nonatomic, copy) NSString *authority;
@property (nonatomic, copy) NSString *redirectUri;
@property (nonatomic, copy) NSString *authMode;
@property (nonatomic, copy) NSString *maxFileProtectionLevel;
/// Empty string means "use the platform default" (`com.microsoft.adalcache`).
@property (nonatomic, copy) NSString *keychainGroupOverride;
@property (nonatomic) BOOL verboseLogging;
@property (nonatomic) BOOL restartHandledByApp;
@property (nonatomic) BOOL telemetryEnabled;
@end

@interface RNIntuneCore : NSObject

+ (instancetype)shared;

/// YES when the MAM SDK is actually linked into the binary. Checked by class lookup so
/// this file needs no SDK import, and so a misbuilt binary degrades instead of crashing.
@property (nonatomic, readonly) BOOL sdkAvailable;

@property (nonatomic, readonly, getter=isConfigured) BOOL configured;
@property (nonatomic, readonly, nullable) NSString *configuredTenantId;

/// Returns NO and fills `error` when the tenant differs from the active one
/// (`E_RESET_REQUIRED`) or the SDK is missing — switching tenants needs an explicit
/// reset, because silently reconfiguring would leave the old tenant enrolled.
- (BOOL)applyConfig:(RNIntuneConfig *)config error:(NSError *_Nullable *_Nullable)error;

/// BrokerStatus (SPEC §13.1). Answerable before `configure`, on purpose: the app needs
/// it to decide whether to prompt for a broker install.
- (NSDictionary<NSString *, id> *)brokerStatus;

/// IntuneState (SPEC §4.2). Never rejects — reporting `configured: false` is the whole
/// point of the reconciliation primitive.
- (NSDictionary<NSString *, id> *)state;

/// Diagnostics (SPEC §13.3). No tokens, no UPNs — safe to attach to a support ticket.
- (NSDictionary<NSString *, NSString *> *)diagnostics;

/// Builds an NSError carrying one of the stable codes above.
+ (NSError *)errorWithCode:(NSString *)code message:(NSString *)message;

@end

NS_ASSUME_NONNULL_END
