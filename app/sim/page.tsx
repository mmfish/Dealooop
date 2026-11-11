import type {Metadata} from 'next';
import {loadDashboard} from '@/sim/dashboard-data';
import {Dashboard} from './dashboard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {title: 'Act 1 · Campaign simulator'};

export default async function SimPage({searchParams}: {searchParams: Promise<{run?: string; seed?: string}>}) {
  const params = await searchParams;
  const data = await loadDashboard({run: typeof params.run === 'string' ? params.run : undefined, seed: typeof params.seed === 'string' ? params.seed : undefined});
  return <Dashboard data={data} />;
}
