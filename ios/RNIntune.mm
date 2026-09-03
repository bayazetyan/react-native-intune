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
  RNIntuneRejectNotConfigured(reject, @"enroll");
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

- (void)resolveToken:(JS::NativeIntune::SpecResolveTokenParams &)params
{
  // The MAM service token never crosses back out to JS and is never logged
  // (CLAUDE.md rule 9). Wiring lands with the Android auth callback in SPEC §13.4;
  // on iOS the equivalent is getAccessTokenForAccountId:resource:completion:.
}

- (void)rejectToken:(JS::NativeIntune::SpecRejectTokenParams &)params
{
}

#pragma mark - TurboModule

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeIntuneSpecJSI>(params);
}

@end
