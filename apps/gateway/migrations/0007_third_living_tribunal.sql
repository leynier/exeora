ALTER TABLE `usage_daily` ADD `errors` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `usage_daily` ADD `last_activity_at` integer;