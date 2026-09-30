/**
 * The text edits `setup` makes to iOS project files, as pure functions.
 *
 * Text, not a parse-and-serialise round trip, for plists and project.pbxproj alike.
 * `plutil` would have been simpler and it drops comments: React Native's template keeps
 * "Do not change NSAllowsArbitraryLoads to true, or you will risk app rejection!" inside
 * Info.plist, and a setup that silently deletes the template's warnings has made a change
 * nobody asked for. Every function here inserts or replaces the smallest span it can and
 * leaves the rest of the file byte for byte.
 *
 * Each returns the new text, or null when the file does not have the shape the edit
 * needs. Null becomes "do this by hand" — the same answer as a check without an apply,
 * which beats an edit landing somewhere it has no effect.
 */

import crypto from 'node:crypto';

// ---------------------------------------------------------------- plist

/** The top-level dict's closing tag — the last `</dict>` before `</plist>`. */
function topLevelEnd(xml) {
  const plist = xml.lastIndexOf('</plist>');
  const at = plist > -1 ? xml.lastIndexOf('</dict>', plist) : -1;
  return at > -1 ? at : null;
}

/** Adds `<key>…</key>` and its value at the end of the top-level dict. */
export function plistAddKey(xml, key, valueXml) {
  const at = topLevelEnd(xml);
  if (at === null) {
    return null;
  }
  const entry = `\t<key>${key}</key>\n${valueXml.replace(/^/gm, '\t')}\n`;
  return `${xml.slice(0, at)}${entry}${xml.slice(at)}`;
}

/** The span of the `<array>` that follows a top-level `<key>`, or null. */
function arrayAfterKey(xml, key) {
  const m = new RegExp(`<key>${key}</key>\\s*<array>`).exec(xml);
  if (!m) {
    return null;
  }
  const start = m.index + m[0].length;
  const end = xml.indexOf('</array>', start);
  return end > -1 ? { start, end } : null;
}

/** The indentation the existing items of an array use, or a sensible default. */
function itemIndent(xml, span, fallback) {
  return xml.slice(span.start, span.end).match(/\n([ \t]*)</)?.[1] ?? fallback;
}

/**
 * Makes `strings` present in the array under `key`, creating the key if it is absent.
 * Existing entries are left where they are; missing ones are appended.
 */
export function plistEnsureStrings(xml, key, strings) {
  const span = arrayAfterKey(xml, key);
  if (!span) {
    if (new RegExp(`<key>${key}</key>`).test(xml)) {
      return null; // present, but not an array — not ours to reshape
    }
    return plistAddKey(
      xml,
      key,
      `<array>\n${strings.map((s) => `\t<string>${s}</string>`).join('\n')}\n</array>`
    );
  }
  const body = xml.slice(span.start, span.end);
  const missing = strings.filter(
    (s) => !body.includes(`<string>${s}</string>`)
  );
  if (missing.length === 0) {
    return xml;
  }
  const indent = itemIndent(xml, span, '\t\t');
  const closing = body.match(/\n([ \t]*)$/)?.[0] ?? '\n\t';
  const trimmed = body.replace(/\s*$/, '');
  const added = missing.map((s) => `\n${indent}<string>${s}</string>`).join('');
  return `${xml.slice(0, span.start)}${trimmed}${added}${closing}${xml.slice(span.end)}`;
}

/**
 * Adds a URL type carrying `scheme` to CFBundleURLTypes, creating the key if needed.
 * A scheme already present in any URL type is left alone.
 */
export function plistEnsureUrlScheme(xml, scheme) {
  if (xml.includes(`<string>${scheme}</string>`)) {
    return xml;
  }
  const type = `<dict>\n\t<key>CFBundleURLSchemes</key>\n\t<array>\n\t\t<string>${scheme}</string>\n\t</array>\n</dict>`;
  const span = arrayAfterKey(xml, 'CFBundleURLTypes');
  if (!span) {
    if (/<key>CFBundleURLTypes<\/key>/.test(xml)) {
      return null;
    }
    return plistAddKey(
      xml,
      'CFBundleURLTypes',
      `<array>\n${type.replace(/^/gm, '\t')}\n</array>`
    );
  }
  // The URL types array holds dicts, and `arrayAfterKey` stops at the first </array> —
  // the inner CFBundleURLSchemes one. Insert right after the opening tag instead, which
  // needs no knowledge of what follows.
  const indent = itemIndent(
    xml,
    { start: span.start, end: span.start + 200 },
    '\t\t'
  );
  const entry = `\n${type.replace(/^/gm, indent)}`;
  return `${xml.slice(0, span.start)}${entry}${xml.slice(span.start)}`;
}

/** Removes `<key>K</key>` and the one value that follows it, wherever it appears. */
export function plistRemoveKeys(xml, keys) {
  let next = xml;
  for (const key of keys) {
    next = next.replace(
      new RegExp(
        `\\n?[ \\t]*<key>${key}</key>\\s*<(string|integer|true|false)\\b[^>]*?(?:/>|>[\\s\\S]*?</\\1>)`,
        'g'
      ),
      ''
    );
  }
  return next;
}

// ---------------------------------------------------------------- entitlements

/**
 * The keychain groups in the required order — the app's own first, which is where iOS
 * writes items that name no group — followed by any the app already had.
 */
export function entitlementsWithKeychainGroups(xml, groups) {
  const fresh = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
</dict>
</plist>
`;
  const source = xml || fresh;
  const span = arrayAfterKey(source, 'keychain-access-groups');
  const existing = span
    ? [
        ...source
          .slice(span.start, span.end)
          .matchAll(/<string>([^<]*)<\/string>/g),
      ].map((m) => m[1])
    : [];
  const ordered = [...groups, ...existing.filter((g) => !groups.includes(g))];
  const array = `<array>\n${ordered.map((g) => `\t<string>${g}</string>`).join('\n')}\n</array>`;
  if (!span) {
    return plistAddKey(source, 'keychain-access-groups', array);
  }
  const keyAt = source.lastIndexOf(
    '<key>keychain-access-groups</key>',
    span.start
  );
  const lineStart = source.lastIndexOf('\n', keyAt) + 1;
  const indent = source.slice(lineStart, keyAt);
  const arrayEnd = span.end + '</array>'.length;
  const replacement = `<key>keychain-access-groups</key>\n${array.replace(/^/gm, indent).trimStart()}`;
  return `${source.slice(0, keyAt)}${replacement}${source.slice(arrayEnd)}`;
}

// ---------------------------------------------------------------- project.pbxproj

const object = (isa) =>
  new RegExp(
    `(\\w{24})\\s*(?:/\\*[^*]*\\*/)?\\s*=\\s*\\{\\s*isa\\s*=\\s*${isa};([\\s\\S]*?)\\n\\t\\t\\};`,
    'g'
  );

/** The XCBuildConfiguration ids of every application target, and those targets' ids. */
function applicationTargets(pbxproj) {
  const lists = new Map();
  for (const [, id, body] of pbxproj.matchAll(object('XCConfigurationList'))) {
    const ids = body.match(/buildConfigurations\s*=\s*\(([^)]*)\)/)?.[1] ?? '';
    lists.set(
      id,
      [...ids.matchAll(/\w{24}/g)].map((m) => m[0])
    );
  }
  const targets = [];
  for (const [, id, body] of pbxproj.matchAll(object('PBXNativeTarget'))) {
    if (
      !/productType\s*=\s*"com\.apple\.product-type\.application"/.test(body)
    ) {
      continue;
    }
    const list = body.match(/buildConfigurationList\s*=\s*(\w{24})/)?.[1];
    targets.push({ id, configs: lists.get(list) ?? [] });
  }
  return targets;
}

/** Applies `change` to the buildSettings body of each configuration id. */
function editBuildSettings(pbxproj, ids, change) {
  let next = pbxproj;
  for (const id of ids) {
    const re = new RegExp(
      `(${id}\\s*(?:/\\*[^*]*\\*/)?\\s*=\\s*\\{[\\s\\S]*?buildSettings\\s*=\\s*\\{)([\\s\\S]*?)(\\n\\t\\t\\t\\};)`
    );
    next = next.replace(
      re,
      (all, open, body, close) => `${open}${change(body)}${close}`
    );
  }
  return next;
}

/** Sets `key = value;` in a buildSettings body, replacing it or adding it. */
function setBuildSetting(body, key, value) {
  const line = new RegExp(`(\\n\\t\\t\\t\\t${key}\\s*=\\s*)[^;]*;`);
  if (line.test(body)) {
    return body.replace(line, `$1${value};`);
  }
  return `${body}\n\t\t\t\t${key} = ${value};`;
}

/**
 * Raises IPHONEOS_DEPLOYMENT_TARGET on every configuration of every application target,
 * setting it on the target rather than relying on the project level it would otherwise
 * inherit — which is what Expo's prebuild does, and what doctor reads.
 */
export function pbxprojSetDeploymentTarget(pbxproj, version, atLeast) {
  const targets = applicationTargets(pbxproj);
  if (targets.length === 0) {
    return null;
  }
  const ids = targets.flatMap((t) => t.configs);
  return editBuildSettings(pbxproj, ids, (body) => {
    const current = body.match(
      /IPHONEOS_DEPLOYMENT_TARGET\s*=\s*"?([\d.]+)"?;/
    )?.[1];
    return current && atLeast(current)
      ? body
      : setBuildSetting(body, 'IPHONEOS_DEPLOYMENT_TARGET', version);
  });
}

/** Points every application target's configurations at an entitlements file. */
export function pbxprojSetEntitlements(pbxproj, relativePath) {
  const targets = applicationTargets(pbxproj);
  if (targets.length === 0) {
    return null;
  }
  return editBuildSettings(
    pbxproj,
    targets.flatMap((t) => t.configs),
    (body) =>
      /CODE_SIGN_ENTITLEMENTS\s*=/.test(body)
        ? body
        : setBuildSetting(body, 'CODE_SIGN_ENTITLEMENTS', relativePath)
  );
}

/**
 * Adds a Run Script phase that runs Microsoft's IntuneMAMConfigurator, first in every
 * application target — before Compile Sources, so the plist and entitlements it writes
 * are in place for the build that follows.
 */
export function pbxprojAddConfiguratorPhase(
  pbxproj,
  script,
  id = newObjectId(pbxproj)
) {
  if (/IntuneMAMConfigurator/.test(pbxproj)) {
    return pbxproj;
  }
  const targets = applicationTargets(pbxproj);
  if (targets.length === 0) {
    return null;
  }
  const escaped = script
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
  const phase =
    `\t\t${id} /* Run IntuneMAMConfigurator */ = {\n` +
    '\t\t\tisa = PBXShellScriptBuildPhase;\n' +
    '\t\t\talwaysOutOfDate = 1;\n' +
    '\t\t\tbuildActionMask = 2147483647;\n' +
    '\t\t\tfiles = (\n\t\t\t);\n' +
    '\t\t\tinputPaths = (\n\t\t\t);\n' +
    '\t\t\tname = "Run IntuneMAMConfigurator";\n' +
    '\t\t\toutputPaths = (\n\t\t\t);\n' +
    '\t\t\trunOnlyForDeploymentPostprocessing = 0;\n' +
    '\t\t\tshellPath = /bin/sh;\n' +
    `\t\t\tshellScript = "${escaped}";\n` +
    '\t\t};\n';

  let next = pbxproj;
  const section = '/* Begin PBXShellScriptBuildPhase section */\n';
  if (next.includes(section)) {
    next = next.replace(section, `${section}${phase}`);
  } else {
    const anchor = '/* Begin PBXSourcesBuildPhase section */';
    if (!next.includes(anchor)) {
      return null;
    }
    next = next.replace(
      anchor,
      `${section}${phase}/* End PBXShellScriptBuildPhase section */\n\n${anchor}`
    );
  }
  for (const t of targets) {
    next = next.replace(
      new RegExp(
        `(${t.id}\\s*(?:/\\*[^*]*\\*/)?\\s*=\\s*\\{[\\s\\S]*?buildPhases\\s*=\\s*\\(\\n)`
      ),
      `$1\t\t\t\t${id} /* Run IntuneMAMConfigurator */,\n`
    );
  }
  return next;
}

/** A 24-hex-digit object id, the form Xcode uses, not already in the file. */
function newObjectId(pbxproj) {
  for (;;) {
    const id = crypto.randomBytes(12).toString('hex').toUpperCase();
    if (!pbxproj.includes(id)) {
      return id;
    }
  }
}
