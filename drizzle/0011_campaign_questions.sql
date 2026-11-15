CREATE TABLE `campaign_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`question` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`answer` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`answered_at` integer,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "campaign_question_state" CHECK("campaign_questions"."status" IN ('pending','answered'))
);
--> statement-breakpoint
CREATE INDEX `campaign_question_status` ON `campaign_questions` (`campaign_id`,`status`);