//
//  The reset journal (SPEC §7).
//
//  Unregistering an account that had policy enforced makes the SDK wipe that account's
//  data, and **the process terminating is expected behaviour, not a crash**. Code after
//  the unregister call does not run. So the sequence is not held in memory: each stage is
//  written down before it is attempted, and the next launch reads what was in flight.
//
//      IDLE -> UNREGISTERING -> CLEANING_AUTH -> CLEANING_LOCAL -> IDLE
//
//  Pure Objective-C, no SDK dependency: the journal has to be readable at launch before
//  anything else is configured.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Stage strings. Must match `ResetStage` in src/types.ts.
extern NSString *const RNIntuneResetStageUnregistering;
extern NSString *const RNIntuneResetStageCleaningAuth;
extern NSString *const RNIntuneResetStageCleaningLocal;

@interface RNIntuneResetJournal : NSObject

+ (instancetype)shared;

/// The open entry, or nil when no reset is in flight. Keys: stage, accountId, tenantId,
/// wipe, reason, startedAt.
@property (nonatomic, readonly, nullable) NSDictionary<NSString *, id> *entry;

/// Current stage, or nil. This is what `getState().pendingReset` reports.
@property (nonatomic, readonly, nullable) NSString *stage;

/// Why the open reset started, or nil. Reported as `getState().pendingResetReason` so a
/// resume can pass the original reason on rather than flattening it to `'resume'`.
@property (nonatomic, readonly, nullable) NSString *reason;

/// Writes the entry at `UNREGISTERING`. Must return before the unregister call is made —
/// after it, there may be no process left to write anything.
- (void)openWithAccountId:(nullable NSString *)accountId
                 tenantId:(nullable NSString *)tenantId
                     wipe:(BOOL)wipe
                   reason:(NSString *)reason;

/**
 * Opens the journal for a wipe the *service* started, unless one is already open.
 *
 * A service-initiated wipe is one of the callers of the reset path (SPEC §7, "one code
 * path, many callers"), and it needs the journal for the same reason `reset()` does: the
 * SDK terminates the process, so the consumer's cleanup may not finish and nothing else
 * will come back for it. Without an entry there is no `pendingReset`, so the next launch
 * has no idea anything happened.
 *
 * Returns NO when an entry already exists. A reset already in flight must not be
 * overwritten — its `reason` and `accountId` are what the resumed sequence acts on.
 */
- (BOOL)openForServiceWipeWithAccountId:(nullable NSString *)accountId
                               tenantId:(nullable NSString *)tenantId;

- (void)advanceToStage:(NSString *)stage;

/// Only after the account is verified gone. An unverified reset stays open and is retried
/// on the next launch rather than being marked done (SPEC §7 step 5).
- (void)close;

@end

NS_ASSUME_NONNULL_END
