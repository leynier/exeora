CREATE TABLE `audit_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`tool` text NOT NULL,
	`status` text,
	`duration_ms` integer,
	`error_code` text,
	`client_id` text,
	`client_name` text,
	`endpoint` text NOT NULL,
	`ready_at` integer,
	`accepted_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_outbox_delivery` ON `audit_outbox` (`accepted_at`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `audit_outbox_started` ON `audit_outbox` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_outbox_user_project` ON `audit_outbox` (`user_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `browser_sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `browser_sessions_user_expiry` ON `browser_sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `browser_sessions_expiry` ON `browser_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_pending` (
	`state` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_pending_expiry` ON `oauth_pending` (`expires_at`);--> statement-breakpoint
UPDATE `users` SET `email` = lower(trim(`email`)) WHERE trim(`email`) <> '';--> statement-breakpoint
CREATE TABLE `admin_users_normalized` (
	`email` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);--> statement-breakpoint
INSERT OR IGNORE INTO `admin_users_normalized` (`email`, `created_at`)
SELECT lower(trim(`email`)), min(`created_at`)
FROM `admin_users`
WHERE trim(`email`) <> ''
GROUP BY lower(trim(`email`));--> statement-breakpoint
DROP TABLE `admin_users`;--> statement-breakpoint
ALTER TABLE `admin_users_normalized` RENAME TO `admin_users`;--> statement-breakpoint
DROP INDEX `audit_deletions_pending`;--> statement-breakpoint
ALTER TABLE `audit_deletions` ADD `next_attempt_at` integer DEFAULT (unixepoch() * 1000) NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_deletions` ADD `successful_passes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_deletions` ADD `lease_token` text;--> statement-breakpoint
ALTER TABLE `audit_deletions` ADD `lease_until` integer;--> statement-breakpoint
DELETE FROM `audit_deletions`
WHERE rowid NOT IN (
	SELECT min(rowid) FROM `audit_deletions` GROUP BY `scope`, `target_id`
);--> statement-breakpoint
CREATE UNIQUE INDEX `audit_deletions_target` ON `audit_deletions` (`scope`,`target_id`);--> statement-breakpoint
CREATE INDEX `audit_deletions_pending` ON `audit_deletions` (`completed_at`,`next_attempt_at`);
