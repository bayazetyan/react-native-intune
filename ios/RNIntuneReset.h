//
//  The reset sequence (SPEC §7).
//
//  Separate from RNIntuneResetJournal on purpose: the journal is storage, this is the
//  order of operations. The order is the part that is easy to get wrong — the unregister
//  has to precede any token purge, and the process is not guaranteed to survive it.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface RNIntuneReset : NSObject

/**
 * Opens the journal, then unregisters and unenrolls every registered account.
 *
 * **Blocks** while the SDK acquires the Intune AAD token, so it must not run on the main
 * thread. The caller is responsible for that.
 */
+ (void)runWithWipe:(BOOL)wipe
             reason:(NSString *)reason
           tenantId:(nullable NSString *)tenantId;

/// Verifies the account is really gone and closes the journal. NO leaves it open, so the
/// next launch retries rather than declaring a reset that did not happen.
+ (BOOL)complete;

@end

NS_ASSUME_NONNULL_END
