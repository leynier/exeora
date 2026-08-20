CREATE TABLE `worktrees` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`branch` text,
	`local_path` text NOT NULL,
	`managed` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktrees_project_slug` ON `worktrees` (`project_id`,`slug`);--> statement-breakpoint
CREATE INDEX `worktrees_project` ON `worktrees` (`project_id`);--> statement-breakpoint
ALTER TABLE `audit_outbox` ADD `worktree_id` text;--> statement-breakpoint
ALTER TABLE `audit_outbox` ADD `worktree_slug` text;