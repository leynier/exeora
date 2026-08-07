CREATE TABLE `admin_users` (
	`email` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `admin_users` (`email`, `created_at`) VALUES ('leynier41@gmail.com', unixepoch() * 1000);
