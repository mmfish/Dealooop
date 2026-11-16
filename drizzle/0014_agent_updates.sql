CREATE TABLE `agent_cursors` (
	`user_id` text PRIMARY KEY NOT NULL,
	`sequence` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `campaign_negotiations` ADD `creator_key` text;--> statement-breakpoint
ALTER TABLE `campaign_negotiations` ADD `founder_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_negotiations_creator_key_unique` ON `campaign_negotiations` (`creator_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_negotiations_founder_key_unique` ON `campaign_negotiations` (`founder_key`);