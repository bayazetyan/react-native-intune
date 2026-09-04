//
//  PolicySnapshot (SPEC §4.3).
//
//  For adapting the host app's own UI — nothing here is enforcement. PIN prompts,
//  screenshot blocking and encryption all happen inside the SDK and are not driven by
//  these values.
//
//  There is no clipboard field and there cannot be one: neither platform exposes a
//  clipboard policy getter. `canSaveToPersonal` and `canOpenFromUnmanaged` serve the same
//  purpose using values the SDK will actually answer.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface RNIntunePolicy : NSObject

/// Nil only when the SDK is not linked. An unmanaged app reports permissive values
/// rather than `false` — reporting `false` would hide controls nothing is restricting.
+ (nullable NSDictionary<NSString *, id> *)snapshot;

@end

NS_ASSUME_NONNULL_END
