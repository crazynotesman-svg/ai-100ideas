import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config — migration generation for Cloudflare D1 (SQLite).
 *
 *   npm run db:generate        -> writes SQL into ./drizzle/migrations
 *   npm run db:migrate:local   -> applies them to the local miniflare D1
 *   npm run db:migrate:remote  -> applies them to the real D1 database
 *
 * Migrations are applied through Wrangler (`wrangler d1 migrations apply`),
 * which is why no `dbCredentials` are required here for the generate step.
 *
 * If you later want `drizzle-kit studio` against the remote database, switch
 * to the HTTP driver and provide the credentials:
 *
 *   driver: 'd1-http',
 *   dbCredentials: {
 *     accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
 *     databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
 *     token: process.env.CLOUDFLARE_D1_TOKEN!,
 *   },
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  verbose: true,
  strict: true,
});
