//
//  Everything waiting for the SDK to call back.
//
//  Two kinds of wait, one set of rules:
//
//    - **enroll** — `registerAndEnrollAccountId:` returns immediately and says nothing;
//      the outcome arrives later on the delegate. The caller's completion waits here,
//      keyed by account ID.
//    - **token** — the SDK asks for a MAM service token and waits on a completion block
//      while JS answers. Keyed by a generated request ID.
//
//  Both are settled from SDK-chosen threads, so both are behind one lock. Both time out
//  rather than waiting forever, and both are *taken* rather than read when settled — a
//  late answer after a timeout must not be applied twice.
//

#import <Foundation/Foundation.h>

#import "RNIntuneDelegates.h"

NS_ASSUME_NONNULL_BEGIN

@interface RNIntunePendingRequests : NSObject

- (instancetype)initWithEventSink:(RNIntuneEventSink)sink NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

/// Registers `completion`, starts the timeout, then makes the SDK call — in that order,
/// because `registerAndEnrollAccountId:` can report through the delegate before it
/// returns.
- (void)awaitEnrollment:(NSString *)accountId
             completion:(void (^)(NSDictionary<NSString *, id> *result))completion;

/**
 * Interactive enrollment, which cannot be keyed by account ID — the caller only has a
 * UPN, and the SDK reports the object ID. Only one can be in flight because the SDK is
 * showing a modal sign-in screen, so a single slot is enough.
 */
- (void)awaitInteractiveEnrollmentWithUpn:(nullable NSString *)upn
                               completion:(void (^)(NSDictionary<NSString *, id> *result))completion;

/// Called for every delegate event; settles a waiting caller when one matches.
- (void)settleForEvent:(NSString *)event body:(NSDictionary *)body;

/// Publishes a `tokenRequest` and holds the SDK's completion until JS answers.
- (void)handleTokenRequestForAccountId:(NSString *)accountId
                              resource:(NSString *)resource
                              tenantId:(nullable NSString *)tenantId
                             authority:(nullable NSString *)authority
                            completion:(RNIntuneTokenCompletion)completion;

- (void)resolveTokenRequest:(NSString *)requestId token:(NSString *)token;
- (void)rejectTokenRequest:(NSString *)requestId reason:(NSString *)reason;

@end

NS_ASSUME_NONNULL_END
