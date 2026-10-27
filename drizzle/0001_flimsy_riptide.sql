CREATE TABLE `compute_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`base_url` text NOT NULL,
	`encrypted_token` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `compute_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` text NOT NULL
);
