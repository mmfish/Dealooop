// Dealoop's campaign tools over HTTP, for any agent that only knows the site's
// address (see /llms.txt).
//
// The tools are defined once (mcp/campaign-tools.ts and mcp/deal-tools.ts) and
// served two ways, both for the owner behind the bearer token:
//   GET  /api/v1/tools          list every tool with its input schema (public)
//   POST /api/v1/tools/<name>   call one with a JSON object of arguments
//   POST /api/v1/mcp            the same tools as a Streamable HTTP MCP server
// The token comes from the pairing flow (POST /api/v1/agent-connections, the
// owner approves at /connect, then POST /api/v1/agent-token). The platform
// takes the owner from the token, never from the request.

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {CampaignStore} from '../db/campaign-store.ts';
import {registerCampaignTools, SERVER_INSTRUCTIONS, type Identity, type ToolContext} from '../mcp/campaign-tools.ts';
import type {Actor} from './contracts.ts';

type Handler = (args: Record<string, unknown>) => Promise<{structuredContent: Record<string, unknown>; isError?: boolean}>;
interface ToolDef {name: string; description: string; shape: z.ZodRawShape; readOnly: boolean; handler: Handler}

/** Collects the tool definitions by giving the registration code a stand-in server. */
function collect(ctx: ToolContext): Map<string, ToolDef> {
  const tools = new Map<string, ToolDef>();
  const registrar = {
    registerTool(name: string, config: {description?: string; inputSchema?: z.ZodRawShape; annotations?: {readOnlyHint?: boolean}}, handler: Handler) {
      tools.set(name, {name, description: config.description ?? '', shape: config.inputSchema ?? {}, readOnly: !!config.annotations?.readOnlyHint, handler});
    },
  };
  registerCampaignTools(registrar as unknown as McpServer, ctx);
  return tools;
}

/** The tool list, the same for everyone; descriptions do not depend on who asks. */
export function toolList(store: CampaignStore, origin: string) {
  const tools = collect({store, identity: {userId: '', name: ''}, origin, now: () => store.now()});
  return [...tools.values()].map(t => ({
    name: t.name,
    description: t.description,
    read_only: t.readOnly,
    call: {method: 'POST', path: `/api/v1/tools/${t.name}`},
    input_schema: zodToJsonSchema(z.object(t.shape), {$refStrategy: 'none'}),
  }));
}

/** The owner behind a token: their account id and their own name (not the agent's). */
export async function ownerOf(actor: Actor, db: D1Database): Promise<Identity> {
  const row = await db.prepare('SELECT name FROM users WHERE id=?').bind(actor.ownerId).first<{name: string}>();
  return {userId: actor.ownerId, name: row?.name ?? actor.ownerId};
}

export class ToolCallError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

/** Calls one tool for `identity`. Arguments are validated against the tool's schema first. */
export async function callTool(db: D1Database, identity: Identity, origin: string, name: string, args: Record<string, unknown>) {
  const store = new CampaignStore(db);
  const tools = collect({store, identity, origin, now: () => store.now()});
  const tool = tools.get(name);
  if (!tool) throw new ToolCallError(404, 'unknown_tool', `No tool named ${name}. GET /api/v1/tools lists them.`);
  const parsed = z.object(tool.shape).strict().safeParse(args);
  if (!parsed.success) throw new ToolCallError(400, 'invalid_arguments', 'The arguments do not match the tool\'s input_schema.', parsed.error.issues.map(i => ({path: i.path.join('.'), message: i.message})));
  await store.ensureUser(identity.userId, identity.name, Date.now());
  const r = await tool.handler(parsed.data);
  return {ok: !r.isError, result: r.structuredContent};
}

/** The same tools as a stateless Streamable HTTP MCP server, for the owner behind the token. */
export async function campaignMcp(req: Request, db: D1Database, identity: Identity, origin: string, parsedBody: unknown): Promise<Response> {
  const store = new CampaignStore(db);
  await store.ensureUser(identity.userId, identity.name, Date.now());
  const server = new McpServer({name: 'dealoop', version: '1.0.0', websiteUrl: origin}, {instructions: SERVER_INSTRUCTIONS});
  registerCampaignTools(server, {store, identity, origin, now: () => store.now()});
  const transport = new WebStandardStreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(req, {parsedBody});
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } finally {
    await server.close();
  }
}
