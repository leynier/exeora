CREATE TABLE `project_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`client_id` text NOT NULL,
	`client_name` text,
	`client_uri` text,
	`mcp_name` text,
	`mcp_version` text,
	`authorized_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_clients_project_client` ON `project_clients` (`project_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `project_clients_user` ON `project_clients` (`user_id`);--> statement-breakpoint
ALTER TABLE `tool_calls` ADD `client_name` text;