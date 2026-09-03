//
//  Codegen conformance and the JS bridge. ObjC++ because getTurboModule: returns a
//  std::shared_ptr and the generated parameter structs are C++ — neither can be written
//  in Objective-C or Swift (SPEC §5.1.1).
//
//  This class unpacks and forwards. It holds no SDK state and makes no SDK calls; that
//  is RNIntuneCore's job, in plain .m (CLAUDE.md rule 7).
//
//  The umbrella header name comes from package.json -> codegenConfig.name; the protocol
//  name from the spec file name (src/NativeIntune.ts -> NativeIntuneSpec).
//
#import <RNIntuneSpec/RNIntuneSpec.h>
#import <React/RCTEventEmitter.h>

/// RCTEventEmitter, not NSObject: the emitter has to be live from module construction
/// because a service-initiated wipe can arrive before the app calls anything, and events
/// fired before JS subscribes are queued rather than dropped (SPEC §4.4).
@interface RNIntune : RCTEventEmitter <NativeIntuneSpec>

@end
