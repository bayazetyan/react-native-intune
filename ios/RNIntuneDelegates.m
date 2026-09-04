//
//  Copyright (c) 2026 react-native-intune contributors. MIT.
//

#import "RNIntuneDelegates.h"
#import "RNIntuneCore.h"

/// Unified status strings. Must match `EnrollmentStatus` in src/types.ts.
static NSString *const kSucceeded = @"succeeded";
static NSString *const kNotLicensed = @"notLicensed";
static NSString *const kNotTargeted = @"notTargeted";
static NSString *const kFailed = @"failed";
static NSString *const kAuthorizationNeeded = @"authorizationNeeded";
static NSString *const kWrongUser = @"wrongUser";
static NSString *const kUnenrolled = @"unenrolled";
static NSString *const kUnenrollmentFailed = @"unenrollmentFailed";
static NSString *const kUnknown = @"unknown";

@implementation RNIntuneDelegates {
  RNIntuneEventSink _sink;
  RNIntuneTokenRequestHandler _tokenHandler;
}

- (instancetype)initWithEventSink:(RNIntuneEventSink)sink
              tokenRequestHandler:(RNIntuneTokenRequestHandler)tokenHandler
{
  if ((self = [super init])) {
    _sink = [sink copy];
    _tokenHandler = [tokenHandler copy];
    _restartHandledByApp = NO;
  }
  return self;
}

#pragma mark - Status mapping

+ (NSString *)unifiedStatusForCode:(IntuneMAMEnrollmentStatusCode)code
{
  // The full table, with its reasoning, is SPEC §4.1. Read it before changing a row:
  // several of these are decisions rather than transcription, and getting NotLicensed
  // versus Failed backwards has opposite consequences for the user (SPEC §8).
  switch (code) {
    // ---- 1xx success ----
    case IntuneMAMEnrollmentStatusNewPoliciesReceived:
    case IntuneMAMEnrollmentStatusPoliciesHaveNotChanged:
      return kSucceeded;

    // Policy request succeeded, but no policy targets the user. Not a licence problem,
    // and must not block.
    case IntuneMAMEnrollmentStatusNoPolicyReceived:
    case IntuneMAMEnrollmentStatusLicensedNotTargeted:
      return kNotTargeted;

    // A service-initiated wipe. The account's data is gone, so the state is unenrolled —
    // reporting "succeeded" here is how a wipe ends up ignored.
    case IntuneMAMEnrollmentStatusWipeReceived:
    case IntuneMAMEnrollmentStatusUnenrollmentSuccess:
    case IntuneMAMEnrollmentStatusAppNotEnrolled:
      return kUnenrolled;

    // ---- 2xx failure ----
    // The call failed; the state is enrolled. enroll() has to be idempotent.
    case IntuneMAMEnrollmentStatusAlreadyEnrolled:
      return kSucceeded;

    // Microsoft's own comment bundles two meanings into TenantMigration: "the tenant is
    // either undergoing a migration, or the user is not licensed for MAM". Blocking
    // every user of a tenant mid-migration would be a self-inflicted outage, so the
    // non-blocking reading wins.
    case IntuneMAMEnrollmentStatusAccountNotLicensed:
    case IntuneMAMEnrollmentStatusTenantMigration:
      return kNotLicensed;

    // The user cancelled the prompt, so the true state is "credentials still needed",
    // which is retryable. Mapping it to failed would block a user for pressing Cancel.
    case IntuneMAMEnrollmentStatusAuthRequired:
    case IntuneMAMEnrollmentStatusADALInternalError:
    case IntuneMAMEnrollmentStatusLoginCanceled:
      return kAuthorizationNeeded;

    // Wrong account, in its several forms. Three of these are documented as requiring
    // the app to remove the account.
    case IntuneMAMEnrollmentStatusNotEmmAccount:
    case IntuneMAMEnrollmentStatusMdmEnrolledDifferentUser:
    case IntuneMAMEnrollmentStatusNotDeviceAccount:
    case IntuneMAMEnrollmentStatusNotEnrolledAccount:
    case IntuneMAMEnrollmentStatusSwitchExistingAccount:
    case IntuneMAMEnrollmentStatusSingleManagedAccountMode:
      return kWrongUser;

    case IntuneMAMEnrollmentStatusFailedToClearMamData:
      return kUnenrollmentFailed;

    case IntuneMAMEnrollmentStatusInternalError:
    case IntuneMAMEnrollmentStatusMamServiceDisabled:
    case IntuneMAMEnrollmentStatusLocationServiceFailure:
    case IntuneMAMEnrollmentStatusEnrollmentEndPointNetworkFailure:
    case IntuneMAMEnrollmentStatusParsingFailure:
    case IntuneMAMEnrollmentStatusNilAccount:
    case IntuneMAMEnrollmentStatusPolicyEndPointNetworkFailure:
    case IntuneMAMEnrollmentStatusTimeout:
    case IntuneMAMEnrollmentStatusPolicyRecordGone:
    case IntuneMAMEnrollmentStatusReEnrollForUnenrolledUser:
    case IntuneMAMEnrollmentStatusUnsupportedAPI:
    case IntuneMAMEnrollmentStatusADALMethodUnsupported:
    case IntuneMAMEnrollmentStatusDeviceBlockedEnrollment:
      return kFailed;
  }

  // No `default:` above, so adding an SDK constant produces a compiler warning here
  // rather than silence. Anything unmapped still degrades to `unknown` instead of
  // throwing, so an SDK update cannot crash a shipped app.
  return kUnknown;
}

+ (NSString *)nativeCodeNameForCode:(IntuneMAMEnrollmentStatusCode)code
{
#define RNIntuneCaseName(name)                     \
  case IntuneMAMEnrollmentStatus##name:            \
    return @ #name;

  switch (code) {
    RNIntuneCaseName(NewPoliciesReceived)
    RNIntuneCaseName(PoliciesHaveNotChanged)
    RNIntuneCaseName(WipeReceived)
    RNIntuneCaseName(NoPolicyReceived)
    RNIntuneCaseName(UnenrollmentSuccess)
    RNIntuneCaseName(AccountNotLicensed)
    RNIntuneCaseName(InternalError)
    RNIntuneCaseName(MamServiceDisabled)
    RNIntuneCaseName(AuthRequired)
    RNIntuneCaseName(LocationServiceFailure)
    RNIntuneCaseName(EnrollmentEndPointNetworkFailure)
    RNIntuneCaseName(ParsingFailure)
    RNIntuneCaseName(NilAccount)
    RNIntuneCaseName(AlreadyEnrolled)
    RNIntuneCaseName(NotEmmAccount)
    RNIntuneCaseName(MdmEnrolledDifferentUser)
    RNIntuneCaseName(NotDeviceAccount)
    RNIntuneCaseName(PolicyEndPointNetworkFailure)
    RNIntuneCaseName(AppNotEnrolled)
    RNIntuneCaseName(NotEnrolledAccount)
    RNIntuneCaseName(FailedToClearMamData)
    RNIntuneCaseName(Timeout)
    RNIntuneCaseName(ADALInternalError)
    RNIntuneCaseName(SwitchExistingAccount)
    RNIntuneCaseName(LoginCanceled)
    RNIntuneCaseName(PolicyRecordGone)
    RNIntuneCaseName(ReEnrollForUnenrolledUser)
    RNIntuneCaseName(TenantMigration)
    RNIntuneCaseName(UnsupportedAPI)
    RNIntuneCaseName(ADALMethodUnsupported)
    RNIntuneCaseName(LicensedNotTargeted)
    RNIntuneCaseName(DeviceBlockedEnrollment)
    RNIntuneCaseName(SingleManagedAccountMode)
  }

#undef RNIntuneCaseName

  return [NSString stringWithFormat:@"Unmapped(%lu)", (unsigned long)code];
}

+ (NSDictionary<NSString *, id> *)resultFromStatus:(IntuneMAMEnrollmentStatus *)status
{
  // status.errorString is the SDK's own debug text. It carries no token — but it is not
  // the place to add the UPN either, and status.identity is deliberately not read here
  // (CLAUDE.md rule 3). accountId is the Entra object ID, which is what JS asked with.
  return @{
    @"status" : [self unifiedStatusForCode:status.statusCode],
    @"accountId" : status.accountId ?: NSNull.null,
    @"nativeCode" : [self nativeCodeNameForCode:status.statusCode],
    @"nativeMessage" : status.errorString ?: @"",
    // Set by the policy delegate's restartApplication callback, not by the status.
    @"restartRequired" : @NO,
  };
}

#pragma mark - IntuneMAMEnrollmentDelegate

- (void)enrollmentRequestWithStatus:(IntuneMAMEnrollmentStatus *)status
{
  _sink(RNIntuneEventEnrollmentResult, [RNIntuneDelegates resultFromStatus:status]);
}

- (void)policyRequestWithStatus:(IntuneMAMEnrollmentStatus *)status
{
  // A wipe arrives here, not through a dedicated callback, and it can arrive with the app
  // having asked for nothing at all. Publish both: the reset machine listens for the
  // wipe, and anything waiting on a policy refresh listens for the result (SPEC §4.4).
  if (status.statusCode == IntuneMAMEnrollmentStatusWipeReceived) {
    _sink(RNIntuneEventWipeRequested, @{@"accountId" : status.accountId ?: NSNull.null});
  }
  _sink(RNIntuneEventEnrollmentResult, [RNIntuneDelegates resultFromStatus:status]);
}

- (void)unenrollRequestWithStatus:(IntuneMAMEnrollmentStatus *)status
{
  _sink(RNIntuneEventUnenrollmentResult, [RNIntuneDelegates resultFromStatus:status]);
}

/**
 * The SDK asking for a MAM service token. This is the iOS counterpart of Android's
 * MAMServiceAuthenticationCallback.
 *
 * Unlike Android's, this one is asynchronous — the SDK hands us a completion block — so
 * nothing here blocks a thread while JS thinks. The token goes straight back to the SDK
 * and is never returned to JS or logged (CLAUDE.md rule 9).
 */
- (void)getAccessTokenForAccountId:(NSString *)oid
                          resource:(NSString *)resource
                        completion:(void (^)(IntuneMAMEnrollmentToken *))completion
{
  _tokenHandler(oid, resource, ^(NSString *_Nullable token, NSString *_Nullable reason) {
    IntuneMAMEnrollmentToken *result = [IntuneMAMEnrollmentToken new];
    if (token.length > 0) {
      result.accessToken = token;
      result.oid = oid;
    } else {
      // The header is explicit that `error` is required when no token is returned.
      // Without it the SDK cannot distinguish "no token" from a malformed reply.
      result.error = [RNIntuneCore
          errorWithCode:RNIntuneErrorTokenProviderFailed
                message:reason.length > 0 ? reason : @"No MAM service token was provided"];
    }
    completion(result);
  });
}

#pragma mark - IntuneMAMPolicyDelegate

- (BOOL)restartApplication
{
  // Called on a background thread when policy is applied for the first time. Returning
  // TRUE promises that the *host app* restarts itself; FALSE hands the restart to the
  // SDK. We publish the event either way so the app can show something first.
  _sink(RNIntuneEventRestartRequired, @{@"reason" : @"policyAppliedFirstTime"});
  return _restartHandledByApp;
}

- (BOOL)wipeDataForAccountId:(NSString *)accountId
{
  // Returning NO leaves the SDK's own wipe in place and keeps the app's data untouched
  // here. The app's local data is cleared through the reset journal instead, because the
  // process may not survive long enough to do it inline (SPEC §7).
  _sink(RNIntuneEventWipeRequested, @{@"accountId" : accountId ?: NSNull.null});
  return NO;
}

// identitySwitchRequiredForAccountId:, blockAccountId: and addAccountId: are deliberately
// not implemented. They exist for multi-identity apps, and single identity is a decided
// constraint (SPEC §9, CLAUDE.md rule 10): two accounts are never signed in at once, so
// there is no switch to arbitrate. The SDK's own defaults apply for all three.

@end
