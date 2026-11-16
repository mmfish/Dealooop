// Local MCP server over stdio, for any agent that runs local MCP servers
// (Claude Code, Claude Desktop, Codex, ...); see docs/CLAUDE-DESKTOP.md.
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
import {BEAN} from '../sim/demo-creators.ts';
import {registerCampaignTools, SERVER_INSTRUCTIONS} from './campaign-tools.ts';

const root = join(import.meta.dirname, '..');
// For development and tests on this machine only: whoever starts the process is the owner.
// Agents of other people connect over HTTP with their owner's approval (see /llms.txt).
const identity = {
  userId: process.env.DEALOOP_USER_ID ?? 'local-user',
  name: process.env.DEALOOP_USER_NAME ?? 'Local user',
};
const origin = process.env.DEALOOP_ORIGIN ?? 'http://localhost:3200';

// The same database file as the local web server, so the platform pages show what Claude does.
const db = new SQLiteDatabase(process.env.DEALOOP_DB_PATH ?? join(root, 'data/dealoop.sqlite'));
db.migrate(process.env.DEALOOP_MIGRATIONS_PATH ?? join(root, 'drizzle'));
const store = new CampaignStore(db.asD1());
await store.ensureUser(identity.userId, identity.name, Date.now());
// Bean's demo profile (with a labeled demo track record). Other creators set theirs with set_creator_profile.
if (identity.userId === BEAN.userId) await store.upsertCreator({...BEAN, demo: false, now: Date.now()});

const server = new McpServer({name: 'dealoop', version: '0.1.0'}, {instructions: SERVER_INSTRUCTIONS});
registerCampaignTools(server, {store, identity, origin, now: () => store.now()});
await server.connect(new StdioServerTransport());
console.error(`Dealoop MCP ready: ${identity.userId}, database ${process.env.DEALOOP_DB_PATH ?? 'data/dealoop.sqlite'}`);
