CREATE TABLE `campaign_commits` (
	`campaign_id` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_commit_version` ON `campaign_commits` (`campaign_id`,`version`);--> statement-breakpoint
CREATE TABLE `campaign_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` text NOT NULL,
	`kind` text NOT NULL,
	`actor` text NOT NULL,
	`summary` text NOT NULL,
	`data_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `campaign_event_feed` ON `campaign_events` (`campaign_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `creator_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`platform` text NOT NULL,
	`niche` text NOT NULL,
	`audience` text DEFAULT '' NOT NULL,
	`followers` integer DEFAULT 0 NOT NULL,
	`prior_verified` integer DEFAULT 0 NOT NULL,
	`demo` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "creator_profile_counts" CHECK("creator_profiles"."followers">=0 AND "creator_profiles"."prior_verified">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `creator_profiles_handle_unique` ON `creator_profiles` (`handle`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_campaign_deals` (
	`campaign_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`price_cents` integer NOT NULL,
	`volume_cap` integer DEFAULT 1 NOT NULL,
	`offer_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "campaign_deal_price" CHECK("__new_campaign_deals"."price_cents">0),
	CONSTRAINT "campaign_deal_volume" CHECK("__new_campaign_deals"."volume_cap">=1)
);
--> statement-breakpoint
INSERT INTO `__new_campaign_deals`("campaign_id", "creator_id", "price_cents", "volume_cap", "offer_id", "created_at") SELECT "campaign_id", "creator_id", "price_cents", 1, "offer_id", "created_at" FROM `campaign_deals`;--> statement-breakpoint
DROP TABLE `campaign_deals`;--> statement-breakpoint
ALTER TABLE `__new_campaign_deals` RENAME TO `campaign_deals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_deal_creator` ON `campaign_deals` (`campaign_id`,`creator_id`);--> statement-breakpoint
ALTER TABLE `campaigns` ADD `version` integer DEFAULT 0 NOT NULL;