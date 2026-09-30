import { describe, expect, it } from '@jest/globals';

import {
  entitlementsWithKeychainGroups,
  pbxprojAddConfiguratorPhase,
  pbxprojSetDeploymentTarget,
  pbxprojSetEntitlements,
  plistEnsureStrings,
  plistEnsureUrlScheme,
  plistRemoveKeys,
} from '../lib/edits.mjs';

/**
 * The text edits setup makes to iOS project files. Text rather than a plutil round trip,
 * because the round trip drops comments — and React Native's template keeps one in
 * Info.plist — so every test here also checks that the rest of the file is untouched.
 */

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>$(PRODUCT_NAME)</string>
	<key>NSAppTransportSecurity</key>
	<dict>
	  <!-- Do not change NSAllowsArbitraryLoads to true, or you will risk app rejection! -->
		<key>NSAllowsArbitraryLoads</key>
		<false/>
	</dict>
</dict>
</plist>
`;

const COMMENT = '<!-- Do not change NSAllowsArbitraryLoads to true';

describe('plist edits', () => {
  it('adds a URL type, keeping the template comment', () => {
    const out = plistEnsureUrlScheme(
      INFO_PLIST,
      'msauth.$(PRODUCT_BUNDLE_IDENTIFIER)'
    );
    expect(out).toContain('<key>CFBundleURLTypes</key>');
    expect(out).toContain(
      '<string>msauth.$(PRODUCT_BUNDLE_IDENTIFIER)</string>'
    );
    expect(out).toContain(COMMENT);
    // Added at the end of the top-level dict, after everything that was there.
    expect(out.indexOf('CFBundleURLTypes')).toBeGreaterThan(
      out.indexOf('NSAppTransportSecurity')
    );
    expect(
      plistEnsureUrlScheme(out, 'msauth.$(PRODUCT_BUNDLE_IDENTIFIER)')
    ).toBe(out);
  });

  it('adds a URL type alongside ones the app already has', () => {
    const withOne = plistEnsureUrlScheme(INFO_PLIST, 'myapp');
    const out = plistEnsureUrlScheme(
      withOne,
      'msauth.$(PRODUCT_BUNDLE_IDENTIFIER)'
    );
    expect(out).toContain('<string>myapp</string>');
    expect(out).toContain(
      '<string>msauth.$(PRODUCT_BUNDLE_IDENTIFIER)</string>'
    );
    expect(out.match(/<key>CFBundleURLTypes<\/key>/g)).toHaveLength(1);
  });

  it('adds only the query schemes that are missing', () => {
    const once = plistEnsureStrings(INFO_PLIST, 'LSApplicationQueriesSchemes', [
      'msauthv2',
    ]);
    const out = plistEnsureStrings(once, 'LSApplicationQueriesSchemes', [
      'msauthv2',
      'msauthv3',
    ]);
    expect(out.match(/<string>msauthv2<\/string>/g)).toHaveLength(1);
    expect(out).toContain('<string>msauthv3</string>');
    expect(out).toContain(COMMENT);
  });

  it('removes the ADAL identity keys and their values, and nothing else', () => {
    const src = INFO_PLIST.replace(
      '</dict>\n</plist>',
      `\t<key>IntuneMAMSettings</key>
\t<dict>
\t\t<key>ADALClientId</key>
\t\t<string>abc</string>
\t\t<key>ADALCacheKeychainGroupOverride</key>
\t\t<string>com.example.shared</string>
\t</dict>
</dict>
</plist>`
    );
    const out = plistRemoveKeys(src, [
      'ADALClientId',
      'ADALAuthority',
      'ADALRedirectUri',
    ]);
    expect(out).not.toContain('ADALClientId');
    expect(out).not.toContain('<string>abc</string>');
    // Not an identity key, and the only way to set the keychain group — it stays.
    expect(out).toContain('ADALCacheKeychainGroupOverride');
    expect(out).toContain(COMMENT);
  });
});

describe('entitlementsWithKeychainGroups', () => {
  const GROUPS = [
    '$(AppIdentifierPrefix)$(PRODUCT_BUNDLE_IDENTIFIER)',
    '$(AppIdentifierPrefix)com.microsoft.intune.mam',
    '$(AppIdentifierPrefix)com.microsoft.adalcache',
  ];

  it('creates the file React Native templates do not have', () => {
    const out = entitlementsWithKeychainGroups('', GROUPS);
    expect(out).toContain('<plist version="1.0">');
    expect(out.indexOf(GROUPS[0])).toBeLessThan(out.indexOf(GROUPS[1]));
    expect(out.indexOf(GROUPS[1])).toBeLessThan(out.indexOf(GROUPS[2]));
  });

  /**
   * The app's own group first — without an explicit access group iOS writes to the first
   * one, so a Microsoft group there would receive the app's keychain items — and any
   * group the app already had kept, after ours.
   */
  it('puts the required groups first and keeps the app’s others', () => {
    const existing = entitlementsWithKeychainGroups('', [
      '$(AppIdentifierPrefix)com.example.shared',
      GROUPS[1],
    ]);
    const out = entitlementsWithKeychainGroups(existing, GROUPS);
    const strings = [...out.matchAll(/<string>([^<]*)<\/string>/g)].map(
      (m) => m[1]
    );
    expect(strings).toEqual([
      ...GROUPS,
      '$(AppIdentifierPrefix)com.example.shared',
    ]);
    expect(entitlementsWithKeychainGroups(out, GROUPS)).toBe(out);
  });
});

describe('project.pbxproj edits', () => {
  const id = (n) => `${n}`.padStart(24, '0');
  const config = (n, name, settings) =>
    `\t\t${id(n)} /* ${name} */ = {\n\t\t\tisa = XCBuildConfiguration;\n` +
    `\t\t\tbuildSettings = {\n${settings.map((l) => `\t\t\t\t${l}\n`).join('')}\t\t\t};\n` +
    `\t\t\tname = ${name};\n\t\t};\n`;
  const PBX =
    '// !$*UTF8*$!\n{\n\tobjects = {\n' +
    '/* Begin PBXNativeTarget section */\n' +
    `\t\t${id(1)} /* app */ = {\n\t\t\tisa = PBXNativeTarget;\n` +
    `\t\t\tbuildConfigurationList = ${id(10)} /* list */;\n` +
    `\t\t\tbuildPhases = (\n\t\t\t\t${id(30)} /* Sources */,\n\t\t\t);\n` +
    '\t\t\tproductType = "com.apple.product-type.application";\n\t\t};\n' +
    '/* End PBXNativeTarget section */\n\n' +
    '/* Begin PBXSourcesBuildPhase section */\n' +
    `\t\t${id(30)} /* Sources */ = {\n\t\t\tisa = PBXSourcesBuildPhase;\n\t\t};\n` +
    '/* End PBXSourcesBuildPhase section */\n\n' +
    config(20, 'Debug', ['PRODUCT_NAME = app;']) +
    config(21, 'Release', [
      'IPHONEOS_DEPLOYMENT_TARGET = 15.1;',
      'PRODUCT_NAME = app;',
    ]) +
    `\t\t${id(10)} /* list */ = {\n\t\t\tisa = XCConfigurationList;\n` +
    `\t\t\tbuildConfigurations = (\n\t\t\t\t${id(20)} /* Debug */,\n\t\t\t\t${id(21)} /* Release */,\n\t\t\t);\n\t\t};\n` +
    '\t};\n}\n';

  const atLeast17 = (v) => Number(v.split('.')[0]) >= 17;

  it('sets the deployment target on every configuration of the app target', () => {
    const out = pbxprojSetDeploymentTarget(PBX, '17.0', atLeast17);
    expect(out.match(/IPHONEOS_DEPLOYMENT_TARGET = 17\.0;/g)).toHaveLength(2);
    expect(out).not.toContain('15.1');
    expect(pbxprojSetDeploymentTarget(out, '17.0', atLeast17)).toBe(out);
  });

  it('points the app target at the entitlements file, once', () => {
    const out = pbxprojSetEntitlements(PBX, 'app/app.entitlements');
    expect(
      out.match(/CODE_SIGN_ENTITLEMENTS = app\/app\.entitlements;/g)
    ).toHaveLength(2);
    expect(pbxprojSetEntitlements(out, 'app/app.entitlements')).toBe(out);
  });

  it('adds the configurator phase first in the app target', () => {
    const out = pbxprojAddConfiguratorPhase(PBX, 'echo "run"\n', id(99));
    expect(out).toContain('/* Begin PBXShellScriptBuildPhase section */');
    expect(out).toContain(`${id(99)} /* Run IntuneMAMConfigurator */ = {`);
    expect(out).toContain('shellScript = "echo \\"run\\"\\n";');
    const phases = out.slice(
      out.indexOf('buildPhases = ('),
      out.indexOf('productType')
    );
    expect(phases.indexOf(id(99))).toBeLessThan(phases.indexOf(id(30)));
    expect(pbxprojAddConfiguratorPhase(out, 'echo "run"\n')).toBe(out);
  });

  it('returns null when there is no application target', () => {
    const none = PBX.replace(
      'com.apple.product-type.application',
      'com.apple.product-type.framework'
    );
    expect(pbxprojSetDeploymentTarget(none, '17.0', atLeast17)).toBeNull();
    expect(pbxprojSetEntitlements(none, 'x')).toBeNull();
    expect(pbxprojAddConfiguratorPhase(none, 'x')).toBeNull();
  });
});
