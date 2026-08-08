CREATE TABLE `audit_deletions` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`target_id` text NOT NULL,
	`requested_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `audit_deletions_pending` ON `audit_deletions` (`completed_at`,`requested_at`);