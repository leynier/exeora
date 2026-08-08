import "../env.js";
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

  try {
    await rollup(env);
  } catch (error) {
    // Logged rather than thrown: nothing downstream of this depends on it, and
    // the checkpoint means tomorrow's run picks up the day that failed.
    console.error("usage rollup failed", error);
  }
}
