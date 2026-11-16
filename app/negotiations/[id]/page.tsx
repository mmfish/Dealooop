// One negotiation, for its two parties only: the page opens with a party's
// private key (each agent gets its owner's link from read_negotiation). Read
// only: the agents negotiate; their owners watch here and talk to their agents.
import Link from 'next/link';

import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {env} from '@/runtime/bindings';
import {CampaignStore} from '@/db/campaign-store';
import {campaignClock} from '@/db/campaign-view';
import {Shell} from '../../ui';
import {usd2} from '../../campaign-card';
import {AutoRefresh} from '../auto-refresh';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {title: 'Negotiation', robots: {index: false}};

type Props = {params: Promise<{id: string}>; searchParams: Promise<{key?: string}>};

const ACTION: Record<string, string> = {propose: 'Proposed', message: 'Message', accept: 'Accepted', reject: 'Ended the negotiation'};

export default async function NegotiationPage({params, searchParams}: Props) {
  const [{id}, {key}] = await Promise.all([params, searchParams]);
  const store = new CampaignStore(env.DB!);
  const found = key ? await store.negotiationByKey(key) : null;
  if (!found || found.stored.negotiation.id !== id) notFound();
  const {stored, side} = found;
  const n = stored.negotiation;
  const campaign = await store.require(stored.campaignId);
  const creator = await store.creator(stored.creatorId);
  const owner = await store.db.prepare('SELECT name FROM users WHERE id=?').bind(campaign.meta.ownerId).first<{name: string}>();
  const founderName = owner?.name ?? campaign.meta.ownerId;
  const creatorName = creator?.handle ?? stored.creatorId;
  const nameOf = (s: 'creator' | 'founder') => s === 'creator' ? `${creatorName}'s agent` : `${founderName}'s agent`;
  const start = campaign.book.campaign.createdAt;

  return <Shell>
    <Link className="back-link" href={`/campaigns/${stored.campaignId}`}>Back to the campaign</Link>
    <div className="conversation-heading">
      <div>
        <div className="post-tag inline sale">PRIVATE · VISIBLE TO {side === 'creator' ? creatorName.toUpperCase() : founderName.toUpperCase()} AND THE OTHER PARTY ONLY</div>
        <h1>{campaign.meta.title}: {creatorName} and {founderName}</h1>
        <p>The agents negotiate on their owners&apos; behalf. This page shows the conversation as the platform recorded it.</p>
      </div>
    </div>
    {n.status === 'agreed' && n.agreed && <div className="deal-banner"><strong>Deal: {usd2(n.agreed.priceCents)} per sign-up</strong><p>For {creatorName}&apos;s next {n.agreed.volumeCap} verified sign-ups.</p></div>}
    <div className="conversation-grid">
      <section className="conversation-panel">
        <h2 className="section-heading">Conversation</h2>
        <div className="message-list">
          {n.history.length === 0 && <p className="conversation-empty">No moves yet.</p>}
          {n.history.map(t => <div key={t.seq} className={'message-bubble' + (t.side === side ? ' mine' : '')}>
            <strong>{nameOf(t.side)} · {ACTION[t.action] ?? t.action}{t.terms ? `: ${usd2(t.terms.priceCents)} per sign-up for ${t.terms.volumeCap}` : ''}</strong>
            <p>{t.message}</p>
            <small>{campaignClock(t.at, start)}</small>
          </div>)}
        </div>
      </section>
      <aside className="terms-panel">
        <div className="post-tag inline sale">{n.status === 'open' ? `OPEN · ${n.turn === side ? 'YOUR AGENT\'S TURN' : 'WAITING FOR THE OTHER AGENT'}` : n.status === 'agreed' ? 'AGREED' : 'ENDED WITHOUT A DEAL'}</div>
        <h2>{n.agreed ? usd2(n.agreed.priceCents) : n.onTable ? usd2(n.onTable.priceCents) : '—'}</h2>
        <p className="terms-item">{n.agreed ? `agreed, for ${n.agreed.volumeCap} sign-ups` : n.onTable ? `on the table from ${nameOf(n.proposedBy!)}, for ${n.onTable.volumeCap} sign-ups` : 'no terms on the table'}</p>
        <dl>
          <dt>Creator</dt><dd>{creatorName}{creator ? ` · ${creator.platform}, ${creator.followers.toLocaleString('en-US')} followers` : ''}</dd>
          <dt>Track record</dt><dd>{n.creatorVerifiedTotal} verified sign-ups</dd>
          <dt>Public price</dt><dd>{usd2(campaign.book.campaign.currentPriceCents)} per sign-up</dd>
          <dt>Most per sign-up</dt><dd>{usd2(campaign.book.campaign.maxCacCents)}</dd>
          <dt>Moves</dt><dd>{n.history.length}</dd>
        </dl>
      </aside>
    </div>
    {n.status === 'open' && <AutoRefresh seconds={4} />}
  </Shell>;
}
