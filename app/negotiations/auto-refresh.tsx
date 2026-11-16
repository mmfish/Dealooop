'use client';

// Re-renders the page every few seconds, so a party watching a negotiation sees the agents' moves arrive.

import {useRouter} from 'next/navigation';
import {useEffect} from 'react';

export function AutoRefresh({seconds}: {seconds: number}) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
