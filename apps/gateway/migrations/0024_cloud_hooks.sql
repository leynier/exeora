CREATE TABLE `project_cloud_scripts` (
	`project_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`install_script` text,
	`resume_script` text,
	`run_repository_scripts` integer DEFAULT true NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_cloud_scripts_user` ON `project_cloud_scripts` (`user_id`);--> statement-breakpoint
ALTER TABLE `cloud_machines` ADD `install_hook` text;--> statement-breakpoint
ALTER TABLE `cloud_machines` ADD `resume_hook` text;--> statement-breakpoint
ALTER TABLE `cloud_machines` ADD `tools_report` text;--> statement-breakpoint
ALTER TABLE `github_installations` ADD `permissions` text;