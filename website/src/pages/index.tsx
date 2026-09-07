import Layout from '@theme/Layout';
import type { ReactNode } from 'react';

import { LandingFeatures, LandingHero } from '@site/src/components/Landing';
import { LandingClosing, LandingCode } from '@site/src/components/LandingSections';

/** Four blocks. Everything else is a documentation page. */
export default function Home(): ReactNode {
  return (
    <Layout
      wrapperClassName="landing"
      title="Microsoft Intune app protection for React Native"
      description="App Protection Policies on iOS and Android — PIN, copy-paste restrictions, conditional launch and remote wipe — on the employee's own unmanaged phone."
    >
      <LandingHero />
      <LandingFeatures />
      <LandingCode />
      <LandingClosing />
    </Layout>
  );
}
