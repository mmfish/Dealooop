CREATE TABLE `campaign_negotiations` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`state_json` text NOT NULL,
	`turns` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "campaign_negotiation_state" CHECK("campaign_negotiations"."status" IN ('open','agreed','failed'))
);
--> statement-breakpoint
CREATE INDEX `campaign_negotiation_campaign` ON `campaign_negotiations` (`campaign_id`,`status`);