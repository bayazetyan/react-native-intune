//
//  IntuneMAMEnrollmentDelegate and IntuneMAMPolicyDelegate conformance. Pure ObjC, like
//  everything else that faces the SDK (SPEC §5.1.1).
//
//  The SDK calls these on threads of its own choosing, and it calls them without the app
//  having asked for anything — a wipe or a background policy refresh arrives unprompted.
//  So this object owns no promise; it publishes events, and whoever is waiting correlates
//  (SPEC §12.5).
//

#import <Foundation/Foundation.h>

#import <IntuneMAMSwift/IntuneMAMSwift.h>

NS_ASSUME_NONNULL_BEGIN

/// Emits one event to JS. Implementations must marshal to the JS thread themselves.
typedef void (^RNIntuneEventSink)(NSString *event, NSDictionary *body);

/// Answers a token request with an access token, or with a reason it could not be got.
typedef void (^RNIntuneTokenCompletion)(NSString *_Nullable token,
                                        NSString *_Nullable failureReason);

/**
 * Asks whoever owns MSAL for a MAM service token.
 *
 * The SDK requests this while enrolling, and again on its own retry schedule with no JS
 * call in flight, which is why it is a registered hook rather than a parameter on
 * `enroll` (SPEC §13.4).
 */
typedef void (^RNIntuneTokenRequestHandler)(NSString *accountId,
                                            NSString *resource,
                                            RNIntuneTokenCompletion completion);

@interface RNIntuneDelegates : NSObject <IntuneMAMEnrollmentDelegate, IntuneMAMPolicyDelegate>

- (instancetype)initWithEventSink:(RNIntuneEventSink)sink
              tokenRequestHandler:(RNIntuneTokenRequestHandler)tokenHandler
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

/**
 * Whether this object should answer `getAccessTokenForAccountId:resource:completion:`.
 *
 * Only in `authMode: 'external'`. `getAccessTokenForAccountId:` is an @optional protocol
 * method, and the SDK checks whether the delegate implements it: if it does not, the SDK
 * acquires the MAM token itself through the app's MSAL. Claiming the method and then
 * answering "no token" is worse than staying silent — it stops the SDK using a path that
 * would have worked, and enrollment dies at the location service with no token attached.
 */
@property (nonatomic) BOOL suppliesTokens;

/// Mirrors `restartHandledByApp` from `configure`. Decides the return value of
/// `restartApplication`, which is how the SDK asks who performs the restart.
@property (nonatomic) BOOL restartHandledByApp;

/// Maps a raw SDK status onto the unified vocabulary in SPEC §4.1 and shapes it as an
/// `EnrollmentResult`. Exposed because `getState` needs the same mapping as the delegate.
+ (NSDictionary<NSString *, id> *)resultFromStatus:(IntuneMAMEnrollmentStatus *)status;

/// The unified status string alone, for callers that already have a status code.
+ (NSString *)unifiedStatusForCode:(IntuneMAMEnrollmentStatusCode)code;

/// The SDK constant's *name*, e.g. `LicensedNotTargeted`. Goes into support logs; the
/// number is meaningless to anyone reading a ticket.
+ (NSString *)nativeCodeNameForCode:(IntuneMAMEnrollmentStatusCode)code;

@end

NS_ASSUME_NONNULL_END
