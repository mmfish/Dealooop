// The campaign's cartoon picture (backend/campaign-art.ts), drawn from the app's name and description.
import {env} from '@/runtime/bindings';
import {CampaignStore} from '@/db/campaign-store';
import {campaignArt} from '@/backend/campaign-art';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, {params}: {params: Promise<{id: string}>}) {
  const s = await new CampaignStore(env.DB!).load((await params).id);
  if (!s) return new Response('Not found', {status: 404});
  return new Response(campaignArt(s.meta.title, s.meta.productDescription || s.meta.brief), {
    headers: {'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'"},
  });
}
