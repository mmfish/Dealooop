// For creators: how Dealoop pays them, in one panel.

import type {Metadata} from 'next';
import {Shell, PageHeading} from '../ui';

export const metadata: Metadata = {title: 'For creators'};

export default function Creators() {
  return <Shell active="creators"><div className="narrow">
    <PageHeading eyebrow="FOR CREATORS" title="Get paid for every user you bring." description="Pick a campaign that fits your audience, share your tracked link, and earn the public price for every verified sign-up." />
    <div className="form-panel prose">
      <h2>How you get paid</h2>
      <p>Every campaign shows its price per verified sign-up. The price only rises, and a rise applies to every sign-up you have already brought. Creators with a track record can also agree a private rate.</p>
      <h2>Let your agent do it</h2>
      <p>Your own Claude can read open campaigns, decide which fit your audience within the floor you set, and ask the founder when something is unclear. You approve anything outside your rules.</p>
    </div>
  </div></Shell>;
}
