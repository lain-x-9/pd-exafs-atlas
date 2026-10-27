CREATE TABLE `workspaces` (
	`user_id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
