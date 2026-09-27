ALTER TABLE `github_user_tokens` ADD `access_ciphertext` text;--> statement-breakpoint
ALTER TABLE `github_user_tokens` ADD `access_expires_at` integer;