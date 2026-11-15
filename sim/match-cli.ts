// npm run match -- [<campaign id>] [--recorded <file>] [--pace 300] [--limit N]
//
// Beat 3 of the demo: the simulated creators' agents read a live campaign and
// join, decline or ask the founder a question; the campaign page shows each
// decision as it lands. Without a campaign id it uses the newest open one.
//
// Live mode calls the Anthropic API (one call per creator, about 30, roughly
// $0.20) and saves the run to data/match-runs/. --recorded replays a saved
// run with no model calls. Uses DEALOOP_DB_PATH or data/dealoop.sqlite.

import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {AnthropicJsonClient, creatorModel, estimateCostUsd} from '../agents/claude.ts';
import {SQLiteDatabase} from '../runtime/sqlite.ts';
import {CampaignStore} from '../db/campaign-store.ts';
import {DEMO_CREATORS} from './demo-creators.ts';
import {loadRecording, runMatching, type MatchRecording} from './match.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const root = join(import.meta.dirname, '..');

const sqlite = new SQLiteDatabase(process.env.DEALOOP_DB_PATH || join(root, 'data/dealoop.sqlite'));
sqlite.migrate(join(root, 'drizzle'));
const store = new CampaignStore(sqlite.asD1());

const id = positional ?? (await store.list({status: 'open', limit: 1}))[0]?.id;
if (!id) { console.error('No open campaign. Post one from Claude first.'); process.exit(1); }
const stored = await store.require(id);
const recordingFile = flag('recorded');
const limit = Number(flag('limit') ?? DEMO_CREATORS.length);
const client = recordingFile ? undefined : new AnthropicJsonClient();
// The platform clock, which the demo may have run ahead (CampaignStore.now).
const offset = (await store.now()) - Date.now();

console.log(`Matching "${stored.meta.title}" (${id}) · ${recordingFile ? `replaying ${recordingFile}` : `live, ${creatorModel()}`} · SIMULATED CREATORS\n`);
const decisions = await runMatching(store, id, {
  client, recording: recordingFile ? loadRecording(recordingFile) : undefined,
  creators: DEMO_CREATORS.slice(0, limit), now: () => Date.now() + offset, paceMs: Number(flag('pace') ?? (recordingFile ? 400 : 0)),
  onDecision: d => console.log(`${d.decision.action.padEnd(8)} ${d.handle.padEnd(20)} ${d.decision.action === 'ask' ? d.decision.question : d.decision.reason}${d.fellBack ? '  (model unavailable: floor rule)' : ''}`),
});

const count = (a: string) => decisions.filter(d => d.decision.action === a).length;
console.log(`\n${count('join')} joined · ${count('decline')} declined · ${count('ask')} asked the founder · ${decisions.filter(d => d.fellBack).length} fell back`);
if (client) {
  const cost = estimateCostUsd(client.usage, creatorModel());
  console.log(`${client.usage.calls} calls, ${client.usage.inputTokens} input and ${client.usage.outputTokens} output tokens${cost === null ? '' : `, about $${cost.toFixed(2)}`}`);
  const recording: MatchRecording = {campaignTitle: stored.meta.title, recordedAt: new Date().toISOString(), model: creatorModel(), decisions};
  const dir = join(root, 'data/match-runs');
  mkdirSync(dir, {recursive: true});
  const file = join(dir, `${id}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(recording, null, 2) + '\n');
  console.log(`Saved to ${file}; replay with --recorded.`);
}
sqlite.close();
