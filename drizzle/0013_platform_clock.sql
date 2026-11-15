CREATE TABLE `platform_clock` (
	`id` integer PRIMARY KEY NOT NULL,
	`offset_ms` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "platform_clock_single" CHECK("platform_clock"."id"=1)
);
