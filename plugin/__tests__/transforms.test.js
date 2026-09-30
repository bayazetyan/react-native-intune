const { describe, expect, it } = require('@jest/globals');
const {
  withMamApplication,
  withMamClasspath,
  withMamPluginApplied,
  withMsalResponseHandler,
} = require('../transforms');

/**
 * These cover the string surgery the Expo plugin performs on generated files. The
 * plugin wiring itself cannot be tested here — `@expo/config-plugins` is only present
 * in an Expo project — which is exactly why the surgery lives in pure functions.
 *
 * Idempotence is tested on every one of them, because `expo prebuild` without
 * `--clean` runs plugins against files a previous run already modified.
 */

const KOTLIN_APP = `package com.acme

import android.app.Application
import com.facebook.react.PackageList

class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    SoLoader.init(this, false)
  }
}
`;

const JAVA_APP = `package com.acme;

import android.app.Application;
import com.facebook.react.PackageList;

public class MainApplication extends Application implements ReactApplication {
  @Override
  public void onCreate() {
    super.onCreate();
    SoLoader.init(this, false);
  }
}
`;

describe('withMamApplication', () => {
  it('registers the callback in onCreate', () => {
    const out = withMamApplication(KOTLIN_APP, 'kt');
    expect(out).toContain('import com.reactnativeintune.RNIntuneAuthCallback');
    expect(out).toContain('RNIntuneAuthCallback.register(this)');
  });

  /**
   * Issue #5, and the test that would have caught it. Rewriting the superclass in source
   * cannot compile in a consumer app: the MAM AAR is `implementation files(...)` here and
   * `implementation` is not transitive, so `MAMApplication` is not on the app module's
   * compile classpath. The superclass belongs to the Gradle plugin, which rewrites it in
   * bytecode — which is what the example app has always relied on.
   *
   * These assertions are inverted from the ones they replace. The old ones passed, and
   * they were asserting the defect.
   */
  it('leaves the superclass alone — the Gradle plugin rewrites it in bytecode', () => {
    for (const [src, lang, unchanged] of [
      [
        KOTLIN_APP,
        'kt',
        'class MainApplication : Application(), ReactApplication',
      ],
      [
        JAVA_APP,
        'java',
        'public class MainApplication extends Application implements ReactApplication',
      ],
    ]) {
      const out = withMamApplication(src, lang);
      expect(out).toContain(unchanged);
      expect(out).not.toContain('MAMApplication');
    }
  });

  /**
   * What 0.1.0 wrote for KOTLIN_APP, captured by running that version's transform — not
   * reconstructed by hand. `expo prebuild` without `--clean` runs plugins against a file
   * a previous run already touched, and this file registers the callback, so without the
   * migration the idempotency guard would leave it as it is: on the version that fixes
   * #5, still not compiling.
   */
  const WRITTEN_BY_0_1_0 = `package com.acme

import android.app.Application
import com.facebook.react.PackageList
import com.microsoft.intune.mam.client.app.MAMApplication
import com.reactnativeintune.RNIntuneAuthCallback

class MainApplication : MAMApplication(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    // react-native-intune: the MAM plugin rewrites onCreate into onMAMCreate at build
    // time, so this belongs here rather than in an onMAMCreate we write.
    RNIntuneAuthCallback.register(this)
    SoLoader.init(this, false)
  }
}
`;

  it('reverts the superclass a 0.1.0 prebuild wrote, and leaves the callback once', () => {
    const out = withMamApplication(WRITTEN_BY_0_1_0, 'kt');
    expect(out).toContain(
      'class MainApplication : Application(), ReactApplication'
    );
    expect(out).not.toContain('MAMApplication');
    expect(out).toContain('import android.app.Application');
    expect(out.match(/RNIntuneAuthCallback\.register/g)).toHaveLength(1);
    // And it lands on what a fresh run produces, so the two paths cannot drift apart.
    expect(out).toBe(withMamApplication(KOTLIN_APP, 'kt'));
  });

  it('reverts the Java form 0.1.0 wrote', () => {
    const legacy = withMamApplication(JAVA_APP, 'java')
      .replace('extends Application', 'extends MAMApplication')
      .replace(
        'import com.reactnativeintune.RNIntuneAuthCallback;',
        'import com.microsoft.intune.mam.client.app.MAMApplication;\nimport com.reactnativeintune.RNIntuneAuthCallback;'
      );
    expect(withMamApplication(legacy, 'java')).toBe(
      withMamApplication(JAVA_APP, 'java')
    );
  });

  /**
   * The migration keys on this transform's own comment. Without it, a MAMApplication
   * superclass was written by the app's developer, who presumably put the SDK on their
   * classpath, and is not ours to change.
   */
  it('does not revert a MAMApplication superclass it did not write', () => {
    const own = KOTLIN_APP.replace(
      ': Application()',
      ': MAMApplication()'
    ).replace(
      'SoLoader.init(this, false)',
      'RNIntuneAuthCallback.register(this)\n    SoLoader.init(this, false)'
    );
    expect(withMamApplication(own, 'kt')).toBe(own);
  });

  /**
   * An app that wired the SDK into its own module may already extend MAMApplication, and
   * that is valid — the plugin's rewrite is then a no-op. The transform must still add
   * the callback rather than refuse the file.
   */
  it('accepts a class that already extends MAMApplication', () => {
    const src = KOTLIN_APP.replace(': Application()', ': MAMApplication()');
    const out = withMamApplication(src, 'kt');
    expect(out).toContain('class MainApplication : MAMApplication()');
    expect(out).toContain('RNIntuneAuthCallback.register(this)');
  });

  /**
   * The callback goes in `onCreate`, not `onMAMCreate`. The MAM Gradle plugin rewrites
   * onCreate into onMAMCreate at build time, so a hand-written onMAMCreate would be a
   * method the plugin never calls — and the failure is silent: enrollment reports a
   * licensing-shaped status and retries forever.
   */
  it('registers in onCreate, which the plugin rewrites, not in onMAMCreate', () => {
    const out = withMamApplication(KOTLIN_APP, 'kt');
    // No *declaration* of onMAMCreate — the comment explaining why mentions the name.
    expect(out).not.toMatch(/fun\s+onMAMCreate/);
    const inOnCreate = out.slice(out.indexOf('override fun onCreate'));
    expect(inOnCreate).toContain('RNIntuneAuthCallback.register(this)');
  });

  /**
   * After `super.onCreate()`, never before it. The superclass initialises the MAM
   * machinery the callback registers with, so registering first registers against
   * nothing — and it fails the way everything here fails, quietly. The first version of
   * this transform inserted at the top of the method and this test is why it does not.
   */
  it('registers after super, not before it', () => {
    for (const [src, lang] of [
      [KOTLIN_APP, 'kt'],
      [JAVA_APP, 'java'],
    ]) {
      const out = withMamApplication(src, lang);
      expect(out.indexOf('RNIntuneAuthCallback.register')).toBeGreaterThan(
        out.indexOf('super.onCreate')
      );
    }
  });

  it('handles Java, with its own import and statement terminators', () => {
    const out = withMamApplication(JAVA_APP, 'java');
    expect(out).toContain('import com.reactnativeintune.RNIntuneAuthCallback;');
    expect(out).toContain('RNIntuneAuthCallback.register(this);');
  });

  it('is idempotent', () => {
    const once = withMamApplication(KOTLIN_APP, 'kt');
    expect(withMamApplication(once, 'kt')).toBe(once);
  });

  /**
   * Null rather than a mangled file. This is one of the three omissions that build and
   * run while leaving the app unprotected, so the caller turns a null into a loud
   * warning — a generated file that does not compile would at least be obvious, but a
   * half-edited one that does compile is the worst available outcome.
   */
  it('returns null when the class shape is not recognised', () => {
    expect(
      withMamApplication('class Weird : SomethingElse() {}', 'kt')
    ).toBeNull();
    expect(
      withMamApplication(
        KOTLIN_APP.replace('override fun onCreate', 'fun other'),
        'kt'
      )
    ).toBeNull();
  });
});

describe('withMamPluginApplied', () => {
  it('appends the plugin and its configuration', () => {
    const out = withMamPluginApplied(
      'apply plugin: "com.android.application"\n'
    );
    expect(out).toContain('apply plugin: "com.microsoft.intune.mam"');
    expect(out).toContain('intunemam {');
  });

  it('is idempotent', () => {
    const once = withMamPluginApplied(
      'apply plugin: "com.android.application"\n'
    );
    expect(withMamPluginApplied(once)).toBe(once);
  });
});

describe('withMamClasspath', () => {
  const ROOT_GRADLE = `buildscript {
    ext { buildToolsVersion = "35.0.0" }
    dependencies {
        classpath("com.android.tools.build:gradle")
    }
}

allprojects {
    dependencies {
    }
}
`;

  it('adds the jar and javassist to the buildscript block', () => {
    const out = withMamClasspath(ROOT_GRADLE);
    expect(out).toContain('com.microsoft.intune.mam.build.jar');
    expect(out).toContain('org.javassist:javassist:3.29.2-GA');
  });

  /**
   * The anchor is `buildscript { ... dependencies {`, not `dependencies {` anywhere.
   * A buildscript classpath added to a project's own dependencies block does nothing at
   * all, and nothing about the resulting build says why.
   */
  it('targets the buildscript dependencies block, not another one', () => {
    const out = withMamClasspath(ROOT_GRADLE);
    const inserted = out.indexOf('com.microsoft.intune.mam.build.jar');
    expect(inserted).toBeGreaterThan(out.indexOf('buildscript {'));
    expect(inserted).toBeLessThan(out.indexOf('allprojects {'));
  });

  it('is idempotent', () => {
    const once = withMamClasspath(ROOT_GRADLE);
    expect(withMamClasspath(once)).toBe(once);
  });

  it('returns null when there is no buildscript dependencies block to anchor on', () => {
    expect(withMamClasspath('allprojects { }\n')).toBeNull();
  });
});

describe('withMsalResponseHandler', () => {
  /** The open-URL handler of Expo SDK 57's generated AppDelegate.swift, verbatim. */
  const SWIFT_APP_DELEGATE = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }
}
`;

  /** The same handler in the Objective-C++ AppDelegate older Expo SDKs generate. */
  const OBJC_APP_DELEGATE = `#import "AppDelegate.h"

#import <React/RCTLinkingManager.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options {
  return [super application:application openURL:url options:options] || [RCTLinkingManager application:application openURL:url options:options];
}

@end
`;

  /**
   * MSAL first, so a redirect meant for it is consumed before Linking sees it, and
   * everything that was there before still runs for any other URL.
   */
  it('forwards to MSAL ahead of what the handler already did', () => {
    const out = withMsalResponseHandler(SWIFT_APP_DELEGATE, 'swift');
    expect(out).toContain('import MSAL');
    expect(out).toContain(
      'return MSALPublicClientApplication.handleMSALResponse(url, sourceApplication: options[.sourceApplication] as? String) || super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)'
    );
  });

  it('puts the import with the other imports', () => {
    const out = withMsalResponseHandler(SWIFT_APP_DELEGATE, 'swift');
    expect(out.indexOf('import MSAL')).toBeGreaterThan(
      out.indexOf('import ReactAppDependencyProvider')
    );
    expect(out.indexOf('import MSAL')).toBeLessThan(out.indexOf('@main'));
  });

  it('handles the Objective-C AppDelegate', () => {
    const out = withMsalResponseHandler(OBJC_APP_DELEGATE, 'objcpp');
    expect(out).toContain('#import <MSAL/MSAL.h>');
    expect(out).toContain(
      'return [MSALPublicClientApplication handleMSALResponse:url sourceApplication:options[UIApplicationOpenURLOptionsSourceApplicationKey]] || [super application:application openURL:url options:options]'
    );
  });

  it('is idempotent', () => {
    for (const [src, lang] of [
      [SWIFT_APP_DELEGATE, 'swift'],
      [OBJC_APP_DELEGATE, 'objcpp'],
    ]) {
      const once = withMsalResponseHandler(src, lang);
      expect(withMsalResponseHandler(once, lang)).toBe(once);
      expect(once.match(/handleMSALResponse/g)).toHaveLength(1);
    }
  });

  /**
   * React Native's own templates have no open-URL handler at all, so the forward has to
   * be a whole method — at the end of the AppDelegate class, not before the next one.
   */
  it('adds a handler when the AppDelegate has none', () => {
    const bare = `import UIKit
import React

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let message = "a brace in a string } must not end the class"
    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
}
`;
    const out = withMsalResponseHandler(bare, 'swift');
    expect(out).toContain('import MSAL');
    const cls = out.slice(
      out.indexOf('class AppDelegate'),
      out.indexOf('class ReactNativeDelegate')
    );
    expect(cls).toContain('open url: URL');
    expect(cls).toContain('MSALPublicClientApplication.handleMSALResponse(');
    expect(withMsalResponseHandler(out, 'swift')).toBe(out);
  });

  /** Null, which becomes a warning, rather than a forward written somewhere it never runs. */
  it('returns null when there is no AppDelegate class to extend', () => {
    expect(
      withMsalResponseHandler('import UIKit\n\nstruct NotIt {}\n', 'swift')
    ).toBeNull();
  });
});
