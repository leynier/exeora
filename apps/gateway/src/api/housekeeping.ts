import "../env.js";
import { purgeExpiredAuthorizations } from "../oauth/pending.js";
import { purgeBrowserSessions } from "../oauth/session.js";
import { rollupUsageDailyFromWarehouse } from "../warehouse-usage.js";

/**
 * The nightly cron, called by the scheduled handler in `src/index.ts`.
 *
 * Here rather than there because what it does is API-shaped bookkeeping over
 * the same tables the routes read, and because a cron that grows a second job
 * should grow it next to the first.
 */

type NightlyEnv = Pick<Env, "DB"> &
  Partial<
    Pick<
      Env,
      | "CLOUDFLARE_ACCOUNT_ID"
      | "AUDIT_R2_BUCKET"
      | "AUDIT_R2_WAREHOUSE"
      | "AUDIT_R2_SQL_TOKEN"
      | "AUDIT_R2_TABLE"
      | "AUDIT_WAREHOUSE_START_DAY"
    >
  >;

export async function runNightlyHousekeeping(
  env: NightlyEnv,
  deps: { rollup?: (env: NightlyEnv) => Promise<unknown> } = {},
): Promise<void> {
  const rollup = deps.rollup ?? rollupUsageDailyFromWarehouse;
  const startedAt = Date.now();
  const results = await Promise.allSettled([
    rollup(env),
    purgeExpiredAuthorizations(env),
    purgeBrowserSessions(env),
  ]);

  const failed = results.find((result) => result.status === "rejected");
  console.log(
    JSON.stringify({
      job: "nightly_housekeeping",
      status: failed ? "error" : "ok",
      durationMs: Date.now() - startedAt,
      ...(failed ? { error: describe(failed.reason) } : {}),
    }),
  );
  if (failed) throw failed.reason;
}

function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
