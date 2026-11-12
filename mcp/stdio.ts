// Local MCP server for Claude Desktop (stdio). Claude Desktop starts this
// process from claude_desktop_config.json; see docs/CLAUDE-DESKTOP.md.
//
// Identity: on a local machine the person running the process is the owner,
// so the role and user come from the environment instead of OAuth. The public
// deployment uses the OAuth-protected /mcp endpoint instead (SPEC §15).
//
// stdout carries the protocol: log only to stderr.

import {join} from 'node:path';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {SQLiteDatabase} from '../runtime/sqlite.ts';
import {CampaignStore} from '../db/campaign-store.ts';
import {registerCampaignTools, SERVER_INSTRUCTIONS, type Role} from './campaign-tools.ts';

const root = join(import.meta.dirname, '..');
const role = (process.env.DEALOOP_ROLE ?? 'founder') as Role;
if (role !== 'founder' && role !== 'creator') {
  console.error(`DEALOOP_ROLE must be founder or creator, not ${role}`);
  process.exit(1);
}
const identity = {
  role,
  userId: process.env.DEALOOP_USER_ID ?? (role === 'founder' ? 'founder-demo' : 'creator-demo'),
  name: process.env.DEALOOP_USER_NAME ?? (role === 'founder' ? 'Demo founder' : 'Demo creator'),
};
const origin = process.env.DEALOOP_ORIGIN ?? 'http://localhost:3200';

// The same database file as the local web server, so the platform pages show what Claude does.
const db = new SQLiteDatabase(process.env.DEALOOP_DB_PATH ?? join(root, 'data/dealoop.sqlite'));
db.migrate(process.env.DEALOOP_MIGRATIONS_PATH ?? join(root, 'drizzle'));
const store = new CampaignStore(db.asD1());
await store.ensureUser(identity.userId, identity.name, Date.now());

const server = new McpServer({name: 'dealoop', version: '0.1.0'}, {instructions: SERVER_INSTRUCTIONS});
registerCampaignTools(server, {store, identity, origin, now: () => Date.now()});
await server.connect(new StdioServerTransport());
console.error(`Dealoop MCP ready: ${identity.role} ${identity.userId}, database ${process.env.DEALOOP_DB_PATH ?? 'data/dealoop.sqlite'}`);
