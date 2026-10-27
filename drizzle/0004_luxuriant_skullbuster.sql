CREATE TABLE `spectra_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`sha256` text NOT NULL,
	`object_key` text NOT NULL,
	`summary` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `xanes_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`collection_id` text NOT NULL,
	`object_key` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL
);
