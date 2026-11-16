import {dealoopOpenapi} from '@/backend/dealoop-discovery';
import {agentOrigin, isAws} from '@/backend/deployment';
export function GET(request: Request){return Response.json(dealoopOpenapi(isAws()?agentOrigin():new URL(request.url).origin),{headers:{'Cache-Control':'public, max-age=60'}});}
