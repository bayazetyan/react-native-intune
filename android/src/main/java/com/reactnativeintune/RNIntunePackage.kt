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
    mapOf(
      RNIntuneModule.NAME to ReactModuleInfo(
        name = RNIntuneModule.NAME,
        className = RNIntuneModule.NAME,
        canOverrideExistingModule = false,
        // The event emitter must be live from construction, not from the first
        // enroll() — a service-initiated wipe can arrive before JS calls anything
        // (SPEC §4.4, §12.4). Revisit this flag when the emitter lands.
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true
      )
    )
  }
}
