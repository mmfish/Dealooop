// npm run mcp:config -- [--role founder|creator] [--user summer] [--name "Summer"] [--install]
//
// Prints the Claude Desktop config entry that starts this repository's local
// MCP server. With --install it merges the entry into
// ~/Library/Application Support/Claude/claude_desktop_config.json, keeping a
// backup of the previous file and leaving every other setting untouched.
// Quit and reopen Claude Desktop afterwards.

import {copyFileSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const role = flag('role', 'founder');
if (role !== 'founder' && role !== 'creator') throw new Error('--role must be founder or creator');
const user = flag('user', role === 'founder' ? 'founder-demo' : 'creator-demo');
const name = flag('name', role === 'founder' ? 'Demo founder' : 'Demo creator');
const root = join(import.meta.dirname, '..');

const key = `dealoop-${role}`;
const entry = {
  // An absolute node path: Claude Desktop does not load your shell, so nvm's PATH is not there.
  command: process.execPath,
  args: ['--experimental-transform-types', '--no-warnings', join(root, 'mcp/stdio.ts')],
  env: {DEALOOP_ROLE: role, DEALOOP_USER_ID: user, DEALOOP_USER_NAME: name, DEALOOP_ORIGIN: 'http://localhost:3200'},
};

if (!args.includes('--install')) {
  console.log(JSON.stringify({mcpServers: {[key]: entry}}, null, 2));
  console.log('\nAdd this under "mcpServers" in Claude Desktop\'s config, or rerun with --install.');
  process.exit(0);
}

const file = join(homedir(), 'Library/Application Support/Claude/claude_desktop_config.json');
const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> : {};
if (existsSync(file)) {
  const backup = `${file}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(file, backup);
  console.log(`Backed up the previous config to ${backup}`);
}
config.mcpServers = {...(config.mcpServers as Record<string, unknown> ?? {}), [key]: entry};
writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
console.log(`Added "${key}" (${user}) to ${file}. Quit Claude Desktop completely and reopen it.`);
