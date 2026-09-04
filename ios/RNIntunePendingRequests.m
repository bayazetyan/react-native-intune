//
//  Copyright (c) 2026 react-native-intune contributors. MIT.
//

#import "RNIntunePendingRequests.h"
#import "RNIntuneCore.h"

#import <IntuneMAMSwift/IntuneMAMSwift.h>

/**
 * How long to wait for the SDK to say something before completing an enroll as `pending`.
 * Generous on purpose: enrollment involves a token acquisition and a service round trip,
 * and returning early would report a failure the SDK has not actually reached.
 */
static const NSTimeInterval RNIntuneEnrollTimeout = 90.0;

/// How long JS gets to answer a token request before the SDK is told we cannot supply one.
static const NSTimeInterval RNIntuneTokenTimeout = 45.0;

@implementation RNIntunePendingRequests {
  RNIntuneEventSink _emit;
  /// accountId -> completion, waiting on the enrollment delegate.
  NSMutableDictionary<NSString *, void (^)(NSDictionary *)> *_pendingEnrollments;
  /// requestId -> the SDK's own completion, waiting on JS.
  NSMutableDictionary<NSString *, RNIntuneTokenCompletion> *_pendingTokenRequests;
  /// Guards both: callbacks arrive on threads the SDK chooses.
  NSLock *_lock;
  NSUInteger _requestCounter;
  /// Single slot: the SDK's sign-in screen is modal, so only one can be waiting.
  void (^_Nullable _pendingInteractive)(NSDictionary *);
}

- (instancetype)initWithEventSink:(RNIntuneEventSink)sink
{
  if ((self = [super init])) {
    _emit = [sink copy];
    _pendingEnrollments = [NSMutableDictionary new];
    _pendingTokenRequests = [NSMutableDictionary new];
    _lock = [NSLock new];
    _requestCounter = 0;
  }
  return self;
}

#pragma mark - Enrollment

- (void)awaitEnrollment:(NSString *)accountId
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
        [weakSelf completeEnrollment:accountId
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

- (void)awaitInteractiveEnrollmentWithUpn:(NSString *)upn
                               completion:(void (^)(NSDictionary<NSString *, id> *))completion
{
  [_lock lock];
  void (^existing)(NSDictionary *) = _pendingInteractive;
  _pendingInteractive = completion;
  [_lock unlock];

  // A previous interactive attempt that never reported is abandoned rather than left
  // hanging: the user has started a new one, so the old screen is gone.
  if (existing) {
    existing(@{
      @"status" : @"unknown",
      @"accountId" : NSNull.null,
      @"nativeCode" : @"RNIntuneSuperseded",
      @"nativeMessage" : @"A newer interactive enrollment replaced this one.",
      @"restartRequired" : @NO,
    });
  }

  __weak __typeof(self) weakSelf = self;
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(RNIntuneEnrollTimeout * NSEC_PER_SEC)),
      dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        [weakSelf completeInteractiveWithResult:@{
          @"status" : @"pending",
          @"accountId" : NSNull.null,
          @"nativeCode" : @"RNIntuneTimeout",
          @"nativeMessage" : @"The SDK did not report a result within the timeout. The "
                             @"sign-in may still be on screen; watch onEnrollmentResult.",
          @"restartRequired" : @NO,
        }];
      });

  // nil is legal and documented: the SDK then asks for the address itself.
  dispatch_async(dispatch_get_main_queue(), ^{
    [IntuneMAMEnrollmentManager.instance
        loginAndEnrollAccount:upn.length > 0 ? upn : nil];
  });
}

- (void)completeInteractiveWithResult:(NSDictionary *)result
{
  [_lock lock];
  void (^completion)(NSDictionary *) = _pendingInteractive;
  _pendingInteractive = nil;
  [_lock unlock];

  if (completion) {
    completion(result);
  }
}

- (void)settleForEvent:(NSString *)event body:(NSDictionary *)body
{
  if (![event isEqualToString:RNIntuneEventEnrollmentResult]) {
    return;
  }
  // An interactive caller is waiting on a UPN and has no account ID to match, so any
  // enrollment result settles it. The SDK's sign-in screen is modal, so the only thing
  // that could race here is one of its own background retries — an early result, not a
  // wrong one.
  [self completeInteractiveWithResult:body];

  id accountId = body[@"accountId"];
  if (![accountId isKindOfClass:NSString.class]) {
    return;
  }
  [self completeEnrollment:accountId withResult:body];
}

- (void)completeEnrollment:(NSString *)accountId withResult:(NSDictionary *)result
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
                              tenantId:(NSString *)tenantId
                             authority:(NSString *)authority
                            completion:(RNIntuneTokenCompletion)completion
{
  [_lock lock];
  NSString *requestId =
      [NSString stringWithFormat:@"tok-%lu", (unsigned long)(++_requestCounter)];
  _pendingTokenRequests[requestId] = completion;
  [_lock unlock];

  // `resourceId` is what the provider turns into a scope; the token never comes back
  // through JS to the SDK by any other route (SPEC §13.4).
  _emit(RNIntuneEventTokenRequest,
        @{
          @"requestId" : requestId,
          @"resourceId" : resource ?: @"",
          @"accountId" : accountId ?: @"",
          @"tenantId" : tenantId ?: @"",
          @"authority" : authority ?: @"",
        });

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

@end
