CREATE TABLE `plugin_settings` (
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`values_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`user_id`, `client_id`, `endpoint`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
