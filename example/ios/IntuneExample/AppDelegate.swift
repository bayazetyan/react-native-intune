import UIKit
import MSAL
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "IntuneExample",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  /// Hands the sign-in result back to MSAL.
  ///
  /// Without this the redirect arrives at the app and stops there: MSAL never learns the
  /// login finished, so it opens the login screen again, and again. The symptom is a
  /// loop with no error message anywhere.
  ///
  /// This is host-app code the module cannot write for you — it lives in your
  /// AppDelegate (SPEC §5.1.2). It is needed even when the Intune SDK is the one driving
  /// the sign-in, because the SDK drives *your* MSAL rather than carrying its own.
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    MSALPublicClientApplication.handleMSALResponse(
      url,
      sourceApplication: options[.sourceApplication] as? String
    )
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
