import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.js";

export function db(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof db>;
export { schema };
