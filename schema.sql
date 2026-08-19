-- ---------------------------------------------------------------------------
-- ai.100ideas.net — full SQLite schema snapshot (Cloudflare D1)
--
-- This file is a convenience snapshot of the current schema, generated from
-- src/db/schema.ts. The source of truth for incremental changes is
-- drizzle/migrations/ (`npm run db:generate`).
--
-- Bootstrap a database directly from this file:
--   npx wrangler d1 execute ai-100ideas-db --local  --file=./schema.sql
--   npx wrangler d1 execute ai-100ideas-db --remote --file=./schema.sql
-- ---------------------------------------------------------------------------

CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text
);

CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);

CREATE TABLE `tools` (
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
	`alternative_to` text,          -- JSON array string, e.g. '["Notion","Pinecone"]'
	`tech_stack` text,              -- JSON array string, e.g. '["TypeScript","Postgres"]'
	`tags` text,                    -- JSON array string of derived tags, e.g. '["rust","local-llm","mcp"]'
	`is_mcp` integer DEFAULT false NOT NULL,
	`is_open_source` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE cascade ON DELETE set null
);

CREATE UNIQUE INDEX `tools_slug_unique` ON `tools` (`slug`);
CREATE INDEX `tools_category_id_idx` ON `tools` (`category_id`);
CREATE INDEX `tools_stars_idx` ON `tools` (`stars`);
CREATE INDEX `tools_is_mcp_idx` ON `tools` (`is_mcp`);

CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`user_email` text,
	`status` text DEFAULT 'pending' NOT NULL,   -- pending | approved | rejected
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);

CREATE INDEX `submissions_status_idx` ON `submissions` (`status`);
