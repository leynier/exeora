CREATE TABLE `account_clients` (
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`all_projects` integer DEFAULT false NOT NULL,
	`client_name` text,
	`client_uri` text,
	`authorized_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `client_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
