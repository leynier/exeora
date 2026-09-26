import { drizzle } from "drizzle-orm/d1";
import * as core from "./schema.js";
import * as cloud from "./schema-cloud.js";

/** Both schema modules as one object, so `schema.cloudMachines` reads like `schema.devices`. */
const schema = { ...core, ...cloud };

/**
 * Narrowed to the one binding it uses rather than taking the whole `Env`.
 *
 * `OAUTH_PROVIDER` is attached at runtime by the provider and is absent from
 * the generated bindings type, so asking for all of `Env` makes this
 * uncallable from a test, which holds only what wrangler declares.
 */
export function db(env: Pick<Env, "DB">) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof db>;
export { schema };
