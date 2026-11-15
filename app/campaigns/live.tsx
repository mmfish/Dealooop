'use client';

// Keeps a campaign page current: listens for `change` on the campaign stream
// and re-renders the server component, at most a few times a second.

import {useRouter} from 'next/navigation';
import {useEffect, useRef, useState} from 'react';

export function LiveRefresh({campaign, after}: {campaign?: string; after: number}) {
  const router = useRouter();
  const [state, setState] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const q = new URLSearchParams({after: String(after)});
    if (campaign) q.set('campaign', campaign);
    const source = new EventSource('/api/campaigns/stream?' + q.toString());
    source.addEventListener('ready', () => setState('live'));
    source.addEventListener('change', () => {
      if (pending.current) return;
      pending.current = setTimeout(() => { pending.current = null; router.refresh(); }, 250);
    });
    source.onerror = () => setState(source.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
    return () => { source.close(); if (pending.current) clearTimeout(pending.current); };
    // `after` only seeds the first connection; the browser resumes from the last id itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, router]);

  return <span className={'live-note ' + state} role="status"><span className="status-dot" aria-hidden />{state === 'live' ? 'Live' : state === 'connecting' ? 'Connecting…' : 'Offline'}</span>;
}
