#!/usr/bin/env node
/**
 * Post-processes the generated API reference so its cross-references resolve.
 *
 * TypeDoc numbers an anchor when the name is already taken on the page: the property
 * `tokenRequest` claims `#tokenrequest`, so the *type* `TokenRequest` becomes
 * `#tokenrequest-1`. TypeDoc emits a real `<a id="tokenrequest-1">` for it, so the link
 * works in a browser — but Docusaurus's broken-anchor check only indexes heading ids, so
 * it reports the page as broken.
 *
 * Rather than downgrade `onBrokenAnchors` — which would also stop catching genuinely
 * broken anchors in the hand-written pages — this moves the id onto the heading itself
 * using Docusaurus's explicit-id syntax. The anchor TypeDoc links to and the id
 * Docusaurus indexes then agree.
 *
 * Also rewrites the frontmatter, because TypeDoc's own title is the module path.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const DIR = path.join(import.meta.dirname, '..', 'docs', 'reference');

const FRONTMATTER = `---
id: reference
title: API reference
sidebar_label: Types and methods
hide_table_of_contents: false
---

`;

/** A lone `<a id="x"></a>` line immediately followed by a heading. */
const ORPHAN_ANCHOR = /^<a id="([^"]+)"><\/a>\n+(#{1,6}) (.+)$/gm;

async function main() {
  let files;
  try {
    files = await fs.readdir(DIR);
  } catch {
    console.error(`No generated reference at ${DIR}. Did typedoc run?`);
    process.exit(1);
  }

  let moved = 0;
  for (const name of files.filter((f) => f.endsWith('.md'))) {
    const file = path.join(DIR, name);
    let text = await fs.readFile(file, 'utf8');

    text = text.replace(ORPHAN_ANCHOR, (_match, id, hashes, heading) => {
      moved += 1;
      // Keep the anchor too: it costs nothing and any link already pointing at it in a
      // published page keeps working.
      return `<a id="${id}"></a>\n\n${hashes} ${heading} \\{#${id}\\}`.replace(
        /\\\{#/,
        '{#'
      ).replace(/\\\}$/, '}');
    });

    // TypeDoc writes its own title and no frontmatter; replace both with ours.
    text = text.replace(/^---\n[\s\S]*?\n---\n\n?/, '');
    // TypeDoc's own H1 is the package name, which the frontmatter title already says.
    text = text.replace(/^# .*\n+/, '');
    text = FRONTMATTER + text;

    // With one entry point TypeDoc names the file after the module — README.md — which
    // Docusaurus would turn into the document id `reference/README`. The page is the API
    // reference, so it is named for that.
    const target = path.join(DIR, 'index.md');
    await fs.writeFile(target, text);
    if (file !== target) {
      await fs.rm(file);
      console.log(`api reference: ${name} -> index.md`);
    }
  }

  console.log(`api reference: ${moved} anchors moved onto their headings`);
}

await main();
