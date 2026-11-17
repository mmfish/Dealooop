// A creator's tracked link: the page a prospective user lands on from that creator's post.
// It stands in for the app's own sign-up page; a sign-up here counts for that creator.
import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {env} from '@/runtime/bindings';
import {CampaignStore} from '@/db/campaign-store';
import {Shell} from '../../ui';
import {CampaignCover} from '../../campaign-card';
import {SignUpForm} from './signup-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {title: 'Sign up', robots: {index: false}};

export default async function TrackedLink({params}: {params: Promise<{token: string}>}) {
  const {token} = await params;
  const store = new CampaignStore(env.DB!);
  const link = /^t_[a-f0-9]{32}$/.test(token) ? await store.linkByToken(token) : null;
  if (!link) notFound();
  const s = (await store.load(link.campaignId))!;
  const creator = await store.creator(link.creatorId);
  const open = s.book.campaign.status === 'open' && (await store.now()) < s.book.campaign.deadline;
  return <Shell>
    <div className="detail-grid">
      <div className={'detail-photo ' + (s.meta.imageUrl ? '' : 'wanted-photo')}><CampaignCover imageUrl={s.meta.imageUrl} title={s.meta.title} large /></div>
      <section className="detail-info">
        <div className="post-tag inline sale">RECOMMENDED BY {(creator?.handle ?? 'A CREATOR').toUpperCase()}</div>
        <h1>{s.meta.title}</h1>
        {s.meta.productDescription && <p className="description">{s.meta.productDescription}</p>}
        <hr />
        {open ? <SignUpForm token={token} title={s.meta.title} /> : <p className="quiet-note">This campaign has ended.</p>}
        <p className="quiet-note" style={{marginTop: 16}}>Demo page: it stands in for {s.meta.title}&apos;s own sign-up page. A sign-up here counts for {creator?.handle ?? 'this creator'} once it is verified.</p>
      </section>
    </div>
  </Shell>;
}
