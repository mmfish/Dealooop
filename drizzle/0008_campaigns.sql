CREATE TABLE `campaign_deals` (
	`campaign_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`price_cents` integer NOT NULL,
	`offer_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "campaign_deal_price" CHECK("campaign_deals"."price_cents">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_deal_creator` ON `campaign_deals` (`campaign_id`,`creator_id`);--> statement-breakpoint
CREATE TABLE `campaign_links` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_links_token_unique` ON `campaign_links` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_link_creator` ON `campaign_links` (`campaign_id`,`creator_id`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`brief` text NOT NULL,
	`product_url` text NOT NULL,
	`goal_count` integer NOT NULL,
	`budget_cents` integer NOT NULL,
	`max_cac_cents` integer NOT NULL,
	`start_price_cents` integer NOT NULL,
	`step_cents` integer NOT NULL,
	`current_price_cents` integer NOT NULL,
	`deadline` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`next_seq` integer DEFAULT 1 NOT NULL,
	`demo` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "campaign_status" CHECK("campaigns"."status" IN ('open','closed')),
	CONSTRAINT "campaign_amounts" CHECK("campaigns"."goal_count">0 AND "campaigns"."budget_cents">0 AND "campaigns"."max_cac_cents">0 AND "campaigns"."max_cac_cents"<="campaigns"."budget_cents" AND "campaigns"."step_cents">0),
	CONSTRAINT "campaign_price_bounds" CHECK("campaigns"."current_price_cents">="campaigns"."start_price_cents" AND "campaigns"."current_price_cents"<="campaigns"."max_cac_cents")
);
--> statement-breakpoint
CREATE INDEX `campaign_browse` ON `campaigns` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `campaign_owner` ON `campaigns` (`owner_id`);--> statement-breakpoint
CREATE TABLE `conversions` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`link_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`external_user_id` text NOT NULL,
	`seq` integer NOT NULL,
	`status` text NOT NULL,
	`channel` text NOT NULL,
	`deal_price_cents` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`link_id`) REFERENCES `campaign_links`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "conversion_status" CHECK("conversions"."status" IN ('pending','verified','rejected','unfunded')),
	CONSTRAINT "conversion_channel" CHECK(("conversions"."channel"='public' AND "conversions"."deal_price_cents" IS NULL) OR ("conversions"."channel"='deal' AND "conversions"."deal_price_cents" IS NOT NULL AND "conversions"."deal_price_cents">0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversion_user` ON `conversions` (`campaign_id`,`external_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversion_seq` ON `conversions` (`campaign_id`,`seq`);--> statement-breakpoint
CREATE INDEX `conversion_creator` ON `conversions` (`creator_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`conversion_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`seq` integer NOT NULL,
	`channel` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversion_id`) REFERENCES `conversions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ledger_amount" CHECK("ledger_entries"."amount_cents">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_entries_conversion_id_unique` ON `ledger_entries` (`conversion_id`);--> statement-breakpoint
CREATE INDEX `ledger_campaign` ON `ledger_entries` (`campaign_id`,`seq`);--> statement-breakpoint
CREATE TABLE `price_changes` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` text NOT NULL,
	`from_cents` integer NOT NULL,
	`to_cents` integer NOT NULL,
	`rationale` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "price_change_up" CHECK("price_changes"."to_cents">"price_changes"."from_cents")
);
--> statement-breakpoint
CREATE INDEX `price_change_campaign` ON `price_changes` (`campaign_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `proposal_rejections` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` text NOT NULL,
	`actor` text NOT NULL,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `proposal_rejection_campaign` ON `proposal_rejections` (`campaign_id`,`sequence`);