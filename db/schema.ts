// connections.max_posts keeps its legacy DB default of 10. Issuance explicitly
// writes the current policy allowance; existing owner-approved grants are retained.
// Legacy connection price columns are retained for historical data and rollback only.
// They are not permissions and must not be used for authorization or commercial decisions.
// Retention: short-lived auth material is purged opportunistically (expired
// auth_sessions on login, expired pending/denied plus stale approved
// oauth_requests on authorize, rate_limits per request, orphan photos on
// upload). Used oauth_requests are kept for single-use replay protection.
// History tables (posts, offers, messages, deals, activities) are retained for
// the marketplace record. All foreign keys are NO ACTION by design: there is no
// user-deletion cascade, so account erasure is an operator-run procedure, not an
// application endpoint.
import {sql} from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
export const users = sqliteTable('users', {id:text('id').primaryKey(),name:text('name').notNull(),createdAt:integer('created_at').notNull()});
export const connections = sqliteTable('connections', {
 oauthRefreshExpiresAt:integer('oauth_refresh_expires_at'),oauthResource:text('oauth_resource'),oauthScope:text('oauth_scope'),id:text('id').primaryKey(),deviceHash:text('device_hash').notNull().unique(),userCode:text('user_code').notNull().unique(),name:text('name').notNull(),ownerId:text('owner_id').references(()=>users.id),status:text('status').notNull(),tokenHash:text('token_hash').unique(),canWrite:integer('can_write').notNull().default(0),canNegotiate:integer('can_negotiate').notNull().default(0),canAccept:integer('can_accept').notNull().default(0),minDealPrice:integer('min_deal_price').notNull().default(0),maxDealPrice:integer('max_deal_price').notNull().default(0),maxPosts:integer('max_posts').notNull().default(10),maxPrice:integer('max_price').notNull().default(50000),expiresAt:integer('expires_at').notNull(),createdAt:integer('created_at').notNull(),
},t=>[index('connection_owner').on(t.ownerId)]);
export const posts = sqliteTable('posts', {
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull().references(()=>users.id),actor:text('actor').notNull(),agentId:text('agent_id').references(()=>connections.id),type:text('type').notNull(),title:text('title').notNull(),description:text('description').notNull(),category:text('category').notNull(),price:integer('price').notNull(),condition:text('condition').notNull(),location:text('location').notNull(),delivery:text('delivery').notNull(),image:text('image'),status:text('status').notNull().default('active'),demo:integer('demo').notNull().default(0),createdAt:integer('created_at').notNull(),idempotencyKey:text('idempotency_key').notNull(),requestHash:text('request_hash').notNull(),
},t=>[uniqueIndex('post_idempotency').on(t.ownerId,t.actor,t.idempotencyKey),index('post_browse').on(t.status,t.createdAt),index('post_owner').on(t.ownerId),index('post_agent').on(t.agentId)]);
export const activities = sqliteTable('activities', {
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull().references(()=>users.id),actor:text('actor').notNull(),kind:text('kind').notNull(),summary:text('summary').notNull(),postId:text('post_id').references(()=>posts.id),createdAt:integer('created_at').notNull(),
},t=>[index('activity_owner').on(t.ownerId,t.createdAt)]);
export const photos=sqliteTable('photos',{id:text('id').primaryKey(),ownerId:text('owner_id').notNull().references(()=>users.id),contentType:text('content_type').notNull(),createdAt:integer('created_at').notNull()});
export const rateLimits=sqliteTable('rate_limits',{key:text('key').primaryKey(),count:integer('count').notNull(),expiresAt:integer('expires_at').notNull()},t=>[index('rate_limit_expiry').on(t.expiresAt)]);
export const authIdentities=sqliteTable('auth_identities',{subject:text('subject').primaryKey(),ownerId:text('owner_id').notNull().references(()=>users.id),createdAt:integer('created_at').notNull()},t=>[index('auth_identity_owner').on(t.ownerId)]);
export const authSessions=sqliteTable('auth_sessions',{tokenHash:text('token_hash').primaryKey(),ownerId:text('owner_id').notNull().references(()=>users.id),email:text('email').notNull(),provider:text('provider').notNull(),expiresAt:integer('expires_at').notNull(),createdAt:integer('created_at').notNull()},t=>[index('auth_session_expiry').on(t.expiresAt)]);
export const offers=sqliteTable('offers',{id:text('id').primaryKey(),postId:text('post_id').notNull().references(()=>posts.id),postOwnerId:text('post_owner_id').notNull().references(()=>users.id),offererId:text('offerer_id').notNull().references(()=>users.id),status:text('status').notNull().default('open'),revision:integer('revision').notNull().default(1),price:integer('price').notNull(),item:text('item').notNull(),condition:text('condition').notNull(),delivery:text('delivery').notNull(),terms:text('terms').notNull(),expiresAt:integer('expires_at').notNull(),proposedBy:text('proposed_by').notNull().references(()=>users.id),confirmedRevision:integer('confirmed_revision'),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull()},t=>[index('offer_post').on(t.postId,t.status),index('offer_owner').on(t.postOwnerId,t.updatedAt),index('offer_responder').on(t.offererId,t.updatedAt)]);
export const offerRevisions=sqliteTable('offer_revisions',{offerId:text('offer_id').notNull().references(()=>offers.id),revision:integer('revision').notNull(),authorId:text('author_id').notNull().references(()=>users.id),actorName:text('actor_name').notNull(),termsJson:text('terms_json').notNull(),createdAt:integer('created_at').notNull()},t=>[uniqueIndex('offer_revision').on(t.offerId,t.revision)]);
export const messages=sqliteTable('messages',{sequence:integer('sequence').primaryKey({autoIncrement:true}),id:text('id').notNull().unique(),offerId:text('offer_id').notNull().references(()=>offers.id),authorId:text('author_id').notNull().references(()=>users.id),actorName:text('actor_name').notNull(),body:text('body').notNull(),createdAt:integer('created_at').notNull()},t=>[index('message_offer').on(t.offerId,t.sequence)]);
export const deals=sqliteTable('deals',{id:text('id').primaryKey(),postId:text('post_id').notNull().unique().references(()=>posts.id),offerId:text('offer_id').notNull().unique().references(()=>offers.id),revision:integer('revision').notNull(),buyerId:text('buyer_id').notNull().references(()=>users.id),sellerId:text('seller_id').notNull().references(()=>users.id),termsJson:text('terms_json').notNull(),acceptedBy:text('accepted_by').notNull(),createdAt:integer('created_at').notNull()});
export const negotiationActions=sqliteTable('negotiation_actions',{id:text('id').primaryKey(),ownerId:text('owner_id').notNull().references(()=>users.id),actorKey:text('actor_key').notNull(),idempotencyKey:text('idempotency_key').notNull(),requestHash:text('request_hash').notNull(),offerId:text('offer_id').notNull(),kind:text('kind').notNull(),createdAt:integer('created_at').notNull()},t=>[uniqueIndex('negotiation_idempotency').on(t.ownerId,t.actorKey,t.idempotencyKey)]);
export const negotiationEvents=sqliteTable('negotiation_events',{sequence:integer('sequence').primaryKey({autoIncrement:true}),ownerId:text('owner_id').notNull().references(()=>users.id),kind:text('kind').notNull(),offerId:text('offer_id').notNull().references(()=>offers.id),postId:text('post_id').notNull().references(()=>posts.id),revision:integer('revision').notNull(),actorName:text('actor_name').notNull(),createdAt:integer('created_at').notNull()},t=>[index('negotiation_inbox').on(t.ownerId,t.sequence)]);

export const oauthClients=sqliteTable('oauth_clients',{refreshEnabled:integer('refresh_enabled').notNull().default(0),id:text('id').primaryKey(),redirectUri:text('redirect_uri').notNull(),createdAt:integer('created_at').notNull()});
export const oauthRequests=sqliteTable('oauth_requests',{renewable:integer('renewable').notNull().default(0),scope:text('scope').notNull().default('identity:read'),resource:text('resource'),id:text('id').primaryKey(),clientId:text('client_id').notNull().references(()=>oauthClients.id),redirectUri:text('redirect_uri').notNull(),state:text('state').notNull(),challenge:text('challenge').notNull(),ownerId:text('owner_id').notNull().references(()=>users.id),csrfHash:text('csrf_hash').notNull(),status:text('status').notNull(),expiresAt:integer('expires_at').notNull(),codeHash:text('code_hash').unique(),codeExpiresAt:integer('code_expires_at'),connectionId:text('connection_id'),issuedTokenHash:text('issued_token_hash')},t=>[index('oauth_request_expiry').on(t.expiresAt)]);

export const oauthRefreshTokens=sqliteTable('oauth_refresh_tokens',{tokenHash:text('token_hash').primaryKey(),connectionId:text('connection_id').notNull().references(()=>connections.id),clientId:text('client_id').notNull().references(()=>oauthClients.id),resource:text('resource').notNull(),expiresAt:integer('expires_at').notNull(),usedAt:integer('used_at'),replacementHash:text('replacement_hash'),createdAt:integer('created_at').notNull()},t=>[index('oauth_refresh_connection').on(t.connectionId)]);

// Owner-authored ranking; never inferred from price or commercial criteria.
export const shortlistState=sqliteTable('shortlist_state',{postId:text('post_id').primaryKey().references(()=>posts.id),version:integer('version').notNull(),updatedAt:integer('updated_at').notNull(),actor:text('actor').notNull()});
export const shortlistEntries=sqliteTable('shortlist_entries',{postId:text('post_id').notNull().references(()=>posts.id),rank:integer('rank').notNull(),offerId:text('offer_id').notNull().references(()=>offers.id),offerRevision:integer('offer_revision').notNull(),summary:text('summary').notNull(),reason:text('reason').notNull(),price:integer('price').notNull(),condition:text('condition').notNull(),delivery:text('delivery').notNull(),expiresAt:integer('expires_at').notNull()},t=>[check('shortlist_rank_bounds',sql`${t.rank} BETWEEN 1 AND 3`),uniqueIndex('shortlist_rank').on(t.postId,t.rank),uniqueIndex('shortlist_offer').on(t.postId,t.offerId)]);
export const shortlistActions=sqliteTable('shortlist_actions',{id:text('id').primaryKey(),postId:text('post_id').notNull().references(()=>posts.id),ownerId:text('owner_id').notNull().references(()=>users.id),actorKey:text('actor_key').notNull(),idempotencyKey:text('idempotency_key').notNull(),requestHash:text('request_hash').notNull(),version:integer('version').notNull(),createdAt:integer('created_at').notNull()},t=>[uniqueIndex('shortlist_idempotency').on(t.ownerId,t.actorKey,t.idempotencyKey)]);

// ---------------------------------------------------------------------------
// Dealoop campaign domain (docs/SPEC.md §5). The rules live in core/campaign.ts;
// these tables persist its Book, and the CHECK constraints are a second line of
// defense for the money invariants (docs/ACCEPTANCE.md A1, A4, A7).
// All amounts are integer cents.
// ---------------------------------------------------------------------------
export const campaigns=sqliteTable('campaigns',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull().references(()=>users.id),
 title:text('title').notNull(),brief:text('brief').notNull(),productUrl:text('product_url').notNull(),imageUrl:text('image_url').notNull().default(''),
 goalCount:integer('goal_count').notNull(),budgetCents:integer('budget_cents').notNull(),maxCacCents:integer('max_cac_cents').notNull(),
 startPriceCents:integer('start_price_cents').notNull(),stepCents:integer('step_cents').notNull(),currentPriceCents:integer('current_price_cents').notNull(),
 deadline:integer('deadline').notNull(),status:text('status').notNull().default('open'),nextSeq:integer('next_seq').notNull().default(1),
 version:integer('version').notNull().default(0),demo:integer('demo').notNull().default(0),createdAt:integer('created_at').notNull(),
},t=>[
 index('campaign_browse').on(t.status,t.createdAt),index('campaign_owner').on(t.ownerId),
 check('campaign_status',sql`${t.status} IN ('open','closed')`),
 check('campaign_amounts',sql`${t.goalCount}>0 AND ${t.budgetCents}>0 AND ${t.maxCacCents}>0 AND ${t.maxCacCents}<=${t.budgetCents} AND ${t.stepCents}>0`),
 check('campaign_price_bounds',sql`${t.currentPriceCents}>=${t.startPriceCents} AND ${t.currentPriceCents}<=${t.maxCacCents}`),
]);
export const campaignLinks=sqliteTable('campaign_links',{
 id:text('id').primaryKey(),campaignId:text('campaign_id').notNull().references(()=>campaigns.id),
 creatorId:text('creator_id').notNull().references(()=>users.id),token:text('token').notNull().unique(),createdAt:integer('created_at').notNull(),
},t=>[uniqueIndex('campaign_link_creator').on(t.campaignId,t.creatorId)]);
export const conversions=sqliteTable('conversions',{
 id:text('id').primaryKey(),campaignId:text('campaign_id').notNull().references(()=>campaigns.id),
 linkId:text('link_id').notNull().references(()=>campaignLinks.id),creatorId:text('creator_id').notNull().references(()=>users.id),
 externalUserId:text('external_user_id').notNull(),seq:integer('seq').notNull(),status:text('status').notNull(),
 channel:text('channel').notNull(),dealPriceCents:integer('deal_price_cents'),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>[
 uniqueIndex('conversion_user').on(t.campaignId,t.externalUserId),uniqueIndex('conversion_seq').on(t.campaignId,t.seq),
 index('conversion_creator').on(t.creatorId,t.createdAt),
 check('conversion_status',sql`${t.status} IN ('pending','verified','rejected','unfunded')`),
 check('conversion_channel',sql`(${t.channel}='public' AND ${t.dealPriceCents} IS NULL) OR (${t.channel}='deal' AND ${t.dealPriceCents} IS NOT NULL AND ${t.dealPriceCents}>0)`),
]);
export const campaignDeals=sqliteTable('campaign_deals',{
 campaignId:text('campaign_id').notNull().references(()=>campaigns.id),creatorId:text('creator_id').notNull().references(()=>users.id),
 priceCents:integer('price_cents').notNull(),volumeCap:integer('volume_cap').notNull().default(1),offerId:text('offer_id').references(()=>offers.id),createdAt:integer('created_at').notNull(),
},t=>[uniqueIndex('campaign_deal_creator').on(t.campaignId,t.creatorId),check('campaign_deal_price',sql`${t.priceCents}>0`),check('campaign_deal_volume',sql`${t.volumeCap}>=1`)]);
export const priceChanges=sqliteTable('price_changes',{
 sequence:integer('sequence').primaryKey({autoIncrement:true}),campaignId:text('campaign_id').notNull().references(()=>campaigns.id),
 fromCents:integer('from_cents').notNull(),toCents:integer('to_cents').notNull(),rationale:text('rationale'),createdAt:integer('created_at').notNull(),
},t=>[index('price_change_campaign').on(t.campaignId,t.sequence),check('price_change_up',sql`${t.toCents}>${t.fromCents}`)]);
// Every refused agent proposal, with its reason, for the UI (ACCEPTANCE S4, S7).
export const proposalRejections=sqliteTable('proposal_rejections',{
 sequence:integer('sequence').primaryKey({autoIncrement:true}),campaignId:text('campaign_id').notNull().references(()=>campaigns.id),
 actor:text('actor').notNull(),kind:text('kind').notNull(),reason:text('reason').notNull(),createdAt:integer('created_at').notNull(),
},t=>[index('proposal_rejection_campaign').on(t.campaignId,t.sequence)]);
// Written once, at settlement. The unique conversion_id makes a second payout impossible (A5).
export const ledgerEntries=sqliteTable('ledger_entries',{
 id:text('id').primaryKey(),campaignId:text('campaign_id').notNull().references(()=>campaigns.id),
 conversionId:text('conversion_id').notNull().unique().references(()=>conversions.id),creatorId:text('creator_id').notNull().references(()=>users.id),
 seq:integer('seq').notNull(),channel:text('channel').notNull(),amountCents:integer('amount_cents').notNull(),createdAt:integer('created_at').notNull(),
},t=>[index('ledger_campaign').on(t.campaignId,t.seq),check('ledger_amount',sql`${t.amountCents}>0`)]);
// Optimistic-concurrency guard: every committed change to a campaign inserts its
// next version here, so two writers that loaded the same version cannot both commit.
export const campaignCommits=sqliteTable('campaign_commits',{
 campaignId:text('campaign_id').notNull().references(()=>campaigns.id),version:integer('version').notNull(),createdAt:integer('created_at').notNull(),
},t=>[uniqueIndex('campaign_commit_version').on(t.campaignId,t.version)]);
// The campaign's public feed: what the platform page and the founder's agent show.
export const campaignEvents=sqliteTable('campaign_events',{
 sequence:integer('sequence').primaryKey({autoIncrement:true}),campaignId:text('campaign_id').notNull().references(()=>campaigns.id),
 kind:text('kind').notNull(),actor:text('actor').notNull(),summary:text('summary').notNull(),dataJson:text('data_json').notNull().default('{}'),createdAt:integer('created_at').notNull(),
},t=>[index('campaign_event_feed').on(t.campaignId,t.sequence)]);
// A creator's public profile, used by matching. prior_verified seeds a track record
// from before this deployment (labeled demo data); live verified conversions add to it.
export const creatorProfiles=sqliteTable('creator_profiles',{
 userId:text('user_id').primaryKey().references(()=>users.id),handle:text('handle').notNull().unique(),platform:text('platform').notNull(),
 niche:text('niche').notNull(),audience:text('audience').notNull().default(''),followers:integer('followers').notNull().default(0),
 priorVerified:integer('prior_verified').notNull().default(0),demo:integer('demo').notNull().default(0),createdAt:integer('created_at').notNull(),
},t=>[check('creator_profile_counts',sql`${t.followers}>=0 AND ${t.priorVerified}>=0`)]);
// A creator's question the brief does not answer (DEMO-FLOW beat 4). Only the
// founder can answer it, through their own agent, in their own words.
export const campaignQuestions=sqliteTable('campaign_questions',{
 id:text('id').primaryKey(),campaignId:text('campaign_id').notNull().references(()=>campaigns.id),
 creatorId:text('creator_id').notNull().references(()=>users.id),question:text('question').notNull(),
 status:text('status').notNull().default('pending'),answer:text('answer').notNull().default(''),
 createdAt:integer('created_at').notNull(),answeredAt:integer('answered_at'),
},t=>[index('campaign_question_status').on(t.campaignId,t.status),check('campaign_question_state',sql`${t.status} IN ('pending','answered')`)]);
// Private negotiations between a top creator and a campaign's founder (DEMO-FLOW beat 6).
// state_json is core/negotiation.ts's Negotiation; neither side's private limit is stored.
export const campaignNegotiations=sqliteTable('campaign_negotiations',{
 id:text('id').primaryKey(),campaignId:text('campaign_id').notNull().references(()=>campaigns.id),
 creatorId:text('creator_id').notNull().references(()=>users.id),status:text('status').notNull().default('open'),
 stateJson:text('state_json').notNull(),turns:integer('turns').notNull().default(0),
 createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>[index('campaign_negotiation_campaign').on(t.campaignId,t.status),check('campaign_negotiation_state',sql`${t.status} IN ('open','agreed','failed')`)]);
