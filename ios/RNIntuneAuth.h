//
//  MSAL: the client, sign-in, and tokens for the app's own scopes (SPEC §3, spike S-3).
//
//  Pure Objective-C and free of React imports, like every other file on this side of the
//  boundary — `RNIntune.mm` is the only place that knows about React (CLAUDE.md rule 7).
//  That is why the presenting view controller arrives as a parameter instead of being
//  looked up here: finding it is the bridge's job.
//
//  Two tokens exist and only one of them leaves this file. The MAM service token is never
//  returned, never logged, and is not even acquired here — the SDK acquires it itself,
//  from the cache this object populates (§5.1.3). Everything returned by these methods is
//  for the *app's* scopes (§3.5, CLAUDE.md rule 9).
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// Completes with an `AuthResult`-shaped dictionary, or an error carrying one of the
/// stable codes in SPEC §13.6. Never both.
typedef void (^RNIntuneAuthCompletion)(NSDictionary<NSString *, id> *_Nullable result,
                                       NSError *_Nullable error);

@interface RNIntuneAuth : NSObject

/**
 * Builds the MSAL client for one tenant.
 *
 * `keychainGroup` is the value resolved from the host app's plist, not from `configure`
 * (§5.1.4): the Intune SDK's half of this setting has no runtime setter, so the group is
 * a build-time value and `configure` only asserts agreement. Pass nil to let MSAL keep
 * its own default, which is already what the Intune SDK expects.
 *
 * Returns NO and fills `error` when MSAL rejects the configuration — a malformed
 * authority URL is the common case, and it is worth failing loudly at `configure` rather
 * than at the first sign-in.
 */
- (BOOL)configureWithClientId:(NSString *)clientId
                    authority:(NSString *)authority
                  redirectUri:(NSString *)redirectUri
                keychainGroup:(nullable NSString *)keychainGroup
                        error:(NSError *_Nullable *_Nullable)error;

/// Drops the client and forgets the tenant. Called from `reset`, which must leave nothing
/// pinned to the old tenant (SPEC §7).
- (void)invalidate;

@property (nonatomic, readonly, getter=isConfigured) BOOL configured;

#pragma mark - Sign-in

/**
 * Interactive sign-in. Uses the broker when one is present, which also gives device-wide
 * SSO: a user already signed into another Microsoft app usually gets a token with no
 * prompt at all.
 *
 * `scopes` may be empty — see `defaultScopes`. `prompt` takes the public API's strings
 * (`selectAccount`, `login`, `consent`, `whenRequired`); anything else falls back to
 * MSAL's default rather than rejecting, so a future value added to the JS enum cannot
 * break a shipped native binary.
 */
- (void)signInWithScopes:(NSArray<NSString *> *)scopes
               loginHint:(nullable NSString *)loginHint
                  prompt:(nullable NSString *)prompt
    presentingController:(UIViewController *)controller
              completion:(RNIntuneAuthCompletion)completion;

/// Cache-first. Fails with `E_INTERACTION_REQUIRED` when a prompt is needed — the callers'
/// pattern is silent first, interactive on that failure.
- (void)signInSilentWithScopes:(NSArray<NSString *> *)scopes
                     accountId:(nullable NSString *)accountId
                    completion:(RNIntuneAuthCompletion)completion;

/// A token for the app's own scopes, for an account that is already signed in.
- (void)acquireTokenWithScopes:(NSArray<NSString *> *)scopes
                     accountId:(nullable NSString *)accountId
                  forceRefresh:(BOOL)forceRefresh
                    completion:(RNIntuneAuthCompletion)completion;

#pragma mark - Accounts

/**
 * Accounts with cached refresh tokens, as `AuthAccount` dictionaries.
 *
 * Under single identity (SPEC §9) this holds at most one; more than one means state a
 * reset should have cleared, which is worth surfacing rather than hiding.
 */
- (nullable NSArray<NSDictionary<NSString *, id> *> *)accountsWithError:
    (NSError *_Nullable *_Nullable)error;

/// Removes the account and its tokens from the MSAL cache. This is the half of `reset`
/// the module could not do while MSAL lived in the host app (SPEC §7 step 4).
- (BOOL)removeAccountId:(NSString *)accountId error:(NSError *_Nullable *_Nullable)error;

/// Empties the cache of every account. Used by `reset`, which runs without a specific
/// account in hand once the SDK has already unregistered it.
- (void)removeAllAccounts;

#pragma mark - Defaults

/**
 * What `signIn` asks for when the caller names no scopes.
 *
 * `https://graph.microsoft.com/User.Read`, because MSAL leaves no cheaper option: it
 * adds `openid`, `profile` and `offline_access` itself and *rejects* a call that names
 * them ("reserved scopes and may not be specified"), so a sign-in must ask for some real
 * resource. `User.Read` is the one Entra grants every new app registration by default,
 * and the one Microsoft's own samples use for exactly this.
 *
 * It is a default, not a requirement — an app with its own API passes its own scopes.
 * What matters for this module is the side effect either way: the refresh token lands in
 * the shared cache, and the SDK then acquires the MAM token from it silently (§5.1.3).
 * The refresh token is per account, not per resource, so which scope got it there does
 * not affect enrollment.
 */
@property (class, nonatomic, readonly) NSArray<NSString *> *defaultScopes;

@end

NS_ASSUME_NONNULL_END
