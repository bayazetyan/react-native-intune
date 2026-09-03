require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# The Microsoft SDKs are fetched, never committed (SPEC §2.1). Fail here with an
# instruction rather than letting the linker fail 200 lines deep.
vendor_ios = File.join(__dir__, "vendor", "ios")
unless File.directory?(vendor_ios) && !Dir.glob(File.join(vendor_ios, "*.xcframework")).empty?
  raise "[react-native-intune] The Microsoft Intune App SDK is missing from vendor/ios. " \
        "Run `yarn fetch-sdks` (or `node node_modules/react-native-intune/scripts/fetch-sdks.mjs`) " \
        "and then `pod install` again."
end

Pod::Spec.new do |s|
  s.name         = "RNIntune"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  # Deliberately NOT min_ios_version_supported. Intune App SDK 21.8.0 is built with
  # `minos 17.0` (verified with otool on IntuneMAMSwift.framework), so a host app on
  # React Native's floor of 15.1 cannot link it. Supporting iOS 16 means pinning SDK
  # 20.x, which Microsoft maintains for high-priority security fixes only.
  s.platforms    = { :ios => "17.0" }
  s.source       = { :git => "https://github.com/bayazetyan/react-native-intune.git", :tag => "#{s.version}" }

  # No .swift and no .cpp on purpose — see SPEC §5.1.1 for the language split.
  s.source_files = "ios/**/*.{h,m,mm}"
  s.private_header_files = "ios/**/*.h"

  # IntuneMAMTelemetry is a separate product in 21.x and must be linked explicitly.
  s.vendored_frameworks = [
    "vendor/ios/IntuneMAMSwift.xcframework",
    "vendor/ios/IntuneMAMSwiftStub.xcframework",
    "vendor/ios/IntuneMAMTelemetry.xcframework"
  ]

  # Not optional. Carries PinViewController, the blur/policy/diagnostics/MTD-compliance
  # screens and 28 localizations. Without it the SDK's UI cannot render — and that
  # failure shows up at runtime, not at build time.
  s.resources = ["vendor/ios/IntuneMAMResources.bundle"]

  # Keeps IntuneMAMConfigurator (and Microsoft's licence files) in the installed pod so
  # the consumer can call the configurator from an Xcode build phase.
  s.preserve_paths = "vendor/**/*"

  s.frameworks = "MessageUI", "Security", "CoreServices", "SystemConfiguration",
                 "ImageIO", "LocalAuthentication", "AudioToolbox", "QuartzCore",
                 "WebKit", "MetricKit"
  s.libraries  = "sqlite3", "c++"

  # MSAL is ours to own (SPEC §3.1) but the version is pinned in the auth spike, not
  # guessed here: sdk-versions.json -> toolchain.msal_ios is still TODO (SPEC §5.1.2,
  # S-3). A floating `~> 1.7` would let two consumers build against different MSALs,
  # which is exactly what pinning the Intune SDK exists to prevent. No code references
  # MSAL yet, so leaving it out costs nothing today.
  # s.dependency "MSAL", "<pinned in S-3>"

  s.pod_target_xcconfig = {
    "STRIP_SWIFT_SYMBOLS" => "NO",
    "ENABLE_BITCODE"      => "NO"
  }

  # RN 0.74+ helper: wires Codegen and the New Architecture dependencies. Do not
  # hand-roll React-Core / folly deps or RCT_NEW_ARCH_ENABLED flags.
  install_modules_dependencies(s)
end
