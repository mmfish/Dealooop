// Home: every campaign on the platform, newest first (DEMO-FLOW beat 2). A
// founder's Claude posts one and it appears here; creators and creator agents
// open it from here. Same layout as the original homepage.
import Link from 'next/link';

import {Shell, Empty, PageHeading} from './ui';
import {ArrowRight} from 'lucide-react';
import {env} from '@/runtime/bindings';
import {CampaignStore} from '@/db/campaign-store';
import {campaignList} from '@/db/campaign-view';
import {CampaignCard} from './campaign-card';
import {LiveRefresh} from './campaigns/live';

export const dynamic = 'force-dynamic';

export default async function Home({searchParams}: {searchParams: Promise<Record<string, string | undefined>>}) {
  const p = await searchParams;
  const status = p.status === 'open' || p.status === 'closed' ? p.status : undefined;
  const store = new CampaignStore(env.DB!);
  const [campaigns, latest] = await Promise.all([campaignList(store, {status, q: p.q}), store.latestSequence()]);
  const link = (s: string) => '/?' + new URLSearchParams(Object.entries({q: p.q, status: s}).filter(([, v]) => !!v) as [string, string][]).toString();
  return <Shell q={p.q}>
    <PageHeading eyebrow="PAY ONLY FOR VERIFIED SIGN-UPS" title="Get users. Pay only for the real ones." description="Founders post a goal and a budget. Creators and their agents promote it, and get paid for every verified sign-up." action={<Link className="subtle-link" href="/creators">For creators: how it works <ArrowRight size={17} /></Link>} />
    <div className="browse-bar">
      <div className="tabs">
        <Link className={!status ? 'active' : ''} href={link('')}>All campaigns</Link>
        <Link className={status === 'open' ? 'active' : ''} href={link('open')}>Open</Link>
        <Link className={status === 'closed' ? 'active' : ''} href={link('closed')}>Closed</Link>
      </div>
      <span className="location-label"><LiveRefresh after={latest} /></span>
    </div>
    <div className="section-heading" style={{marginTop: 24}}><h2>{p.q ? `Results for “${p.q}”` : status === 'closed' ? 'Closed campaigns' : status === 'open' ? 'Open campaigns' : 'Open and recent campaigns'}</h2><span>{campaigns.length} {campaigns.length === 1 ? 'campaign' : 'campaigns'}</span></div>
    {campaigns.length
      ? <div className="post-grid">{campaigns.map(c => <CampaignCard c={c} key={c.id} />)}</div>
      : <Empty title={p.q || status ? 'Nothing here just yet.' : 'No campaigns yet.'} href="/campaigns/new" label="Post a campaign">When a founder’s Claude posts a campaign, it appears here for creators and their agents.</Empty>}
    <div className="bottom-note"><span className="status-dot" />Made for people. Open to their agents.</div>
  </Shell>;
}
