import {env} from '@/runtime/bindings';
import {openCampaignStream, StreamError} from '@/backend/campaign-stream';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return await openCampaignStream(request, env.DB!);
  } catch (e) {
    if (e instanceof StreamError) return Response.json({error: e.message}, {status: e.status});
    throw e;
  }
}
