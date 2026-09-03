package com.intune

import com.facebook.react.bridge.ReactApplicationContext

class IntuneModule(reactContext: ReactApplicationContext) :
  NativeIntuneSpec(reactContext) {

  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  companion object {
    const val NAME = NativeIntuneSpec.NAME
  }
}
