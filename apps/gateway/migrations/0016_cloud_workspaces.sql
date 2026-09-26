CREATE TABLE `cloud_machines` (
	`device_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text,
	`sprite_name` text NOT NULL,
	`sprite_url` text,
	`token_hash` text,
	`status` text DEFAULT 'creating' NOT NULL,
	`step` text,
	`error` text,
	`created_from` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ready_at` integer,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cloud_machines_sprite` ON `cloud_machines` (`sprite_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `cloud_machines_token` ON `cloud_machines` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `cloud_machines_workspace` ON `cloud_machines` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `cloud_machines_project` ON `cloud_machines` (`project_id`);--> statement-breakpoint
CREATE INDEX `cloud_machines_user_status` ON `cloud_machines` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `cloud_projects` (
	`project_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`repo_url` text NOT NULL,
	`default_branch` text NOT NULL,
	`credential_username` text,
	`credential_ciphertext` text,
	`deleting_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cloud_projects_user` ON `cloud_projects` (`user_id`);--> statement-breakpoint
ALTER TABLE `devices` ADD `kind` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `cloud_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `device_id` text REFERENCES devices(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `workspaces_device` ON `workspaces` (`device_id`);