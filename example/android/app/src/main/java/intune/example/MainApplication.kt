package intune.example

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.reactnativeintune.RNIntuneAuthCallback

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)

    // The MAM Gradle plugin rewrites this whole method into onMAMCreate() and the
    // super call with it, which is exactly where the SDK requires the auth callback to
    // be registered — earlier than any React context exists (SPEC §6.1.2). Verified in
    // the S-2 report: MainApplication's base class becomes MAMApplication and
    // `void onCreate()` is renamed, not wrapped.
    RNIntuneAuthCallback.register(this)
  }
}
