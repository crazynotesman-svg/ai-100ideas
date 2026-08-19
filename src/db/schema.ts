/**
 * Drizzle ORM schema for ai.100ideas.net
 * Target: Cloudflare D1 (serverless SQLite)
 *
 * Conventions
 *  - Column names are snake_case (SQL), properties are camelCase (TS).
 *  - `id` is a text primary key so we can use human-readable / nanoid-style ids.
 *  - Booleans are stored as INTEGER 0/1 (SQLite has no native boolean).
 *  - Timestamps are stored as INTEGER unix seconds and surfaced as JS `Date`.
 *  - List-ish fields (`alternative_to`, `tech_stack`) are TEXT columns holding a
 *    JSON array string, e.g. '["Notion","Pinecone"]'. Drizzle's `mode: 'json'`
 *    handles (de)serialisation, so you read/write real `string[]` in TS.
 */
import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/* -------------------------------------------------------------------------- */
/* categories                                                                  */
/* -------------------------------------------------------------------------- */

// `slug` is declared `.unique()`, which already creates a lookup index —
// no extra index needed for slug-based routing.
export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
});

/* -------------------------------------------------------------------------- */
/* tools                                                                       */
/* -------------------------------------------------------------------------- */

export const tools = sqliteTable(
  'tools',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),

    /** Short pitch shown on cards & used as the meta description fallback. */
    oneLiner: text('one_liner'),
    /** Long-form body, Markdown source. */
    descriptionMd: text('description_md'),

    githubUrl: text('github_url'),
    websiteUrl: text('website_url'),

    stars: integer('stars').notNull().default(0),
    license: text('license'),

    categoryId: text('category_id').references(() => categories.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),

    /** JSON array string — powers the high-intent "open source alternative to X" pages. */
    alternativeTo: text('alternative_to', { mode: 'json' }).$type<string[]>(),
    /** JSON array string — e.g. '["TypeScript","Postgres"]'. */
    techStack: text('tech_stack', { mode: 'json' }).$type<string[]>(),

    /** JSON array string of derived tags — e.g. '["rust","local-llm","mcp"]'.
     *  Computed from `techStack` + `isMcp` + a semantic map (see src/lib/tags),
     *  backfilled by scripts/backfill-tags.ts. Powers the programmatic
     *  /tag/[tag] aggregation pages and the "Related Tools" recommendations.
     *  Null until backfilled; queries fall back to deriving tags in code. */
    tags: text('tags', { mode: 'json' }).$type<string[]>(),

    isMcp: integer('is_mcp', { mode: 'boolean' }).notNull().default(false),
    isOpenSource: integer('is_open_source', { mode: 'boolean' }).notNull().default(true),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('tools_category_id_idx').on(table.categoryId),
    index('tools_stars_idx').on(table.stars),
    index('tools_is_mcp_idx').on(table.isMcp),
  ],
);

/* -------------------------------------------------------------------------- */
/* submissions                                                                 */
/* -------------------------------------------------------------------------- */

export const SUBMISSION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const submissions = sqliteTable(
  'submissions',
  {
    id: text('id').primaryKey(),
    url: text('url').notNull(),
    userEmail: text('user_email'),
    status: text('status', { enum: SUBMISSION_STATUSES }).notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('submissions_status_idx').on(table.status)],
);

/* -------------------------------------------------------------------------- */
/* relations                                                                   */
/* -------------------------------------------------------------------------- */

export const categoriesRelations = relations(categories, ({ many }) => ({
  tools: many(tools),
}));

export const toolsRelations = relations(tools, ({ one }) => ({
  category: one(categories, {
    fields: [tools.categoryId],
    references: [categories.id],
  }),
}));

/* -------------------------------------------------------------------------- */
/* inferred types                                                              */
/* -------------------------------------------------------------------------- */

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

export type Tool = typeof tools.$inferSelect;
export type NewTool = typeof tools.$inferInsert;

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
