ALTER TABLE `worktrees` RENAME TO `workspaces`;--> statement-breakpoint
DROP INDEX `worktrees_project_slug`;--> statement-breakpoint
DROP INDEX `worktrees_project`;--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_project_slug` ON `workspaces` (`project_id`,`slug`);--> statement-breakpoint
CREATE INDEX `workspaces_project` ON `workspaces` (`project_id`);--> statement-breakpoint
ALTER TABLE `audit_outbox` RENAME COLUMN `worktree_id` TO `workspace_id`;--> statement-breakpoint
ALTER TABLE `audit_outbox` RENAME COLUMN `worktree_slug` TO `workspace_slug`;
