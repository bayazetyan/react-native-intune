#import "RNIntune.h"

// This file is ObjC++ because getTurboModule: returns a std::shared_ptr — that is C++
// and cannot be written in Swift. Everything that touches the Intune SDK lives in
// plain .m files instead (SPEC §5.1.1).
@implementation RNIntune

// Placeholder from the scaffold. It exists to prove Codegen, autolinking and the
// vendored-framework link all work before any SDK code is written; it is removed with
// the first real method (SPEC §13).
- (NSNumber *)multiply:(double)a b:(double)b
{
  return @(a * b);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeIntuneSpecJSI>(params);
}

+ (NSString *)moduleName
{
  // Must match TurboModuleRegistry.getEnforcing in src/NativeIntune.ts (SPEC §2.2).
  return @"RNIntune";
}

@end
