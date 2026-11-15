// How the activity feed groups events. Separate from the components so it can be tested without a renderer.

import type {FeedItem, FeedTone} from '../../db/campaign-view.ts';

export type Row = {key: string; tone: FeedTone; actor: string; simulated: boolean; summary: string; at: number; label?: string};

/** Consecutive sign-ups fold into one row, so joins, questions and prices stay visible. Newest first. */
export function feedRows(items: FeedItem[]): Row[] {
  const rows: Row[] = [];
  let run: FeedItem[] = [];
  const flush = () => {
    if (!run.length) return;
    const first = run[0], last = run[run.length - 1];
    rows.push(run.length === 1
      ? {key: String(first.sequence), tone: 'signup', actor: first.actor, simulated: first.simulated, summary: first.summary, at: first.at}
      : {key: `${first.sequence}-${last.sequence}`, tone: 'signup', actor: 'platform', simulated: false, summary: `${run.length} sign-ups recorded.`, at: last.at});
    run = [];
  };
  for (const e of items) {
    if (e.kind === 'conversion.recorded') { run.push(e); continue; }
    flush();
    rows.push({key: String(e.sequence), tone: e.tone, actor: e.actor, simulated: e.simulated, at: e.at,
      summary: e.tone === 'refused' ? e.summary.replace(/^Refused:\s*/, '') : e.summary,
      label: e.tone === 'refused' ? 'Refused by the platform' : undefined});
  }
  flush();
  return rows.reverse();
}
