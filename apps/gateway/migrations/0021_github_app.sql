CREATE TABLE `github_installations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`installation_id` integer NOT NULL,
	`account_login` text NOT NULL,
	`account_type` text NOT NULL,
	`repository_selection` text DEFAULT 'selected' NOT NULL,
	`suspended_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_installations_user_installation` ON `github_installations` (`user_id`,`installation_id`);--> statement-breakpoint
CREATE INDEX `github_installations_installation` ON `github_installations` (`installation_id`);--> statement-breakpoint
CREATE TABLE `github_repositories` (
	`project_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`installation_id` integer NOT NULL,
	`repo_id` integer NOT NULL,
	`full_name` text NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`lost_access_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `github_repositories_user` ON `github_repositories` (`user_id`);--> statement-breakpoint
CREATE INDEX `github_repositories_repo` ON `github_repositories` (`repo_id`);--> statement-breakpoint
CREATE TABLE `github_user_tokens` (
	`user_id` text PRIMARY KEY NOT NULL,
	`refresh_ciphertext` text,
	`login` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
