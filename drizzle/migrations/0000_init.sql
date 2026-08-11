CREATE TABLE IF NOT EXISTS `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`user_email` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `submissions_status_idx` ON `submissions` (`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`one_liner` text,
	`description_md` text,
	`github_url` text,
	`website_url` text,
	`stars` integer DEFAULT 0 NOT NULL,
	`license` text,
	`category_id` text,
	`alternative_to` text,
	`tech_stack` text,
	`is_mcp` integer DEFAULT false NOT NULL,
	`is_open_source` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tools_slug_unique` ON `tools` (`slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tools_category_id_idx` ON `tools` (`category_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tools_stars_idx` ON `tools` (`stars`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tools_is_mcp_idx` ON `tools` (`is_mcp`);