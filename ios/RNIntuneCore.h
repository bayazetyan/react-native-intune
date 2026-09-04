//
//  Pure Objective-C. Everything that talks to the Intune MAM SDK lives on this side of
//  the boundary; RNIntune.mm is ObjC++ only because Codegen conformance and
//  getTurboModule: are C++ (SPEC §5.1.1, CLAUDE.md rule 7).
//
//  Keep it that way. An enrollment failure should be debuggable across one language
//  boundary, not two, in a domain with no official React Native support.
//

#import <Foundation/Foundation.h>

#import "RNIntuneAuth.h"

NS_ASSUME_NONNULL_BEGIN

/// Stable rejection codes (SPEC §13.6). Never surface a raw platform error to JS.
extern NSString *const RNIntuneErrorNotConfigured;
extern NSString *const RNIntuneErrorResetRequired;
extern NSString *const RNIntuneErrorSDKUnavailable;
extern NSString *const RNIntuneErrorInvalidAccountId;
extern NSString *const RNIntuneErrorNotNeeded;
extern NSString *const RNIntuneErrorExternalAuthMode;
extern NSString *const RNIntuneErrorNative;
extern NSString *const RNIntuneErrorTokenProviderFailed;
extern NSString *const RNIntuneErrorTokenProviderMissing;
extern NSString *const RNIntuneErrorResetInProgress;
/// MSAL outcomes that are ordinary control flow, not faults (SPEC §13.6).
extern NSString *const RNIntuneErrorInteractionRequired;
extern NSString *const RNIntuneErrorUserCancelled;
extern NSString *const RNIntuneErrorNoAccount;
/// Raised by the configure-time assertions below. Not in SPEC §13.6 yet — see §12.7 S1.
extern NSString *const RNIntuneErrorPlistConflict;

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
/// Hex strings for the SDK's own screens; empty means "leave Microsoft's default".
@property (nonatomic, copy) NSString *brandingBackground;
@property (nonatomic, copy) NSString *brandingForeground;
@property (nonatomic, copy) NSString *brandingAccent;
@property (nonatomic, copy) NSString *brandingSecondaryBackground;
@property (nonatomic, copy) NSString *brandingSecondaryForeground;
@end

@interface RNIntuneCore : NSObject

+ (instancetype)shared;

/// Set once, before configure. Publishes SDK events to JS.
- (void)setEventSink:(void (^)(NSString *event, NSDictionary *body))sink;

/// YES when the MAM SDK is actually linked into the binary. Checked by class lookup so a
/// misbuilt binary degrades instead of crashing.
@property (nonatomic, readonly) BOOL sdkAvailable;

@property (nonatomic, readonly, getter=isConfigured) BOOL configured;
@property (nonatomic, readonly, nullable) NSString *configuredTenantId;

/// NO in `authMode: 'external'`, where the host app owns MSAL and the module performs no
/// sign-in at all (SPEC §3.2).
@property (nonatomic, readonly) BOOL builtinAuth;

/// MSAL. Configured only in `builtin` mode; `isConfigured` is NO otherwise.
@property (nonatomic, readonly) RNIntuneAuth *auth;

/// Applies the runtime overrides, installs the delegates, and runs the configure-time
/// assertions. Returns NO and fills `error` on `E_RESET_REQUIRED` (different tenant),
/// `E_SDK_UNAVAILABLE`, or `E_PLIST_CONFLICT`.
- (BOOL)applyConfig:(RNIntuneConfig *)config error:(NSError *_Nullable *_Nullable)error;

/// BrokerStatus (SPEC §13.1). Answerable before `configure`, on purpose: the app needs
/// it to decide whether to prompt for a broker install.
- (NSDictionary<NSString *, id> *)brokerStatus;

/// IntuneState (SPEC §4.2). Never rejects — reporting `configured: false` is the whole
/// point of the reconciliation primitive.
- (NSDictionary<NSString *, id> *)state;

/// Diagnostics (SPEC §13.3). No tokens, no UPNs — safe to attach to a support ticket.
- (NSDictionary<NSString *, NSString *> *)diagnostics;

#pragma mark - Enrollment

/**
 * Registers and enrolls the account, completing with an `EnrollmentResult`.
 *
 * `registerAndEnrollAccountId:` returns immediately and says nothing; the outcome arrives
 * later on `enrollmentRequestWithStatus:`. So the completion is held against the account
 * ID and fired from the delegate (SPEC §12.5) — never from the call returning.
 *
 * Completes for every outcome, including failures: a non-success status is data, not an
 * error. If the SDK says nothing at all within the timeout it completes with `pending`,
 * which is truthful — the SDK keeps retrying on its own schedule and the result will
 * still arrive as an event.
 */
- (void)enrollAccountId:(NSString *)accountId
             completion:(void (^)(NSDictionary<NSString *, id> *result))completion;

/// PolicySnapshot (SPEC §4.3). Nil when the SDK is not linked.
- (nullable NSDictionary<NSString *, id> *)policySnapshot;

#pragma mark - Reset (SPEC §7)

/**
 * Writes the journal, then unregisters and unenrolls.
 *
 * **Blocks** while the SDK acquires the Intune AAD token, so it must not run on the main
 * thread, and it must happen before the host app purges the account's Entra tokens
 * (SPEC §5.3). The process may not survive it; everything after is driven by the journal.
 */
- (void)resetWithWipe:(BOOL)wipe reason:(NSString *)reason;

/// Verifies the account is really gone and closes the journal. Returns NO and leaves the
/// journal open when it is not, so the next launch retries rather than declaring success.
- (BOOL)completeReset;

/// iOS-only interactive enrollment: the SDK runs the sign-in and shows its own UI.
- (void)enrollInteractiveWithUpn:(nullable NSString *)upn
                      completion:(void (^)(NSDictionary<NSString *, id> *result))completion;

#pragma mark - Token bridge (SPEC §13.4)

/// Answers a pending `tokenRequest`. The token goes to the SDK and never back to JS.
- (void)resolveTokenRequest:(NSString *)requestId token:(NSString *)token;
- (void)rejectTokenRequest:(NSString *)requestId reason:(NSString *)reason;

/// Builds an NSError carrying one of the stable codes above.
+ (NSError *)errorWithCode:(NSString *)code message:(NSString *)message;

@end

NS_ASSUME_NONNULL_END
