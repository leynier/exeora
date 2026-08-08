CREATE TABLE `usage_rollup_state` (
	`source` text PRIMARY KEY NOT NULL,
	`last_complete_day` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
