CREATE TABLE `project_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'local' NOT NULL,
	`device_id` text,
	`local_path` text,
	`status` text DEFAULT 'ready' NOT NULL,
	`error` text,
	`error_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_locations_project_device` ON `project_locations` (`project_id`,`device_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_locations_cloud` ON `project_locations` (`project_id`) WHERE kind = 'cloud';--> statement-breakpoint
CREATE INDEX `project_locations_device` ON `project_locations` (`device_id`);--> statement-breakpoint
CREATE INDEX `project_locations_user` ON `project_locations` (`user_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `repo_url` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `repo_key` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `default_branch` text;--> statement-breakpoint
CREATE INDEX `projects_user_repo` ON `projects` (`user_id`,`repo_key`);--> statement-breakpoint
-- Every project that exists lives in exactly one place today: its own machine.
INSERT INTO `project_locations` (`id`, `project_id`, `user_id`, `kind`, `device_id`, `local_path`, `status`)
SELECT 'loc_' || substr(p.`id`, 5), p.`id`, p.`user_id`, d.`kind`, p.`device_id`, p.`local_path`, 'ready'
  FROM `projects` p
  JOIN `devices` d ON d.`id` = p.`device_id`;
--> statement-breakpoint
-- A cloud project already knows its repository; the project row learns it too.
UPDATE `projects`
   SET `repo_url` = (SELECT c.`repo_url` FROM `cloud_projects` c WHERE c.`project_id` = `projects`.`id`),
       `default_branch` = (SELECT c.`default_branch` FROM `cloud_projects` c WHERE c.`project_id` = `projects`.`id`),
       `repo_key` = (
         SELECT lower(rtrim(replace(replace(replace(c.`repo_url`, 'https://', ''), 'http://', ''), '.git', ''), '/'))
           FROM `cloud_projects` c WHERE c.`project_id` = `projects`.`id`
       )
 WHERE EXISTS (SELECT 1 FROM `cloud_projects` c WHERE c.`project_id` = `projects`.`id`);
