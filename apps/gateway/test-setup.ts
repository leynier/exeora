import { applyD1Migrations, env } from "cloudflare:test";

/**
 * Gives every workers test a migrated database.
 *
 * The pool's isolated storage rolls writes back between tests, so a test can
 * seed whatever it needs without cleaning up and without ordering against its
 * neighbours.
 */
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
