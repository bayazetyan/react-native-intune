//
//  The configure-time assertions (SPEC §12.7 S1).
//
//  Each one is a configuration mistake that otherwise surfaces days later as
//  `MAMEnrollmentStatusAuthRequired`, in a tenant you cannot reach, with nothing in the
//  logs pointing at the cause. Refusing to start is the kinder failure.
//

#import <Foundation/Foundation.h>

@class RNIntuneConfig;

NS_ASSUME_NONNULL_BEGIN

@interface RNIntunePlistGuard : NSObject

/// The host app's `IntuneMAMSettings` dictionary, or an empty one.
+ (NSDictionary *)settings;

/// YES when `Info.plist` and `configure()` agree. Otherwise fills `error` with
/// `E_PLIST_CONFLICT` and a message naming the offending key.
+ (BOOL)check:(RNIntuneConfig *)config error:(NSError *_Nullable *_Nullable)error;

/// For `getDiagnostics` — whether any forbidden identity key is present.
+ (BOOL)hasIdentityKeys;

/// For `getDiagnostics` — the plist's MaxFileProtectionLevel, or an empty string.
+ (NSString *)maxFileProtectionLevel;

@end

NS_ASSUME_NONNULL_END
