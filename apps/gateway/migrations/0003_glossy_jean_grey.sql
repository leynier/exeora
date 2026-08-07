CREATE TABLE `active_projects` (
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`project_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `active_projects_user_client` ON `active_projects` (`user_id`,`client_id`);--> statement-breakpoint
DROP INDEX `project_clients_project_client`;--> statement-breakpoint
ALTER TABLE `project_clients` ADD `endpoint` text DEFAULT 'project' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `project_clients_project_client_endpoint` ON `project_clients` (`project_id`,`client_id`,`endpoint`);