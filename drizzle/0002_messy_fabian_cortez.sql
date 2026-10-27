CREATE TABLE `assistant_sessions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
