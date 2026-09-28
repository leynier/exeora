CREATE TABLE `ai_device_logins` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`device_ciphertext` text NOT NULL,
	`user_code` text NOT NULL,
	`verification_url` text NOT NULL,
	`interval_s` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`secret_ciphertext` text,
	PRIMARY KEY(`user_id`, `provider`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ai_operation_settings` (
	`user_id` text NOT NULL,
	`operation` text NOT NULL,
	`provider` text,
	`model` text,
	`instructions` text,
	PRIMARY KEY(`user_id`, `operation`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`auth_kind` text NOT NULL,
	`access_ciphertext` text NOT NULL,
	`refresh_ciphertext` text,
	`access_expires_at` integer,
	`account_id` text,
	`account_label` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_providers_user_provider` ON `ai_providers` (`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `ai_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`default_provider` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
