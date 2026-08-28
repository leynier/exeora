CREATE TABLE `oauth_device_grants` (
	`device_code_hash` text PRIMARY KEY NOT NULL,
	`user_code_hash` text NOT NULL,
	`client_id` text NOT NULL,
	`code_challenge` text NOT NULL,
	`code_challenge_method` text NOT NULL,
	`scopes` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`status` text NOT NULL,
	`authorization_code` text,
	`issuer` text,
	`interval_seconds` integer NOT NULL,
	`last_polled_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_device_grants_user_code` ON `oauth_device_grants` (`user_code_hash`);--> statement-breakpoint
CREATE INDEX `oauth_device_grants_expiry` ON `oauth_device_grants` (`expires_at`);
