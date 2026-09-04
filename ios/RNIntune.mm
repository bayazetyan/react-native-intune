//
//  Copyright (c) 2026 react-native-intune contributors. MIT.
//

#import "RNIntune.h"
#import "RNIntuneCore.h"

/// Rejects with a stable code (SPEC §13.6). RCTPromiseRejectBlock reads `code` off the
/// NSError's userInfo, so every rejection built by RNIntuneCore arrives in JS with the
/// documented string rather than a platform error number.
static void RNIntuneReject(RCTPromiseRejectBlock reject, NSError *error)
{
  NSString *code = error.userInfo[@"code"] ?: RNIntuneErrorNative;
  reject(code, error.localizedDescription, error);
}

static void RNIntuneRejectNotConfigured(RCTPromiseRejectBlock reject, NSString *method)
{
  NSError *error = [RNIntuneCore
      errorWithCode:RNIntuneErrorNotConfigured
            message:[NSString stringWithFormat:
                                  @"%@ was called before configure() resolved.", method]];
  RNIntuneReject(reject, error);
}

@implementation RNIntune {
  /// Events emitted before JS subscribed. Flushed in startObserving.
  NSMutableArray<NSDictionary *> *_pendingEvents;
  BOOL _observing;
}

// Generates +moduleName. The argument must match TurboModuleRegistry.getEnforcing in
// src/NativeIntune.ts (SPEC §2.2) — do not also declare +moduleName by hand, the macro
// already does and the duplicate does not compile.
RCT_EXPORT_MODULE(RNIntune)

- (instancetype)init
{
  if ((self = [super init])) {
    _pendingEvents = [NSMutableArray new];
    _observing = NO;

    // Wired here, not in configure(): the SDK can call a delegate before the app has
    // called anything, and an event lost during startup means the reset machine never
    // runs (SPEC §4.4). sendEventWithName: queues while nothing is listening.
    __weak __typeof(self) weakSelf = self;
    [RNIntuneCore.shared setEventSink:^(NSString *event, NSDictionary *body) {
      // The SDK picks its own thread; RCTEventEmitter must be driven from the JS queue.
      dispatch_async(dispatch_get_main_queue(), ^{
        [weakSelf sendEventWithName:event body:body];
      });
    }];
  }
  return self;
}

+ (BOOL)requiresMainQueueSetup
{
  // Construction only allocates the queue. The SDK's own initialisation is triggered by
  // configure(), not by module creation, so there is no reason to block app startup.
  return NO;
}

#pragma mark - Events

- (NSArray<NSString *> *)supportedEvents
{
  return @[
    RNIntuneEventEnrollmentResult,
    RNIntuneEventPolicyChanged,
    RNIntuneEventUnenrollmentResult,
    RNIntuneEventWipeRequested,
    RNIntuneEventRestartRequired,
    RNIntuneEventTokenRequest,
    RNIntuneEventBrokerStatusChanged,
  ];
}

- (void)startObserving
{
  _observing = YES;

  // A wipe notification lost during startup means the reset machine never runs, so
  // anything emitted before this point is replayed rather than discarded (SPEC §4.4).
  NSArray<NSDictionary *> *queued = [_pendingEvents copy];
  [_pendingEvents removeAllObjects];
  for (NSDictionary *event in queued) {
    [super sendEventWithName:event[@"name"] body:event[@"body"]];
  }
}

- (void)stopObserving
{
  _observing = NO;
}

- (void)sendEventWithName:(NSString *)name body:(id)body
{
  if (_observing) {
    [super sendEventWithName:name body:body];
    return;
  }
  [_pendingEvents addObject:@{@"name" : name, @"body" : body ?: NSNull.null}];
}

#pragma mark - Lifecycle

- (void)configure:(JS::NativeIntune::SpecConfigureConfig &)config
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject
{
  // The generated struct is a typed view over the NSDictionary, so a renamed spec field
  // fails to compile here instead of silently reading nil. Everything crossing into the
  // .m core below is a plain ObjC type.
  RNIntuneConfig *resolved = [RNIntuneConfig new];
  resolved.clientId = config.clientId();
  resolved.tenantId = config.tenantId();
  resolved.authority = config.authority();
  resolved.redirectUri = config.redirectUri();
  resolved.authMode = config.authMode();
  resolved.maxFileProtectionLevel = config.maxFileProtectionLevel();
  resolved.keychainGroupOverride = config.keychainGroupOverride();
  resolved.verboseLogging = config.verboseLogging();
  resolved.restartHandledByApp = config.restartHandledByApp();
  resolved.telemetryEnabled = config.telemetryEnabled();

  NSError *error = nil;
  if (![RNIntuneCore.shared applyConfig:resolved error:&error]) {
    RNIntuneReject(reject, error);
    return;
  }
  resolve(nil);
}

- (void)isSupported:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve(@(RNIntuneCore.shared.sdkAvailable));
}

- (void)getBrokerStatus:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject
{
  resolve([RNIntuneCore.shared brokerStatus]);
}

- (void)openBrokerInstall:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject
{
  RNIntuneRejectNotConfigured(reject, @"openBrokerInstall");
}

#pragma mark - Auth

- (void)signIn:(NSDictionary *)params
       resolve:(RCTPromiseResolveBlock)resolve
        reject:(RCTPromiseRejectBlock)reject
{
  RNIntuneRejectNotConfigured(reject, @"signIn");
}

- (void)signInSilent:(NSDictionary *)params
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject
{
  RNIntuneRejectNotConfigured(reject, @"signInSilent");
}

- (void)acquireToken:(NSDictionary *)params
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject
{
  RNIntuneRejectNotConfigured(reject, @"acquireToken");
}

- (void)getAccounts:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  RNIntuneRejectNotConfigured(reject, @"getAccounts");
}

- (void)signOut:(JS::NativeIntune::SpecSignOutParams &)params
        resolve:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject
{
  RNIntuneRejectNotConfigured(reject, @"signOut");
}

#pragma mark - Enrollment

- (void)enroll:(JS::NativeIntune::SpecEnrollParams &)params
       resolve:(RCTPromiseResolveBlock)resolve
        reject:(RCTPromiseRejectBlock)reject
{
  if (!RNIntuneCore.shared.isConfigured) {
    RNIntuneRejectNotConfigured(reject, @"enroll");
    return;
  }

  NSString *accountId = params.accountId();
  if (accountId.length == 0) {
    RNIntuneReject(reject,
                   [RNIntuneCore errorWithCode:RNIntuneErrorInvalidAccountId
                                       message:@"enroll() requires an Entra object ID."]);
    return;
  }

  // Resolves for every outcome including failures — a non-success status is data, not an
  // exception (SPEC §13.2). It only rejects for the programming errors above.
  [RNIntuneCore.shared enrollAccountId:accountId
                            completion:^(NSDictionary<NSString *, id> *result) {
                              resolve(result);
                            }];
}

- (void)getState:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  // Deliberately never rejects: reporting `configured: false` is what makes this the
  // reconciliation primitive (SPEC §13.2).
  resolve([RNIntuneCore.shared state]);
}

- (void)reset:(JS::NativeIntune::SpecResetParams &)params
      resolve:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject
{
  RNIntuneRejectNotConfigured(reject, @"reset");
}

#pragma mark - Policy

- (void)getPolicy:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  RNIntuneRejectNotConfigured(reject, @"getPolicy");
}

- (void)getDiagnostics:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  resolve([RNIntuneCore.shared diagnostics]);
}

#pragma mark - Token provider

// Not public API — setTokenProvider in index.ts wraps these. The token goes straight to
// the SDK and is never logged or returned to JS (CLAUDE.md rule 9).
- (void)resolveToken:(JS::NativeIntune::SpecResolveTokenParams &)params
{
  [RNIntuneCore.shared resolveTokenRequest:params.requestId() token:params.token()];
}

- (void)rejectToken:(JS::NativeIntune::SpecRejectTokenParams &)params
{
  [RNIntuneCore.shared rejectTokenRequest:params.requestId() reason:params.reason()];
}

#pragma mark - TurboModule

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeIntuneSpecJSI>(params);
}

@end
