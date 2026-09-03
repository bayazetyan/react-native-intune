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

@interface RNIntuneDelegates : NSObject <IntuneMAMEnrollmentDelegate, IntuneMAMPolicyDelegate>

- (instancetype)initWithEventSink:(RNIntuneEventSink)sink NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

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
