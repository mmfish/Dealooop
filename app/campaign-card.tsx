// A campaign in the homepage grid, in the same card layout the listings used.
import Link from 'next/link';

import {ArrowUpRight, Check, Megaphone, Sparkles} from 'lucide-react';
import type {CampaignListItem} from '@/db/campaign-view';

export const usd = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', {minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2});
export const usd2 = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
export const shortDate = (ms: number) => new Date(ms).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});

/** The campaign's image, or a plain placeholder when the founder gave none. */
export function CampaignCover({imageUrl, title, large}: {imageUrl: string; title: string; large?: boolean}) {
  if (imageUrl) return <img src={imageUrl} alt={title} loading={large ? undefined : 'lazy'} />;
  return large
    ? <div className="detail-placeholder"><Megaphone size={70} strokeWidth={1} /><h2>{title}</h2></div>
    : <div className="wish-art"><span><Megaphone size={44} strokeWidth={1.25} /></span><p>Paid per verified sign-up.</p><ArrowUpRight size={24} /></div>;
}

export function CampaignCard({c}: {c: CampaignListItem}) {
  const open = c.status === 'open';
  return <Link href={'/campaigns/' + c.id} className="post-card">
    <div className={'card-visual ' + (c.imageUrl ? '' : 'no-photo')}>
      <CampaignCover imageUrl={c.imageUrl} title={c.title} />
      <span className="post-tag sale">{open ? <Check size={12} /> : null} {open ? 'OPEN' : 'CLOSED'}</span>
      {c.demo && <span className="sample-tag">Demo</span>}
    </div>
    <div className="card-copy">
      <div className="card-price">{usd2(c.currentPriceCents)}<span>&nbsp;per sign-up</span><span className="card-arrow"><ArrowUpRight size={18} /></span></div>
      <h3>{c.title}</h3>
      <div className="card-meta"><span>Goal {c.goalCount}</span><span className="dot">·</span><span>{c.verified} signed up</span><span className="dot">·</span><span>{open ? 'Ends ' : 'Ended '}{shortDate(c.deadline)}</span></div>
      <div className="agent-attribution"><Sparkles size={12} />Posted by {c.ownerName}&apos;s agent</div>
    </div>
  </Link>;
}
