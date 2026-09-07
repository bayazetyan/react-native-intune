import CodeBlock from '@theme/CodeBlock';
import Link from '@docusaurus/Link';
import type { ReactNode } from 'react';

import { OneBranch } from './OneBranch';

/**
 * The two blocks the landing page keeps beyond artboards 3 and 4.
 *
 * Kept short on purpose. Nobody reads a long landing page for a native module — they want
 * to see what the code looks like and then get to the setup guide, and everything else
 * belongs in the documentation where it can be found when it is needed. Anything that
 * grows here should be a docs page instead.
 */

const SAMPLE = `import Intune, { EnrollmentStatus } from 'react-native-intune';

await Intune.configure({
  clientId: cfg.aadClientId,
  tenantId: cfg.aadTenantId,
  authority: cfg.aadAuthority,
  redirectUri: cfg.aadRedirectUri,
});

const { enrollment } = await Intune.signInAndEnroll();

// Only 'failed' means block. 'notLicensed' and 'notTargeted' are legitimate
// employees whose app simply runs unmanaged.
if (enrollment.status === EnrollmentStatus.Failed) {
  blockCorporateData();
}`;

export function LandingCode(): ReactNode {
  return (
    <section className="landing-section">
      <div className="landing-section__inner">
        <div className="landing-section__head">
          <div className="landing-eyebrow">What it looks like</div>
          <h2>A small API, and one branch that matters</h2>
        </div>
        <div className="landing-code">
          <div>
            <CodeBlock language="ts" title="app/startup.ts">
              {SAMPLE}
            </CodeBlock>
            <Link to="/docs/api">The full API reference →</Link>
          </div>
          <figure className="landing-code__figure">
            <OneBranch />
            <figcaption>
              The branch in the sample. <Link to="/docs/guides/enrollment-outcomes">All
              eleven outcomes →</Link>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}

export function LandingClosing(): ReactNode {
  return (
    <section className="landing-closing">
      <div className="landing-section__inner">
        <h2>Integration is most of the work</h2>
        <p>
          Installing the package takes a minute. Wiring it into your project takes about an
          hour — and the guides say which steps fail silently, so you do not find out on a
          device.
        </p>
        <div className="landing-closing__actions">
          <Link className="landing-btn landing-btn--primary" to="/docs/getting-started">
            Get started
          </Link>
          <Link className="landing-btn" to="/docs/setup/expo">
            Using Expo?
          </Link>
        </div>
      </div>
    </section>
  );
}
