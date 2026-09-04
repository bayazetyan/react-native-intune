//
//  Copyright (c) 2026 react-native-intune contributors. MIT.
//

#import "RNIntuneAuth.h"
#import "RNIntuneCore.h"

#import <MSAL/MSAL.h>

/// The scope a sign-in falls back to. See the note on `defaultScopes` in the header for
/// why this cannot be `openid profile offline_access`.
static NSString *const RNIntuneDefaultScope = @"https://graph.microsoft.com/User.Read";

@implementation RNIntuneAuth {
  MSALPublicClientApplication *_client;
}

+ (NSArray<NSString *> *)defaultScopes
{
  return @[ RNIntuneDefaultScope ];
}

#pragma mark - Configuration

- (BOOL)configureWithClientId:(NSString *)clientId
                    authority:(NSString *)authority
                  redirectUri:(NSString *)redirectUri
                keychainGroup:(NSString *)keychainGroup
                        error:(NSError **)error
{
  NSURL *authorityUrl = [NSURL URLWithString:authority];
  if (authorityUrl == nil) {
    if (error != NULL) {
      *error = [RNIntuneCore
          errorWithCode:RNIntuneErrorNative
                message:@"The authority is not a valid URL. Expected something like "
                        @"https://login.microsoftonline.com/<tenantId>."];
    }
    return NO;
  }

  NSError *authorityError = nil;
  MSALAADAuthority *aadAuthority = [[MSALAADAuthority alloc] initWithURL:authorityUrl
                                                                  error:&authorityError];
  if (aadAuthority == nil) {
    if (error != NULL) {
      *error = [RNIntuneCore
          errorWithCode:RNIntuneErrorNative
                message:[NSString stringWithFormat:@"MSAL rejected the authority: %@",
                                                   authorityError
                                                       .localizedDescription
                                                   ?: @"unknown reason"]];
    }
    return NO;
  }

  MSALPublicClientApplicationConfig *config =
      [[MSALPublicClientApplicationConfig alloc] initWithClientId:clientId
                                                     redirectUri:redirectUri
                                                       authority:aadAuthority];

  // Only when the host plist asked for one. MSAL's own default is already
  // `com.microsoft.adalcache`, which is what the Intune SDK looks in — writing that
  // constant here by hand would just be a second place for it to drift (§5.1.4).
  if (keychainGroup.length > 0) {
    config.cacheConfig.keychainSharingGroup = keychainGroup;
  }

  NSError *clientError = nil;
  MSALPublicClientApplication *client =
      [[MSALPublicClientApplication alloc] initWithConfiguration:config error:&clientError];
  if (client == nil) {
    if (error != NULL) {
      // The usual cause is a redirect URI that does not match the required
      // `msauth.<bundle id>` format, or a missing keychain-sharing entitlement — both
      // were real failures on device before the example app was fixed (§5.1.2).
      *error = [RNIntuneCore
          errorWithCode:RNIntuneErrorNative
                message:[NSString
                            stringWithFormat:@"MSAL could not be initialised: %@",
                                             clientError.localizedDescription
                                                 ?: @"unknown reason"]];
    }
    return NO;
  }

  _client = client;
  return YES;
}

- (void)invalidate
{
  _client = nil;
}

- (BOOL)isConfigured
{
  return _client != nil;
}

#pragma mark - Sign-in

- (void)signInWithScopes:(NSArray<NSString *> *)scopes
               loginHint:(NSString *)loginHint
                  prompt:(NSString *)prompt
    presentingController:(UIViewController *)controller
              completion:(RNIntuneAuthCompletion)completion
{
  MSALPublicClientApplication *client = _client;
  if (client == nil) {
    completion(nil, [self notConfiguredError]);
    return;
  }

  MSALWebviewParameters *webParams =
      [[MSALWebviewParameters alloc] initWithAuthPresentationViewController:controller];

  MSALInteractiveTokenParameters *params =
      [[MSALInteractiveTokenParameters alloc] initWithScopes:[self resolveScopes:scopes]
                                          webviewParameters:webParams];
  params.promptType = [self promptTypeFromString:prompt];
  if (loginHint.length > 0) {
    params.loginHint = loginHint;
  }

  // MSAL requires the interactive call on the main thread, and it presents UI.
  dispatch_async(dispatch_get_main_queue(), ^{
    [client acquireTokenWithParameters:params
                      completionBlock:^(MSALResult *result, NSError *error) {
                        [self complete:completion result:result error:error];
                      }];
  });
}

- (void)signInSilentWithScopes:(NSArray<NSString *> *)scopes
                     accountId:(NSString *)accountId
                    completion:(RNIntuneAuthCompletion)completion
{
  [self acquireTokenWithScopes:scopes
                    accountId:accountId
                 forceRefresh:NO
                   completion:completion];
}

- (void)acquireTokenWithScopes:(NSArray<NSString *> *)scopes
                     accountId:(NSString *)accountId
                  forceRefresh:(BOOL)forceRefresh
                    completion:(RNIntuneAuthCompletion)completion
{
  MSALPublicClientApplication *client = _client;
  if (client == nil) {
    completion(nil, [self notConfiguredError]);
    return;
  }

  NSError *lookupError = nil;
  MSALAccount *account = [self accountForId:accountId error:&lookupError];
  if (account == nil) {
    // Not a fault. With no cached account there is nothing to refresh silently, and the
    // caller's next move is the same as for an expired token: sign in interactively.
    completion(nil,
               lookupError ?: [RNIntuneCore
                                  errorWithCode:RNIntuneErrorInteractionRequired
                                        message:@"No signed-in account is cached. Call "
                                                @"signIn to acquire one."]);
    return;
  }

  MSALSilentTokenParameters *params =
      [[MSALSilentTokenParameters alloc] initWithScopes:[self resolveScopes:scopes]
                                               account:account];
  params.forceRefresh = forceRefresh;

  [client acquireTokenSilentWithParameters:params
                          completionBlock:^(MSALResult *result, NSError *error) {
                            [self complete:completion result:result error:error];
                          }];
}

#pragma mark - Accounts

- (NSArray<NSDictionary<NSString *, id> *> *)accountsWithError:(NSError **)error
{
  MSALPublicClientApplication *client = _client;
  if (client == nil) {
    if (error != NULL) {
      *error = [self notConfiguredError];
    }
    return nil;
  }

  NSError *msalError = nil;
  NSArray<MSALAccount *> *accounts = [client allAccounts:&msalError];
  if (accounts == nil) {
    if (error != NULL) {
      *error = [RNIntuneCore errorWithCode:RNIntuneErrorNative
                                   message:msalError.localizedDescription
                                           ?: @"MSAL could not list accounts."];
    }
    return nil;
  }

  NSMutableArray<NSDictionary<NSString *, id> *> *out =
      [NSMutableArray arrayWithCapacity:accounts.count];
  for (MSALAccount *account in accounts) {
    [out addObject:@{
      @"accountId" : [self accountIdFor:account] ?: @"",
      @"tenantId" : account.homeAccountId.tenantId ?: @"",
      @"username" : account.username ?: @"",
    }];
  }
  return out;
}

- (BOOL)removeAccountId:(NSString *)accountId error:(NSError **)error
{
  MSALPublicClientApplication *client = _client;
  if (client == nil) {
    if (error != NULL) {
      *error = [self notConfiguredError];
    }
    return NO;
  }

  NSError *lookupError = nil;
  MSALAccount *account = [self accountForId:accountId error:&lookupError];
  if (account == nil) {
    // Already gone is success. `reset` runs this after the SDK has unregistered, and it
    // must be safe to retry from the journal on the next launch (SPEC §7).
    if (lookupError != nil && error != NULL) {
      *error = lookupError;
      return NO;
    }
    return YES;
  }

  NSError *removeError = nil;
  if (![client removeAccount:account error:&removeError]) {
    if (error != NULL) {
      *error = [RNIntuneCore errorWithCode:RNIntuneErrorNative
                                   message:removeError.localizedDescription
                                           ?: @"MSAL could not remove the account."];
    }
    return NO;
  }
  return YES;
}

- (void)removeAllAccounts
{
  MSALPublicClientApplication *client = _client;
  if (client == nil) {
    return;
  }

  NSArray<MSALAccount *> *accounts = [client allAccounts:NULL];
  for (MSALAccount *account in accounts) {
    // Errors are deliberately not propagated: this runs inside the reset sequence, where
    // the journal's verification decides whether the reset took, not this loop.
    [client removeAccount:account error:NULL];
  }
}

#pragma mark - Helpers

/**
 * Finds the account by the id this module hands out.
 *
 * That id is the Entra object ID, not MSAL's own `identifier` (which is
 * `<objectId>.<tenantId>`), because the Intune SDK's `registerAndEnrollAccountId:` wants
 * the object ID — one value has to serve both, so the narrower one wins. Matching is done
 * over `allAccounts` rather than `accountForIdentifier:` for the same reason: that lookup
 * takes MSAL's composite identifier, which is not what we store.
 */
- (MSALAccount *)accountForId:(NSString *)accountId error:(NSError **)error
{
  MSALPublicClientApplication *client = _client;
  NSError *msalError = nil;
  NSArray<MSALAccount *> *accounts = [client allAccounts:&msalError];
  if (accounts == nil) {
    if (error != NULL) {
      *error = [RNIntuneCore errorWithCode:RNIntuneErrorNative
                                   message:msalError.localizedDescription
                                           ?: @"MSAL could not list accounts."];
    }
    return nil;
  }

  if (accountId.length == 0) {
    // Single identity is decided (SPEC §9), so "the account" is unambiguous when there is
    // one. Callers that pass nothing get it rather than an argument error.
    return accounts.firstObject;
  }

  for (MSALAccount *account in accounts) {
    if ([[self accountIdFor:account] isEqualToString:accountId]) {
      return account;
    }
  }
  return nil;
}

- (NSString *)accountIdFor:(MSALAccount *)account
{
  return account.homeAccountId.objectId;
}

- (NSArray<NSString *> *)resolveScopes:(NSArray<NSString *> *)scopes
{
  return scopes.count > 0 ? scopes : RNIntuneAuth.defaultScopes;
}

- (MSALPromptType)promptTypeFromString:(NSString *)prompt
{
  if ([prompt isEqualToString:@"selectAccount"]) {
    return MSALPromptTypeSelectAccount;
  }
  if ([prompt isEqualToString:@"login"]) {
    return MSALPromptTypeLogin;
  }
  if ([prompt isEqualToString:@"consent"]) {
    return MSALPromptTypeConsent;
  }
  if ([prompt isEqualToString:@"whenRequired"]) {
    return MSALPromptTypePromptIfNecessary;
  }
  // Including nil. An unknown value must not fail a sign-in: a string added to the JS
  // enum later would otherwise break every already-shipped native binary.
  return MSALPromptTypeDefault;
}

- (NSError *)notConfiguredError
{
  return [RNIntuneCore errorWithCode:RNIntuneErrorNotConfigured
                             message:@"MSAL is not configured. Call configure first."];
}

/// Shapes an `AuthResult`, or maps MSAL's error onto a stable code. The access token here
/// is for the app's own scopes; the MAM token never passes through (CLAUDE.md rule 9).
- (void)complete:(RNIntuneAuthCompletion)completion
          result:(MSALResult *)result
           error:(NSError *)error
{
  if (result != nil) {
    completion(@{
      @"accountId" : [self accountIdFor:result.account] ?: @"",
      @"tenantId" : result.account.homeAccountId.tenantId ?: @"",
      @"username" : result.account.username ?: @"",
      @"accessToken" : result.accessToken,
      @"idToken" : result.idToken ?: NSNull.null,
      // Unix seconds, matching AuthResult in SPEC §13.1.1.
      @"expiresOn" : @(result.expiresOn.timeIntervalSince1970),
      @"scopes" : result.scopes,
    },
               nil);
    return;
  }

  completion(nil, [self mapError:error]);
}

- (NSError *)mapError:(NSError *)error
{
  if (error == nil) {
    return [RNIntuneCore errorWithCode:RNIntuneErrorNative
                              message:@"MSAL returned neither a result nor an error."];
  }

  if ([error.domain isEqualToString:MSALErrorDomain]) {
    switch ((MSALError)error.code) {
      case MSALErrorInteractionRequired:
        return [RNIntuneCore
            errorWithCode:RNIntuneErrorInteractionRequired
                  message:@"A prompt is required. Call signIn instead of signInSilent."];
      case MSALErrorUserCanceled:
        return [RNIntuneCore errorWithCode:RNIntuneErrorUserCancelled
                                   message:@"The user dismissed the sign-in UI."];
      default:
        break;
    }
  }

  // Everything else keeps MSAL's own description, which names the cause far better than
  // a re-worded guess would. No token or claim is ever part of it.
  return [RNIntuneCore errorWithCode:RNIntuneErrorNative
                             message:error.localizedDescription
                                     ?: @"MSAL failed with no description."];
}

@end
