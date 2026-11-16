// The agent guide: what an agent reads when its owner only gives it Dealoop's address.
import {dealoopGuide} from '@/backend/dealoop-discovery';
import {agentOrigin, isAws} from '@/backend/deployment';
export function GET(request: Request){const origin=isAws()?agentOrigin():new URL(request.url).origin;return new Response(dealoopGuide(origin),{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public, max-age=60','Link':'</openapi.json>; rel="service-desc"; type="application/json", </api/v1/tools>; rel="service"; type="application/json"'}});}
