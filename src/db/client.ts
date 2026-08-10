/**
 * Drizzle client bound to Cloudflare D1.
 *
 * As of @astrojs/cloudflare v13+, `Astro.locals.runtime` is gone — bindings are
 * read straight from the Workers runtime:
 *
 *   ---
 *   import { getDb } from '../db/client';
 *   import { tools } from '../db/schema';
 *
 *   export const prerender = false;         // needs a request-time D1 connection
 *   const db = getDb();
 *   const rows = await db.select().from(tools).limit(20);
 *   ---
 */
import { env } from 'cloudflare:workers';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import * as schema from './schema';

export type Database = DrizzleD1Database<typeof schema>;

/** Wrap an explicit D1 binding — handy for tests and scripts. */
export function createDb(binding: D1Database): Database {
  return drizzle(binding, { schema });
}

/** Default database handle for the `DB` binding declared in wrangler.toml. */
export function getDb(): Database {
  return createDb(env.DB);
}

export { schema };
