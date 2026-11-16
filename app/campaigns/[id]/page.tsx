// One campaign (DEMO-FLOW beats 2–5 and 7), in the layout the listing pages
// used: the cover and the basics first; once a creator has joined, a "Live
// results" tab (cost per sign-up so far, and who brought how many users) and
// an "Activity" tab. Public and read-only; it updates live.
import Link from 'next/link';

import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {Ban, Calendar, Check, Handshake, Megaphone, MessageCircleQuestion, Receipt, ShieldCheck, Target, TrendingUp, UserCheck, UserPlus, UserX, Wallet, type LucideIcon} from 'lucide-react';
import {env} from '@/runtime/bindings';
import {CampaignStore} from '@/db/campaign-store';
import {campaignClock, campaignDay, campaignView, DAY_MS, type CampaignView, type FeedTone} from '@/db/campaign-view';
import {Shell, Back} from '../../ui';
import {CampaignCover, shortDate, usd, usd2} from '../../campaign-card';
import {LiveRefresh} from '../live';
import {feedRows} from '../feed-rows';

export const dynamic = 'force-dynamic';

type Props = {params: Promise<{id: string}>; searchParams: Promise<{tab?: string}>};

export async function generateMetadata({params}: Props): Promise<Metadata> {
  const v = await campaignView(new CampaignStore(env.DB!), (await params).id, {feedLimit: 1});
  return {title: v ? v.title : 'Campaign'};
}

export default async function CampaignPage({params, searchParams}: Props) {
  const [{id}, {tab}] = await Promise.all([params, searchParams]);
  const v = await campaignView(new CampaignStore(env.DB!), id);
  if (!v) notFound();
  const open = v.status === 'open';
  const showTabs = v.creators.length > 0;
  const current = tab === 'activity' ? 'activity' : 'results';
  return <Shell>
    <Back />
    {v.results && <div className="success-banner"><Check size={18} />Campaign closed: {v.results.verified} verified sign-ups, {usd(v.results.paidCents)} paid{v.results.averageCents !== null ? ` (${usd2(v.results.averageCents)} each)` : ''}. At a fixed {usd2(v.maxCacCents)}, the same budget buys at most {v.results.fixedAtMaxCount}.</div>}
    <div className="detail-grid">
      <div className={'detail-photo ' + (v.imageUrl ? '' : 'wanted-photo')}>
        <CampaignCover imageUrl={v.imageUrl} title={v.title} large />
        {v.demo && <span className="detail-sample">Demo campaign · simulated creators</span>}
      </div>
      <section className="detail-info">
        <div className="post-tag inline sale">{open ? 'OPEN · PAY PER VERIFIED SIGN-UP' : 'CLOSED'}</div>
        <h1>{v.title}</h1>
        <p className="detail-price">{usd2(v.currentPriceCents)} <span>per verified sign-up{open ? ' now' : ''}</span></p>
        <div className="detail-meta">
          <span><Target size={17} />Goal {v.goalCount} sign-ups</span>
          <span><Wallet size={17} />Budget {usd(v.budgetCents)}, up to {usd2(v.maxCacCents)} each</span>
          <span><Calendar size={17} />{shortDate(v.createdAt)} – {shortDate(v.deadline)}{open ? ` · ${campaignDay(v.now, v.createdAt, v.deadline)}, ${timeLeft(v)}` : ''}</span>
        </div>
        <hr />
        <h2>What the founder is asking for</h2>
        <p className="description">{v.brief}</p>
        {v.productUrl && <p className="description"><a className="subtle-link" href={v.productUrl} target="_blank" rel="noreferrer">Visit {v.title} ↗</a></p>}
        <div className="owner-box">
          <span className="avatar">{v.ownerName.slice(0, 1).toUpperCase()}</span>
          <div><strong>{v.ownerName}</strong><span>Posted by their agent · {shortDate(v.createdAt)}</span></div>
        </div>
        <p className="quiet-note">The price starts low and rises only when the platform approves; every rise applies to earlier sign-ups too. Creators are paid only for verified sign-ups.</p>
      </section>
    </div>

    <section className="campaign-section" aria-label="Campaign progress">
      <div className="browse-bar">
        <div className="tabs">
          {showTabs
            ? <><Link className={current === 'results' ? 'active' : ''} href={`/campaigns/${v.id}`}>Live results</Link><Link className={current === 'activity' ? 'active' : ''} href={`/campaigns/${v.id}?tab=activity`}>Activity</Link></>
            : <Link className="active" href={`/campaigns/${v.id}`}>Creators</Link>}
        </div>
        <span className="location-label"><LiveRefresh campaign={v.id} after={v.lastSequence} /></span>
      </div>
      {!showTabs ? <p className="quiet-note">No creator has joined yet. Creator agents can find this campaign on the homepage.</p>
        : current === 'results' ? <Results v={v} /> : <Activity v={v} />}
    </section>
  </Shell>;
}

function timeLeft(v: CampaignView) {
  // Whole days, rounded as the agents are told (deal-tools days_left), so the page and both windows agree.
  const left = v.deadline - v.now;
  if (left <= 0) return 'deadline passed';
  const days = Math.round(left / DAY_MS);
  return days >= 2 ? `${days} days left` : days === 1 ? '1 day left' : 'last day';
}

function Results({v}: {v: CampaignView}) {
  const users = v.signUps.verified + v.signUps.pending;
  const joined = v.creators.filter(c => c.status === 'joined');
  const top = Math.max(1, ...joined.map(c => c.signUps));
  const closed = v.status === 'closed';
  return <>
    <dl className="campaign-stats">
      <div><dt>{closed ? 'FINAL CAC' : 'LIVE CAC'}</dt><dd>{v.liveCacCents === null ? '—' : usd2(v.liveCacCents)}</dd><small>average cost per sign-up · max {usd2(v.maxCacCents)}</small></div>
      <div><dt>REGISTERED USERS</dt><dd>{closed ? v.signUps.verified : users}</dd><small>{closed ? `verified, of ${v.goalCount} goal` : `${v.signUps.verified} verified · ${v.signUps.pending} pending · goal ${v.goalCount}`}</small></div>
      <div><dt>CREATORS</dt><dd>{v.joinedCount}</dd><small>joined{v.askingCount ? ` · ${v.askingCount} waiting on a question` : ''}{v.declinedCount ? ` · ${v.declinedCount} declined` : ''}</small></div>
    </dl>
    <table className="docs-table creator-table">
      <thead><tr><th scope="col">Creator</th><th scope="col">Users brought in</th><th scope="col" className="num">Users</th><th scope="col" className="num">Verified</th><th scope="col" className="num">{closed ? 'Paid' : 'Earned so far'}</th></tr></thead>
      <tbody>{v.creators.filter(c => c.status !== 'declined').map(c => <tr key={c.userId}>
        <td>
          <div className="creator-name">{c.handle} {c.simulated && <span className="connection-status">simulated</span>}</div>
          <div className="creator-sub">{c.status === 'declined' ? `Declined${c.note ? `: ${c.note}` : ''}` : c.status === 'asking' ? `Asked the founder: “${c.note}” · waiting for an answer` : c.status === 'negotiating' ? 'Negotiating with the founder' : [c.platform, c.niche].filter(Boolean).join(' · ')}{c.deal ? ` · private deal, at least ${usd2(c.deal.priceCents)} for the next ${c.deal.volumeCap}` : ''}</div>
        </td>
        <td>{c.status === 'joined' && <div className="share-bar" aria-hidden><span style={{width: `${(c.signUps / top) * 100}%`}} /></div>}</td>
        <td className="num">{c.status === 'joined' ? c.signUps : '—'}</td>
        <td className="num">{c.status === 'joined' ? c.verified : '—'}</td>
        <td className="num">{c.status === 'joined' ? usd(c.earnedCents) : '—'}</td>
      </tr>)}</tbody>
    </table>
    {v.declinedCount > 0 && <p className="quiet-note" style={{marginTop: 16}}>{v.declinedCount} {v.declinedCount === 1 ? 'creator' : 'creators'} declined, with their reasons in <Link href={`/campaigns/${v.id}?tab=activity`}>Activity</Link>.</p>}
  </>;
}

const ICONS: Record<FeedTone, LucideIcon> = {
  posted: Megaphone, joined: UserPlus, declined: UserX, question: MessageCircleQuestion, approval: ShieldCheck,
  signup: UserCheck, price: TrendingUp, deal: Handshake, refused: Ban, settled: Receipt, other: Check,
};

function Activity({v}: {v: CampaignView}) {
  const rows = feedRows(v.feed);
  return <div className="timeline">{rows.map(r => {
    const Icon = ICONS[r.tone];
    return <article key={r.key} className={r.tone === 'refused' ? 'refused-event' : undefined}>
      <span className="timeline-icon"><Icon size={19} /></span>
      <div>
        <span className="event-actor">{r.actor}{r.simulated ? ' · simulated' : ''}</span>
        <h3>{r.label ? `${r.label}: ` : ''}{r.summary}</h3>
        <time dateTime={new Date(r.at).toISOString()}>{campaignClock(r.at, v.createdAt)}</time>
      </div>
    </article>;
  })}</div>;
}
