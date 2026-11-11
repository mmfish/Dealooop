// The campaign migration applies cleanly on top of the inherited schema, and its
// CHECK and UNIQUE constraints refuse the money-invariant violations on their own,
// as a second line of defense behind core/campaign.ts.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteDatabase} from '../runtime/sqlite.ts';

function setup() {
  const db = new SQLiteDatabase(':memory:');
  db.migrate('drizzle');
  const run = (sql: string, ...values: (string | number | null)[]) => db.raw.prepare(sql).run(...values);
  run('INSERT INTO users(id,name,created_at) VALUES(?,?,?)', 'founder', 'Founder', 1);
  run('INSERT INTO users(id,name,created_at) VALUES(?,?,?)', 'creator', 'Creator', 1);
  const campaign = (id: string, over: Record<string, number | string> = {}) => {
    const c = {goal: 100, budget: 100_000, max: 1_000, start: 300, step: 100, current: 300, ...over};
    run(`INSERT INTO campaigns(id,owner_id,title,brief,product_url,goal_count,budget_cents,max_cac_cents,start_price_cents,step_cents,current_price_cents,deadline,status,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, 'founder', 'Dealoop', 'brief', 'https://example.test', c.goal, c.budget, c.max, c.start, c.step, c.current, 2, String(over.status ?? 'open'), 1);
  };
  return {db, run, campaign};
}

test('migration 0008 applies on top of the inherited schema', () => {
  const {db} = setup();
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => (r as {name: string}).name);
  for (const t of ['campaigns', 'campaign_links', 'conversions', 'campaign_deals', 'price_changes', 'proposal_rejections', 'ledger_entries', 'posts', 'offers']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
});

test('CHECK constraints refuse invalid campaigns and prices', () => {
  const {campaign, run} = setup();
  campaign('ok');
  assert.throws(() => campaign('over-cap', {current: 1_001}), /CHECK/);
  assert.throws(() => campaign('below-start', {current: 200}), /CHECK/);
  assert.throws(() => campaign('cac-over-budget', {max: 200_000}), /CHECK/);
  assert.throws(() => campaign('bad-status', {status: 'paused'}), /CHECK/);
  assert.throws(() => run('UPDATE campaigns SET current_price_cents=? WHERE id=?', 5_000, 'ok'), /CHECK/);
  assert.throws(() => run('INSERT INTO price_changes(campaign_id,from_cents,to_cents,created_at) VALUES(?,?,?,?)', 'ok', 500, 400, 1), /CHECK/, 'price can only go up');
});

test('conversion and ledger constraints refuse double counting and double payment', () => {
  const {campaign, run} = setup();
  campaign('c');
  run('INSERT INTO campaign_links(id,campaign_id,creator_id,token,created_at) VALUES(?,?,?,?,?)', 'l', 'c', 'creator', 'tok', 1);
  const conv = (id: string, user: string, seq: number, channel = 'public', deal: number | null = null, status = 'verified') =>
    run(`INSERT INTO conversions(id,campaign_id,link_id,creator_id,external_user_id,seq,status,channel,deal_price_cents,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`, id, 'c', 'l', 'creator', user, seq, status, channel, deal, 1, 1);
  conv('v1', 'u1', 1);
  assert.throws(() => conv('v2', 'u1', 2), /UNIQUE/, 'same user twice');
  assert.throws(() => conv('v3', 'u3', 1), /UNIQUE/, 'same seq twice');
  assert.throws(() => conv('v4', 'u4', 4, 'public', 700), /CHECK/, 'public conversions carry no deal price');
  assert.throws(() => conv('v5', 'u5', 5, 'deal', null), /CHECK/, 'deal conversions need a price');
  assert.throws(() => conv('v6', 'u6', 6, 'public', null, 'paid'), /CHECK/);
  run('INSERT INTO ledger_entries(id,campaign_id,conversion_id,creator_id,seq,channel,amount_cents,created_at) VALUES(?,?,?,?,?,?,?,?)', 'e1', 'c', 'v1', 'creator', 1, 'public', 300, 1);
  assert.throws(() => run('INSERT INTO ledger_entries(id,campaign_id,conversion_id,creator_id,seq,channel,amount_cents,created_at) VALUES(?,?,?,?,?,?,?,?)', 'e2', 'c', 'v1', 'creator', 1, 'public', 300, 1), /UNIQUE/, 'a conversion is paid once');
  assert.throws(() => run('INSERT INTO ledger_entries(id,campaign_id,conversion_id,creator_id,seq,channel,amount_cents,created_at) VALUES(?,?,?,?,?,?,?,?)', 'e3', 'c', 'v1', 'creator', 1, 'public', 0, 1), /CHECK|UNIQUE/);
});
