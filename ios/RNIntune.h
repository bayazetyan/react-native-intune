// Codegen conformance only. The umbrella header name comes from
// package.json -> codegenConfig.name ("RNIntuneSpec"); the protocol name comes from
// the spec file name (src/NativeIntune.ts -> NativeIntuneSpec).
#import <RNIntuneSpec/RNIntuneSpec.h>

@interface RNIntune : NSObject <NativeIntuneSpec>

@end
