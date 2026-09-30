import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

/**
 * Grouped by what the reader is trying to do, not by what kind of file it is.
 *
 * The shape is artboard 11's — everything in a group, no bare top-level links — with the
 * groups named for this project's actual shape:
 *
 * - **Getting started** is the decision and the first build.
 * - **Platform setup** is the part autolinking cannot do, split by the platform you are on
 *   so an iOS-only reader never scrolls past Gradle.
 * - **Guides** is one page per scenario: signing in, reading an outcome, reconciling at
 *   launch, resetting. These are the questions that arrive after the build works.
 * - **Field notes** is what cost somebody a day. Separate from the guides on purpose: a
 *   trap is not a task, and burying them inside a procedure is how they get skimmed.
 * - **Reference** is the API, with the type-level part generated from the source.
 * - **Contributing** is last because it is for a different reader.
 */
const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: 'Getting started',
      collapsed: false,
      items: ['index', 'getting-started', 'doctor'],
    },
    {
      type: 'category',
      label: 'Platform setup',
      collapsed: false,
      items: ['setup/ios', 'setup/android', 'setup/expo'],
    },
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: [
        'guides/authentication',
        'guides/enrollment-outcomes',
        'guides/reconcile-at-launch',
        'guides/reset-and-wipe',
      ],
    },
    {
      type: 'category',
      label: 'Field notes',
      collapsed: false,
      items: ['notes/traps', 'troubleshooting'],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: ['api', 'versioning', 'reference/reference'],
    },
    {
      type: 'category',
      label: 'Contributing',
      collapsed: true,
      items: ['contributing/contributing', 'contributing/tenant-setup'],
    },
  ],
};

export default sidebars;
