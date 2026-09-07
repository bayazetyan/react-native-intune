import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

/**
 * The organisation and repository name, in one place. `baseUrl` has to match the
 * repository name for a GitHub Pages project site, and getting it wrong produces a site
 * whose CSS and links 404 while the HTML loads fine — which reads as a broken theme
 * rather than a wrong path.
 */
const ORG = 'bayazetyan';
const REPO = 'react-native-intune';
// Read from the package rather than restated, so the badge cannot drift from what is
// published.
const VERSION = require('../package.json').version;

const config: Config = {
  title: 'react-native-intune',
  tagline: 'Microsoft Intune app protection for React Native',
  favicon: 'img/favicon.svg',

  future: { v4: true },

  url: `https://${ORG}.github.io`,
  baseUrl: `/${REPO}/`,

  organizationName: ORG,
  projectName: REPO,
  trailingSlash: false,

  // Fail the build rather than publish a site with dead internal links. This is the whole
  // reason to have a docs site instead of one long README: the cross-references have to
  // stay honest, and only the build can check that.
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: {
    hooks: { onBrokenMarkdownLinks: 'throw' },
    // `.md` as CommonMark, `.mdx` as MDX. The generated API reference is full of type
    // literals — `{ accountId: string }` — and under MDX every one of those braces is
    // parsed as a JSX expression, which is what broke the build. Hand-written pages that
    // embed components are `.mdx` and are unaffected.
    format: 'detect',
  },

  i18n: { defaultLocale: 'en', locales: ['en'] },

  stylesheets: [
    'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap',
  ],

  themes: [
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: '/docs',
        highlightSearchTermsOnTargetPage: true,
        // The integration steps are full of exact symbols — MAMApplication,
        // ADALCacheKeychainGroupOverride, notLicensed — and those are what people search
        // for, so the tokeniser has to keep them whole rather than split on case.
        explicitSearchResultPath: true,
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: `https://github.com/${ORG}/${REPO}/tree/main/website/`,
          // Documentation for a library whose integration steps are this long is worth
          // reading in order, so the previous/next links matter more than usual.
          showLastUpdateTime: true,
        },
        // No blog. This site documents a library; a blog would be an empty section
        // advertising that nothing has happened.
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
    navbar: {
      title: 'react-native-intune',
      logo: {
        alt: 'react-native-intune',
        src: 'img/logo.svg',
        // The accent at full strength is unreadable as 1.8px of line work on a dark
        // ground, so the dark variant steps it up the ramp.
        srcDark: 'img/logo-dark.svg',
      },
      // Sides as the artboard draws them: the version badge sits beside the wordmark on
      // the left, and every navigation item is on the right, ahead of the search box.
      items: [
        {
          type: 'html',
          position: 'left',
          // Static for now: there is one released line, and a version dropdown offering
          // one version is furniture. Read from package.json so it cannot drift.
          value: `<span class="navbar__version">v${VERSION}</span>`,
        },
        { type: 'docSidebar', sidebarId: 'docs', position: 'right', label: 'Docs' },
        { to: '/docs/api', label: 'API', position: 'right' },
        { to: '/docs/guides/authentication', label: 'Guides', position: 'right' },
        {
          href: `https://github.com/${ORG}/${REPO}`,
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'light',
      links: [
        {
          title: 'Documentation',
          items: [
            { label: 'Getting started', to: '/docs/getting-started' },
            { label: 'iOS setup', to: '/docs/setup/ios' },
            { label: 'Android setup', to: '/docs/setup/android' },
            { label: 'API reference', to: '/docs/api' },
          ],
        },
        {
          title: 'Project',
          items: [
            { label: 'GitHub', href: `https://github.com/${ORG}/${REPO}` },
            {
              label: 'Issues',
              href: `https://github.com/${ORG}/${REPO}/issues`,
            },
            {
              label: 'Licence and attribution',
              href: `https://github.com/${ORG}/${REPO}/blob/main/NOTICE`,
            },
          ],
        },
      ],
      // Required, not decorative: this library is not a Microsoft product and the
      // documentation has to say so where anyone can see it.
      copyright:
        'Not affiliated with, endorsed by, or sponsored by Microsoft. ' +
        'Microsoft, Intune and Entra are trademarks of the Microsoft group of companies. ' +
        'The Microsoft Intune App SDK is not included in this project and is licensed ' +
        'separately by Microsoft.',
    },
    prism: {
      // Dark in both themes, because the artboard draws the code block on #14181F on a
      // light page. It is the one element that is deliberately not theme-aware: code is
      // the thing a reader copies, and a block that changes ground with the page reads as
      // a different kind of element in each.
      theme: prismThemes.vsDark,
      darkTheme: prismThemes.vsDark,
      additionalLanguages: ['bash', 'json', 'groovy', 'kotlin', 'objectivec', 'swift'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
