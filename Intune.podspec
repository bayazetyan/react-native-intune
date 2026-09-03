require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

vendor_ios = File.join(__dir__, "vendor", "ios")
unless File.directory?(vendor_ios) && !Dir.glob(File.join(vendor_ios, "*.xcframework")).empty?
  raise "[react-native-intune] Microsoft SDKs are missing. " \
        "Run `npx react-native-intune fetch-sdks` and then `pod install` again."
end

Pod::Spec.new do |s|
  s.name         = "RNIntune"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "16.0" }
  s.source       = { :git => "https://github.com/bayazetyan/react-native-intune.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm}"
  s.private_header_files = "ios/**/*.h"

  s.vendored_frameworks = [
    "vendor/ios/IntuneMAMSwift.xcframework",
    "vendor/ios/IntuneMAMSwiftStub.xcframework"
  ]

  # Keep the configurator binary in the package so consumers can call it from a build phase
  s.preserve_paths = "vendor/**/*"

  s.frameworks = "MessageUI", "Security", "CoreServices", "SystemConfiguration",
                 "ImageIO", "LocalAuthentication", "AudioToolbox", "QuartzCore",
                 "WebKit", "MetricKit"
  s.libraries  = "sqlite3", "c++"

  s.dependency "MSAL", "~> 1.7"   # TODO pin to the version verified in the spike

  s.pod_target_xcconfig = {
    "STRIP_SWIFT_SYMBOLS" => "NO",
    "ENABLE_BITCODE"      => "NO"
  }

  install_modules_dependencies(s)
end
