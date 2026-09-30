package com.reactnativeintune

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class RNIntunePackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return if (name == RNIntuneModule.NAME) {
      RNIntuneModule(reactContext)
    } else {
      null
    }
  }

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    // Positional, not named. In React Native 0.74 `ReactModuleInfo` is still a Java
    // class, and Kotlin cannot pass named arguments to a Java constructor — the named
    // form compiles only on versions where the class was rewritten in Kotlin, so it
    // failed on 0.74 while building everywhere this was developed. The six parameters
    // are in the same order in both.
    mapOf(
      RNIntuneModule.NAME to ReactModuleInfo(
        RNIntuneModule.NAME, // name
        RNIntuneModule.NAME, // className
        false, // canOverrideExistingModule
        // The event emitter must be live from construction, not from the first
        // enroll() — a service-initiated wipe can arrive before JS calls anything
        // (SPEC §4.4, §12.4). Revisit this flag when the emitter lands.
        false, // needsEagerInit
        false, // isCxxModule
        true, // isTurboModule
      )
    )
  }
}
