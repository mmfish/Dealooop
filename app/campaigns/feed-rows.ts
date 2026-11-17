// How the activity feed groups events. Separate from the components so it can be tested without a renderer.

import type {FeedItem, FeedTone} from '../../db/campaign-view.ts';

export type Row = {key: string; tone: FeedTone; actor: string; simulated: boolean; summary: string; at: number; label?: string};

/** Runs of these fold into one row each, so joins, questions, deals and prices stay visible. */
const FOLDED: Record<string, (n: number) => string> = {
  'conversion.recorded': n => `${n} sign-ups recorded.`,
  'conversion.verified': n => `${n} sign-ups verified.`,
};

/** Consecutive sign-ups (and consecutive verifications) fold into one row. Newest first. */
export function feedRows(items: FeedItem[]): Row[] {
  const rows: Row[] = [];
  let run: FeedItem[] = [];
  const flush = () => {
    if (!run.length) return;
    const first = run[0], last = run[run.length - 1];
    rows.push(run.length === 1
      ? {key: first.id, tone: 'signup', actor: first.actor, simulated: first.simulated, summary: first.summary, at: first.at}
      : {key: `${first.id}-${last.id}`, tone: 'signup', actor: 'platform', simulated: false, summary: FOLDED[first.kind](run.length), at: last.at});
    run = [];
  };
  for (const e of items) {
    if (FOLDED[e.kind]) {
      if (run.length && run[0].kind !== e.kind) flush();
      run.push(e);
      continue;
    }
    flush();
    rows.push({key: e.id, tone: e.tone, actor: e.actor, simulated: e.simulated, at: e.at,
      summary: e.tone === 'refused' ? e.summary.replace(/^Refused:\s*/, '') : e.summary,
      label: e.tone === 'refused' ? 'Refused by the platform' : undefined});
  }
  flush();
  return rows.reverse();
}
